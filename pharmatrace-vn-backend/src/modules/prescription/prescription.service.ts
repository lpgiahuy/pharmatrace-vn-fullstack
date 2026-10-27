import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { releaseOrderReservations } from '../order/helpers/order.helper';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

type PrescriptionFile = { buffer: Buffer; mimetype: string; size: number };

@Injectable()
export class PrescriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) { }

  private customerActor(customerId: number) {
    return { id: customerId, role: 'CUSTOMER', type: 'customer' as const };
  }

  private staffActor(user: CurrentUserPayload) {
    if (!['PHARMACIST', 'SUPER_ADMIN'].includes(user.role || '') || user.type !== 'employee') {
      throw new ForbiddenException('A pharmacist account is required');
    }
    if (user.role !== 'SUPER_ADMIN' && !user.facilityId) {
      throw new ForbiddenException('A facility assignment is required');
    }
    return {
      id: user.id,
      role: user.role || '',
      type: 'employee' as const,
      facilityId: user.facilityId,
    };
  }

  private extension(file: PrescriptionFile): string {
    const bytes = file.buffer;
    if (file.mimetype === 'image/jpeg' && bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpg';
    if (file.mimetype === 'image/png' && bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
    if (file.mimetype === 'image/webp' && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp';
    throw new BadRequestException('Upload a JPEG, PNG, or WebP image');
  }

  private async compress(file: PrescriptionFile): Promise<Buffer> {
    try {
      return await sharp(file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Could not process this prescription image');
    }
  }

  async uploadPrescription(customerId: number, file?: PrescriptionFile) {
    if (!file?.buffer?.length || file.size > 8 * 1024 * 1024) {
      throw new BadRequestException('Upload an image smaller than 8 MB');
    }
    this.extension(file);
    const compressed = await this.compress(file);
    const uploaded = await this.cloudinary.uploadPrivateImage(compressed, 'pharmatrace/prescriptions');
    const imageReference = `cloudinary:${uploaded.publicId}`;
    try {
      const prescription = await this.prisma.withActor(this.customerActor(customerId), (tx) =>
        tx.prescriptions.create({
          data: {
            customer_id: customerId,
            prescription_image_url: imageReference,
            status: 'PENDING_APPROVAL',
          },
          select: { id: true, created_at: true },
        }),
      );
      return { id: prescription.id, createdAt: prescription.created_at };
    } catch (error) {
      await this.cloudinary.deletePrivateImage(uploaded.publicId);
      throw error;
    }
  }

  async getMyPrescriptions(customerId: number) {
    const rows = await this.prisma.withActor(this.customerActor(customerId), (tx) =>
      tx.prescriptions.findMany({
        where: { customer_id: customerId },
        select: {
          id: true,
          created_at: true,
          order_reviews: {
            select: {
              id: true,
              order_id: true,
              status: true,
              note: true,
              reviewed_at: true,
              order: { select: { order_status: true } },
            },
            orderBy: { created_at: 'desc' },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      reviews: row.order_reviews.map((review) => ({
        id: review.id,
        orderId: review.order_id,
        status: review.status,
        note: review.note,
        reviewedAt: review.reviewed_at,
        orderStatus: review.order.order_status,
      })),
    }));
  }

  async getCustomerPrescriptionImage(customerId: number, prescriptionId: number) {
    const row = await this.prisma.withActor(this.customerActor(customerId), (tx) =>
      tx.prescriptions.findFirst({
        where: { id: prescriptionId, customer_id: customerId },
        select: { prescription_image_url: true },
      }),
    );
    if (!row?.prescription_image_url) throw new NotFoundException('Prescription image not found');
    return this.readImage(row.prescription_image_url);
  }

  async getReviewPrescriptionImage(user: CurrentUserPayload, reviewId: number) {
    const actor = this.staffActor(user);
    const row = await this.prisma.withActor(actor, (tx) =>
      tx.order_prescription_reviews.findFirst({
        where: {
          id: reviewId,
          ...(actor.role === 'SUPER_ADMIN' ? {} : { order: { export_facility_id: actor.facilityId } }),
        },
        select: { prescription: { select: { prescription_image_url: true } } },
      }),
    );
    if (!row?.prescription.prescription_image_url) throw new NotFoundException('Prescription image not found');
    return this.readImage(row.prescription.prescription_image_url);
  }

  private async readImage(name: string) {
    if (!name.startsWith('cloudinary:')) {
      throw new NotFoundException('Prescription image not found');
    }
    try {
      return {
        image: await this.cloudinary.downloadPrivateImage(name.slice('cloudinary:'.length)),
        contentType: 'image/webp',
      };
    } catch {
      throw new NotFoundException('Prescription image not found');
    }
  }

  async getReviewQueue(user: CurrentUserPayload, status: string, page?: number, limit?: number) {
    const actor = this.staffActor(user);
    const allowed = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED'];
    if (status && !allowed.includes(status)) throw new BadRequestException('Invalid review status');
    const currentPage = Math.max(1, Number(page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(limit) || 20));
    const skip = (currentPage - 1) * pageSize;
    const where = {
      ...(status ? { status } : {}),
      order: {
        ...(actor.role === 'SUPER_ADMIN' ? {} : { export_facility_id: actor.facilityId }),
        ...(status === 'PENDING_APPROVAL' ? { order_status: { not: 'CANCELLED' } } : {}),
      },
    };
    const { rows, total } = await this.prisma.withActor(actor, async (tx) => {
      const rows = await tx.order_prescription_reviews.findMany({
        where,
        select: {
          id: true,
          status: true,
          note: true,
          created_at: true,
          reviewed_at: true,
          facility_id: true,
          order: {
            select: {
              id: true,
              order_code: true,
              created_at: true,
              order_items: { select: { medicine_name: true, quantity: true, medicines: { select: { is_prescription: true } } } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: pageSize,
      });
      const total = await tx.order_prescription_reviews.count({ where });
      return { rows, total };
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        orderId: row.order.id,
        orderCode: row.order.order_code,
        facilityId: row.facility_id,
        status: row.status,
        note: row.note,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at,
        medicines: row.order.order_items.filter((item) => item.medicines?.is_prescription).map((item) => ({ name: item.medicine_name, quantity: item.quantity })),
      })),
      pagination: { page: currentPage, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async decidePrescriptionReview(user: CurrentUserPayload, reviewId: number, decision: 'APPROVED' | 'REJECTED', note?: string) {
    const actor = this.staffActor(user);
    if (decision === 'REJECTED' && !note?.trim()) throw new BadRequestException('A rejection reason is required');
    return this.prisma.withOrder('prescription', async (tx) => {
      const review = await tx.order_prescription_reviews.findFirst({
        where: {
          id: reviewId,
          ...(actor.role === 'SUPER_ADMIN' ? {} : { order: { export_facility_id: actor.facilityId } }),
        },
        select: {
          id: true,
          status: true,
          order_id: true,
          facility_id: true,
          order: { select: { order_status: true, prescription_review_status: true, customer_id: true, used_points: true, export_facility_id: true } },
        },
      });
      if (!review) throw new NotFoundException('Prescription review not found');
      if (review.status !== 'PENDING_APPROVAL') throw new ConflictException('This prescription has already been reviewed');
      if (review.facility_id !== review.order.export_facility_id) {
        throw new ConflictException('The preparing facility changed. The review assignment must be updated.');
      }
      if (!['PENDING', 'WAITING_INTERNAL_TRANSFER'].includes(review.order.order_status || '')) {
        throw new ConflictException('This order can no longer be reviewed');
      }
      if (review.order.prescription_review_status && review.order.prescription_review_status !== 'PENDING_APPROVAL') {
        throw new ConflictException('Order review status changed. Reload and try again.');
      }
      const updated = await tx.order_prescription_reviews.updateMany({
        where: { id: reviewId, status: 'PENDING_APPROVAL', facility_id: review.facility_id },
        data: {
          status: decision,
          note: note?.trim() || null,
          pharmacist_id: user.id,
          reviewed_at: new Date(),
        },
      });
      if (updated.count !== 1) throw new ConflictException('This prescription has already been reviewed');
      const updatedOrder = await tx.orders.updateMany({
        where: {
          id: review.order_id,
          order_status: { in: ['PENDING', 'WAITING_INTERNAL_TRANSFER'] },
          prescription_review_status: review.order.prescription_review_status,
        },
        data: {
          prescription_review_status: decision,
          ...(decision === 'REJECTED' ? { order_status: 'CANCELLED' } : {}),
        },
      });
      if (updatedOrder.count !== 1) throw new ConflictException('Order status changed. Reload and try again.');
      if (decision === 'REJECTED') {
        await releaseOrderReservations(tx, review.order_id, review.order.export_facility_id);
        if (review.order.customer_id && review.order.used_points && review.order.used_points > 0) {
          await tx.customers.update({
            where: { id: review.order.customer_id },
            data: { reward_points: { increment: review.order.used_points } },
          });
          await tx.loyalty_point_logs.create({
            data: {
              customer_id: review.order.customer_id,
              order_id: review.order_id,
              transaction_type: 'REDEEM_REVERSAL',
              points: review.order.used_points,
            },
          });
        }
      }
      return { id: reviewId, orderId: review.order_id, status: decision };
    }, actor);
  }
}
