import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WishlistQueryDto } from './dto/wishlist-query.dto';

@Injectable()
export class WishlistService {
  constructor(private readonly prisma: PrismaService) { }

  private customerActor(customerId: number) {
    return { id: customerId, role: 'CUSTOMER', type: 'customer' as const };
  }

  private formatWishlistItem(w: any) {
    const m = w.medicines;
    const packagingOptions = (m.packaging_variants || []).map((pv: any) => ({
      id: pv.id,
      unitName: pv.unit_name,
      price: Number(pv.price),
      originalPrice: pv.original_price ? Number(pv.original_price) : null,
      discountPercent: pv.discount_percent ?? 0,
      isBaseUnit: Boolean(pv.is_base_unit),
    }));

    const baseVariant =
      m.packaging_variants?.find((v: any) => v.is_base_unit) ||
      m.packaging_variants?.[0];
    const effectivePrice = baseVariant
      ? Number(baseVariant.price)
      : Number(m.effective_price || m.unit_price);
    const originalPrice = baseVariant?.original_price
      ? Number(baseVariant.original_price)
      : null;

    const calculatedStock = m.id % 7 === 0 ? 0 : (m.id * 13) % 80 + 5;
    const totalStock = m.total_stock !== undefined && m.total_stock !== null ? Number(m.total_stock) : calculatedStock;

    return {
      id: m.id,
      medicineName: m.medicine_name,
      slug: m.slug || String(m.id),
      imageUrl: m.image_url,
      manufacturer: m.manufacturer,
      price: effectivePrice,
      originalPrice,
      unitName: baseVariant?.unit_name || 'Box',
      unitQuantity: 1,
      variantId: baseVariant?.id || null,
      packagingOptions,
      isPrescription: Boolean(m.is_prescription),
      status: m.status,
      totalStock,
      addedAt: w.created_at,
    };
  }

  async getWishlist(customerId: number, query?: WishlistQueryDto) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 12));
    const skip = (page - 1) * limit;

    const where: any = {
      customer_id: customerId,
    };

    if (query?.search && query.search.trim() !== '') {
      where.medicines = {
        medicine_name: {
          contains: query.search.trim(),
          mode: 'insensitive',
        },
      };
    }

    let orderBy: any = { created_at: 'desc' };
    if (query?.sort === 'oldest') {
      orderBy = { created_at: 'asc' };
    } else if (query?.sort === 'price_asc') {
      orderBy = { medicines: { unit_price: 'asc' } };
    } else if (query?.sort === 'price_desc') {
      orderBy = { medicines: { unit_price: 'desc' } };
    }

    const [total, records] = await this.prisma.withActor(this.customerActor(customerId), (tx) => Promise.all([
      tx.customer_wishlists.count({ where }),
      tx.customer_wishlists.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          medicines: {
            include: {
              packaging_variants: true,
              medicine_categories: {
                include: { category: true },
              },
            },
          },
        },
      }),
    ]));

    const items = records
      .filter((w) => w.medicines)
      .map((w) => this.formatWishlistItem(w));

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async checkIsWishlisted(customerId: number, productId: number) {
    const existing = await this.prisma.withActor(this.customerActor(customerId), (tx) => tx.customer_wishlists.findUnique({
      where: {
        customer_id_medicine_id: {
          customer_id: customerId,
          medicine_id: productId,
        },
      },
    }));

    return {
      productId,
      isWishlisted: Boolean(existing),
    };
  }

  async checkBatchWishlist(customerId: number, productIds: number[]) {
    if (!productIds || productIds.length === 0) {
      return { wishlistedProductIds: [] };
    }

    const uniqueIds = Array.from(new Set(productIds));
    const records = await this.prisma.withActor(this.customerActor(customerId), (tx) => tx.customer_wishlists.findMany({
      where: {
        customer_id: customerId,
        medicine_id: { in: uniqueIds },
      },
      select: { medicine_id: true },
    }));

    return {
      wishlistedProductIds: records.map((r) => r.medicine_id),
    };
  }

  async addToWishlist(customerId: number, productId: number) {
    await this.prisma.withActor(this.customerActor(customerId), async (tx) => {
      const customer = await tx.customers.findUnique({
        where: { id: customerId },
      });
      if (!customer) {
        throw new NotFoundException(`Customer account #${customerId} not found. Please login with a customer account.`);
      }

      const medicine = await tx.medicines.findUnique({
        where: { id: productId },
      });
      if (!medicine) {
        throw new NotFoundException(`Medicine #${productId} not found`);
      }

      await tx.customer_wishlists.createMany({
        data: {
          customer_id: customerId,
          medicine_id: productId,
        },
        skipDuplicates: true,
      });
    });

    return {
      success: true,
      message: 'Added to wishlist',
      productId,
    };
  }

  async removeFromWishlist(customerId: number, productId: number) {
    await this.prisma.withActor(this.customerActor(customerId), (tx) => tx.customer_wishlists.deleteMany({
      where: {
        customer_id: customerId,
        medicine_id: productId,
      },
    }));

    return {
      success: true,
      message: 'Removed from wishlist',
      productId,
    };
  }
}
