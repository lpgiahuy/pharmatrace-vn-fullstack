import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';
import { ReviewQueryDto } from './dto/review-query.dto';
import { AdminReviewQueryDto } from './dto/admin-review-query.dto';
import { ReplyReviewDto } from './dto/reply-review.dto';
import { ContentModerationService } from '../moderation/content-moderation.service';
import { CreateReportDto } from '../moderation/dto/create-report.dto';

@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderationService: ContentModerationService,
  ) { }

  async getProductReviews(idOrSlug: string | number, query: ReviewQueryDto) {
    const medicine = await this.prisma.medicines.findFirst({
      where: isNaN(Number(idOrSlug))
        ? { slug: String(idOrSlug).toLowerCase() }
        : { id: Number(idOrSlug) },
      select: { id: true, medicine_name: true },
    });

    if (!medicine) {
      throw new NotFoundException(`Product "${idOrSlug}" not found`);
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 10;
    const skip = (page - 1) * limit;

    const where: any = {
      medicine_id: medicine.id,
      status: 'APPROVED',
    };

    if (query.rating) {
      where.rating_stars = query.rating;
    }

    // Determine sorting
    let orderBy: any = { created_at: 'desc' };
    if (query.sort === 'oldest') {
      orderBy = { created_at: 'asc' };
    } else if (query.sort === 'highest_rating') {
      orderBy = { rating_stars: 'desc' };
    } else if (query.sort === 'lowest_rating') {
      orderBy = { rating_stars: 'asc' };
    } else if (query.sort === 'most_helpful') {
      orderBy = { helpful_count: 'desc' };
    }

    const allApproved = await this.prisma.reviews.findMany({
      where: { medicine_id: medicine.id, status: 'APPROVED' },
      select: { rating_stars: true },
    });

    const totalReviews = allApproved.length;
    let sumStars = 0;
    const starCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const r of allApproved) {
      const star = r.rating_stars || 5;
      sumStars += star;
      if (starCounts[star] !== undefined) {
        starCounts[star]++;
      }
    }

    const averageRating =
      totalReviews > 0 ? Number((sumStars / totalReviews).toFixed(1)) : 5.0;

    const [items, totalFiltered] = await Promise.all([
      this.prisma.reviews.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          customers: {
            select: { id: true, full_name: true, email: true },
          },
        },
      }),
      this.prisma.reviews.count({ where }),
    ]);

    return {
      stats: {
        totalReviews,
        averageRating,
        starCounts,
      },
      items: items.map((r) => ({
        id: r.id,
        customerId: r.customer_id,
        ratingStars: r.rating_stars ?? 5,
        comment: r.comment || '',
        images: r.images || [],
        isVerifiedPurchase: Boolean(r.is_verified_purchase),
        helpfulCount: r.helpful_count || 0,
        adminReply: r.admin_reply || null,
        repliedAt: r.replied_at || null,
        repliedByName: r.replied_by_name || null,
        createdAt: r.created_at,
        customerName: r.customers?.full_name || 'Khách hàng ẩn danh',
      })),
      pagination: {
        page,
        limit,
        total: totalFiltered,
        totalPages: Math.ceil(totalFiltered / limit) || 1,
      },
    };
  }

  /**
   * Check if customer can write a review for this product
   */
  async checkCanReview(idOrSlug: string | number, customerId: number) {
    const medicine = await this.prisma.medicines.findFirst({
      where: isNaN(Number(idOrSlug))
        ? { slug: String(idOrSlug).toLowerCase() }
        : { id: Number(idOrSlug) },
      select: { id: true, medicine_name: true },
    });

    if (!medicine) {
      throw new NotFoundException(`Product "${idOrSlug}" not found`);
    }

    const deliveredPurchase = await this.prisma.order_items.findFirst({
      where: {
        medicine_id: medicine.id,
        orders: {
          customer_id: customerId,
          order_status: {
            in: ['DELIVERED', 'COMPLETED', 'HOANTHANH', 'delivered', 'completed'],
          },
        },
      },
    });

    const isPurchased = Boolean(deliveredPurchase);

    const existingReview = await this.prisma.reviews.findFirst({
      where: {
        medicine_id: medicine.id,
        customer_id: customerId,
      },
    });

    const alreadyReviewed = Boolean(existingReview);

    return {
      productId: medicine.id,
      canReview: isPurchased,
      isPurchased,
      alreadyReviewed,
      existingReviewId: existingReview?.id || null,
      message: !isPurchased
        ? 'Only customers who have purchased and received this product can review it.'
        : alreadyReviewed
          ? 'You have already reviewed this product.'
          : 'You are eligible to review this product.',
    };
  }

  /**
   * Create new product review
   */
  async createProductReview(
    idOrSlug: string | number,
    customerId: number,
    dto: CreateReviewDto,
  ) {
    const medicine = await this.prisma.medicines.findFirst({
      where: isNaN(Number(idOrSlug))
        ? { slug: String(idOrSlug).toLowerCase() }
        : { id: Number(idOrSlug) },
      select: { id: true, medicine_name: true },
    });

    if (!medicine) {
      throw new NotFoundException(`Product "${idOrSlug}" not found`);
    }

    // Verify purchase
    const purchased = await this.prisma.order_items.findFirst({
      where: {
        medicine_id: medicine.id,
        orders: {
          customer_id: customerId,
          order_status: {
            in: ['DELIVERED', 'COMPLETED', 'HOANTHANH', 'delivered', 'completed'],
          },
        },
      },
    });

    if (!purchased) {
      throw new ForbiddenException(
        'You can only review products after purchasing and receiving them successfully.',
      );
    }

    // Rate limit check
    this.moderationService.checkReviewRateLimit(customerId);

    // Evaluate content with sanitization, rule checks, and AI stub
    const modResult = await this.moderationService.evaluateReview(dto.comment);

    const review = await this.prisma.reviews.create({
      data: {
        medicine_id: medicine.id,
        customer_id: customerId,
        rating_stars: dto.ratingStars,
        comment: modResult.sanitizedComment,
        images: dto.images || [],
        status: modResult.suggestedStatus,
        is_verified_purchase: true,
        helpful_count: 0,
      },
      include: {
        customers: {
          select: { id: true, full_name: true },
        },
      },
    });

    // Write audit log for the submission
    await this.moderationService.logAudit({
      reviewId: review.id,
      action: modResult.suggestedStatus === 'APPROVED' ? 'AUTO_APPROVE' : `AUTO_FLAG_${modResult.suggestedStatus}`,
      customerId,
      role: 'CUSTOMER',
      reason: modResult.reason || 'Automated moderation check passed',
      meta: {
        riskScore: modResult.riskScore,
        flags: modResult.flags,
        status: modResult.suggestedStatus,
      },
    });

    return {
      id: review.id,
      ratingStars: review.rating_stars,
      comment: review.comment,
      images: review.images,
      status: review.status,
      isVerifiedPurchase: true,
      helpfulCount: 0,
      createdAt: review.created_at,
      customerName: review.customers?.full_name || 'Khách hàng',
    };
  }

  // In-memory set to prevent spamming helpful votes from the same client
  private votedHelpfulClients = new Set<string>();

  /**
   * Upvote review as helpful or toggle unvote
   */
  async voteHelpful(reviewId: number, isUnvote?: boolean, clientId?: string) {
    const review = await this.prisma.reviews.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException(`Review #${reviewId} not found`);
    }

    const currentCount = review.helpful_count || 0;
    const voteKey = clientId ? `${clientId}_${reviewId}` : null;

    if (!isUnvote) {
      // If already voted by this client, return early without incrementing count
      if (voteKey && this.votedHelpfulClients.has(voteKey)) {
        return {
          success: true,
          reviewId: review.id,
          helpfulCount: currentCount,
          isVoted: true,
        };
      }
      if (voteKey) {
        this.votedHelpfulClients.add(voteKey);
      }
    } else {
      if (voteKey) {
        this.votedHelpfulClients.delete(voteKey);
      }
    }

    const newCount = isUnvote ? Math.max(0, currentCount - 1) : currentCount + 1;

    const updated = await this.prisma.reviews.update({
      where: { id: reviewId },
      data: {
        helpful_count: newCount,
      },
    });

    return {
      success: true,
      reviewId: updated.id,
      helpfulCount: updated.helpful_count || 0,
      isVoted: !isUnvote,
    };
  }

  /**
   * Get reviews created by current authenticated customer
   */
  async getCustomerMyReviews(
    customerId: number,
    query?: { page?: number; limit?: number },
  ) {
    const page = Math.max(1, query?.page || 1);
    const limit = Math.max(1, Math.min(100, query?.limit || 10));
    const skip = (page - 1) * limit;

    const where = { customer_id: customerId };

    const [total, records] = await Promise.all([
      this.prisma.reviews.count({ where }),
      this.prisma.reviews.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          medicines: {
            select: {
              id: true,
              medicine_name: true,
              slug: true,
              image_url: true,
              unit_price: true,
            },
          },
        },
      }),
    ]);

    return {
      items: records.map((r) => ({
        id: r.id,
        productId: r.medicines?.id,
        productName: r.medicines?.medicine_name,
        productSlug: r.medicines?.slug || String(r.medicines?.id),
        productImage: r.medicines?.image_url,
        ratingStars: r.rating_stars,
        comment: r.comment,
        images: r.images || [],
        status: r.status,
        helpfulCount: r.helpful_count || 0,
        adminReply: r.admin_reply,
        repliedAt: r.replied_at,
        repliedByName: r.replied_by_name,
        createdAt: r.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Customer: Edit their own review
   */
  async customerUpdateReview(
    reviewId: number,
    customerId: number,
    dto: UpdateReviewDto,
  ) {
    const review = await this.prisma.reviews.findUnique({
      where: { id: reviewId },
      include: {
        medicines: {
          select: {
            id: true,
            medicine_name: true,
            slug: true,
            image_url: true,
          },
        },
      },
    });

    if (!review) {
      throw new NotFoundException(`Review #${reviewId} not found`);
    }

    if (review.customer_id !== customerId) {
      throw new ForbiddenException('You can only edit your own review');
    }

    // Rate limit check
    this.moderationService.checkReviewRateLimit(customerId);

    let sanitizedComment = review.comment;
    let newStatus = review.status;
    let modMeta: any = null;

    if (dto.comment !== undefined) {
      const modResult = await this.moderationService.evaluateReview(dto.comment);
      sanitizedComment = modResult.sanitizedComment;
      newStatus = modResult.suggestedStatus;
      modMeta = { riskScore: modResult.riskScore, flags: modResult.flags };
    }

    const updated = await this.prisma.reviews.update({
      where: { id: reviewId },
      data: {
        rating_stars: dto.ratingStars !== undefined ? dto.ratingStars : review.rating_stars,
        comment: sanitizedComment,
        images: dto.images !== undefined ? dto.images : review.images,
        status: newStatus,
      },
      include: {
        medicines: {
          select: {
            id: true,
            medicine_name: true,
            slug: true,
            image_url: true,
          },
        },
      },
    });

    // Write audit log
    await this.moderationService.logAudit({
      reviewId: updated.id,
      action: 'CUSTOMER_EDIT',
      customerId,
      role: 'CUSTOMER',
      reason: 'Review edited by author customer',
      meta: modMeta || {},
    });

    return {
      id: updated.id,
      productId: updated.medicines?.id,
      productName: updated.medicines?.medicine_name,
      productSlug: updated.medicines?.slug || String(updated.medicines?.id),
      productImage: updated.medicines?.image_url,
      ratingStars: updated.rating_stars,
      comment: updated.comment,
      images: updated.images || [],
      status: updated.status,
      helpfulCount: updated.helpful_count || 0,
      adminReply: updated.admin_reply,
      repliedAt: updated.replied_at,
      repliedByName: updated.replied_by_name,
      createdAt: updated.created_at,
    };
  }

  /**
   * Customer: Delete their own review
   */
  async customerDeleteReview(reviewId: number, customerId: number) {
    const review = await this.prisma.reviews.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundException(`Review #${reviewId} not found`);
    }

    if (review.customer_id !== customerId) {
      throw new ForbiddenException('You can only delete your own review');
    }

    // Write audit log prior to cascade deletion
    await this.moderationService.logAudit({
      reviewId,
      action: 'CUSTOMER_DELETE',
      customerId,
      role: 'CUSTOMER',
      reason: 'Customer deleted their own review',
    });

    await this.prisma.reviews.delete({
      where: { id: reviewId },
    });

    return {
      success: true,
      message: 'Your review has been deleted successfully',
    };
  }

  /**
   * Customer / Staff: Report review
   */
  async reportReview(
    reviewId: number,
    reporter: { customerId?: number; employeeId?: number; role?: string },
    dto: CreateReportDto,
  ) {
    return this.moderationService.reportReview(reviewId, reporter, dto.reason, dto.description);
  }

  /**
   * Get medicines that customer bought and received but hasn't reviewed yet
   */
  async getCustomerPendingReviews(customerId: number) {
    // 1. Get all delivered order items for this customer
    const deliveredItems = await this.prisma.order_items.findMany({
      where: {
        orders: {
          customer_id: customerId,
          order_status: {
            in: ['DELIVERED', 'COMPLETED', 'HOANTHANH', 'delivered', 'completed'],
          },
        },
      },
      include: {
        orders: {
          select: { created_at: true },
        },
        medicines: {
          select: {
            id: true,
            medicine_name: true,
            slug: true,
            image_url: true,
            unit_price: true,
          },
        },
      },
    });

    // 2. Get all medicine IDs that customer already reviewed
    const existingReviews = await this.prisma.reviews.findMany({
      where: { customer_id: customerId },
      select: { medicine_id: true },
    });

    const reviewedMedicineIds = new Set(
      existingReviews.map((r) => r.medicine_id).filter(Boolean),
    );

    // 3. Filter items that haven't been reviewed
    const pendingMap = new Map<number, any>();
    for (const item of deliveredItems) {
      if (item.medicines && !reviewedMedicineIds.has(item.medicines.id)) {
        if (!pendingMap.has(item.medicines.id)) {
          pendingMap.set(item.medicines.id, {
            id: item.medicines.id,
            medicineName: item.medicines.medicine_name,
            slug: item.medicines.slug || String(item.medicines.id),
            imageUrl: item.medicines.image_url,
            unitPrice: item.unit_price,
            orderDate: item.orders?.created_at,
          });
        }
      }
    }

    return {
      items: Array.from(pendingMap.values()),
    };
  }

  // ================= ADMIN METHODS =================

  /**
   * Admin: List all reviews with filters & search
   */
  async getAllReviewsForAdmin(query: AdminReviewQueryDto) {
    const page = Math.max(1, query?.page || 1);
    const limit = Math.max(1, Math.min(100, query?.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status && query.status !== 'ALL') {
      where.status = query.status;
    }

    if (query.rating) {
      where.rating_stars = query.rating;
    }

    if (query.search && query.search.trim() !== '') {
      const term = query.search.trim();
      where.OR = [
        { comment: { contains: term, mode: 'insensitive' } },
        { customers: { full_name: { contains: term, mode: 'insensitive' } } },
        { customers: { email: { contains: term, mode: 'insensitive' } } },
        { medicines: { medicine_name: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [total, records] = await Promise.all([
      this.prisma.reviews.count({ where }),
      this.prisma.reviews.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          customers: {
            select: { id: true, full_name: true, email: true, phone_number: true },
          },
          medicines: {
            select: { id: true, medicine_name: true, slug: true, image_url: true },
          },
          moderation_reports: {
            select: {
              id: true,
              reason: true,
              status: true,
              description: true,
              created_at: true,
            },
          },
        },
      }),
    ]);

    return {
      items: records.map((r: any) => ({
        id: r.id,
        ratingStars: r.rating_stars,
        comment: r.comment,
        images: r.images || [],
        status: r.status,
        isVerifiedPurchase: Boolean(r.is_verified_purchase),
        helpfulCount: r.helpful_count || 0,
        adminReply: r.admin_reply,
        repliedAt: r.replied_at,
        repliedByName: r.replied_by_name,
        createdAt: r.created_at,
        reports: r.moderation_reports || [],
        customer: r.customers
          ? {
            id: r.customers.id,
            fullName: r.customers.full_name,
            email: r.customers.email,
            phone: r.customers.phone_number,
          }
          : null,
        medicine: r.medicines
          ? {
            id: r.medicines.id,
            medicineName: r.medicines.medicine_name,
            slug: r.medicines.slug,
            imageUrl: r.medicines.image_url,
          }
          : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  /**
   * Admin: Update review status (APPROVED, HIDDEN, SPAM, PENDING)
   */
  async updateReviewStatus(
    id: number,
    status: string,
    adminId?: number,
    adminRole?: string,
    reason?: string,
  ) {
    const review = await this.prisma.reviews.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Review #${id} not found`);
    }

    const updated = await this.prisma.reviews.update({
      where: { id },
      data: { status },
    });

    await this.moderationService.logAudit({
      reviewId: id,
      action: `ADMIN_STATUS_${status}`,
      employeeId: adminId,
      role: adminRole || 'ADMIN',
      reason: reason || `Status updated from ${review.status} to ${status}`,
      meta: { previousStatus: review.status, newStatus: status },
    });

    return {
      success: true,
      message: `Review status updated successfully to ${status}`,
      data: updated,
    };
  }

  /**
   * Admin: Reply to review
   */
  async replyToReview(
    id: number,
    dto: ReplyReviewDto,
    adminName: string,
    adminId?: number,
    adminRole?: string,
  ) {
    const review = await this.prisma.reviews.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Review #${id} not found`);
    }

    let replier = adminName || 'PharmaTrace Pharmacist';
    if (adminId) {
      const employee = await this.prisma.employees.findUnique({
        where: { id: adminId },
        select: { full_name: true },
      });
      if (employee?.full_name) {
        replier = employee.full_name;
      }
    }

    const updated = await this.prisma.reviews.update({
      where: { id },
      data: {
        admin_reply: dto.reply.trim(),
        replied_at: new Date(),
        replied_by_name: replier,
      },
    });

    await this.moderationService.logAudit({
      reviewId: id,
      action: 'ADMIN_REPLY',
      employeeId: adminId,
      role: adminRole || 'PHARMACIST',
      reason: 'Replied to customer review',
      meta: { replierName: replier },
    });

    return {
      success: true,
      message: 'Replied to review successfully',
      data: updated,
    };
  }

  /**
   * Admin: Delete review
   */
  async deleteReview(id: number, adminId?: number, adminRole?: string) {
    const review = await this.prisma.reviews.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Review #${id} not found`);
    }

    await this.moderationService.logAudit({
      reviewId: id,
      action: 'ADMIN_DELETE',
      employeeId: adminId,
      role: adminRole || 'SUPER_ADMIN',
      reason: 'Review deleted by administrator',
    });

    await this.prisma.reviews.delete({
      where: { id },
    });

    return {
      success: true,
      message: `Review #${id} has been deleted successfully`,
    };
  }
}
