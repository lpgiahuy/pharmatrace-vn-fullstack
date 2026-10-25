import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { UpdateCartQuantityDto } from './dto/update-cart-quantity.dto';
import { SwitchCartVariantDto } from './dto/switch-cart-variant.dto';
import { SyncCartDto } from './dto/sync-cart.dto';
import { Prisma } from '@prisma/client';

export interface FormattedCartItem {
  id: string; // `${productId}-${variantId}` for UI consistency
  cartItemId: number;
  productId: number;
  slug: string;
  medicineName: string;
  imageUrl: string | null;
  variantId: number;
  unitName: string;
  price: number;
  originalPrice: number | null;
  discountPercent: number;
  quantity: number;
  isPrescription: boolean;
  status: string;
  totalStock: number;
  packagingOptions: {
    id: number;
    unitName: string;
    price: number;
    originalPrice: number | null;
    discountPercent: number;
    isBaseUnit: boolean;
  }[];
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) { }

  private customerActor(customerId: number) {
    return { id: customerId, role: 'CUSTOMER', type: 'customer' as const };
  }

  private async ensureCustomerExists(tx: Prisma.TransactionClient, customerId: number) {
    const customer = await tx.customers.findUnique({
      where: { id: customerId },
    });
    if (!customer) {
      throw new NotFoundException(`Customer account #${customerId} not found`);
    }
    if (customer.status && customer.status !== 'ACTIVE') {
      throw new BadRequestException('Your customer account is currently inactive or suspended');
    }
    return customer;
  }


  private async getVariantAvailableStock(
    tx: Prisma.TransactionClient,
    variantId: number,
    medicine: { id: number; total_stock?: number | null },
  ): Promise<number> {
    const invCount = await tx.inventories.count({
      where: { variant_id: variantId },
    });

    if (invCount > 0) {
      const inv = await tx.inventories.aggregate({
        where: { variant_id: variantId },
        _sum: {
          stock_quantity: true,
          reserved_quantity: true,
        },
      });
      const stock = (inv._sum.stock_quantity ?? 0) - (inv._sum.reserved_quantity ?? 0);
      return Math.max(0, stock);
    }

    // Fallback: If not allocated in inventories table, fallback to medicine.total_stock or 0
    return medicine.total_stock !== undefined && medicine.total_stock !== null
      ? Number(medicine.total_stock)
      : 0;
  }

  private formatCartItem(cartItem: any): FormattedCartItem | null {
    const variant = cartItem.packaging_variants;
    if (!variant || !variant.medicine) return null;

    const m = variant.medicine;
    const packagingOptions = (m.packaging_variants || []).map((pv: any) => ({
      id: pv.id,
      unitName: pv.unit_name,
      price: Number(pv.price),
      originalPrice: pv.original_price ? Number(pv.original_price) : null,
      discountPercent: pv.discount_percent ?? 0,
      isBaseUnit: Boolean(pv.is_base_unit),
    }));

    const totalStock =
      m.total_stock !== undefined && m.total_stock !== null
        ? Number(m.total_stock)
        : 0;

    return {
      id: `${m.id}-${variant.id}`,
      cartItemId: cartItem.id,
      productId: m.id,
      slug: m.slug || String(m.id),
      medicineName: m.medicine_name,
      imageUrl: m.image_url || null,
      variantId: variant.id,
      unitName: variant.unit_name,
      price: Number(variant.price),
      originalPrice: variant.original_price ? Number(variant.original_price) : null,
      discountPercent: variant.discount_percent ?? 0,
      quantity: cartItem.quantity,
      isPrescription: Boolean(m.is_prescription),
      status: m.status,
      totalStock,
      packagingOptions,
    };
  }

  async getCart(customerId: number) {
    return this.prisma.withActor(this.customerActor(customerId), (tx) => this.getCartInTransaction(tx, customerId));
  }

  private async getCartInTransaction(tx: Prisma.TransactionClient, customerId: number) {
    await this.ensureCustomerExists(tx, customerId);

    const records = await tx.cart_items.findMany({
      where: { customer_id: customerId },
      include: {
        packaging_variants: {
          include: {
            medicine: {
              include: {
                packaging_variants: {
                  orderBy: { price: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    const items: FormattedCartItem[] = [];
    for (const record of records) {
      const formatted = this.formatCartItem(record);
      if (formatted) {
        items.push(formatted);
      }
    }

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

    return {
      items,
      totalItems,
      subtotal,
    };
  }

  async addToCart(customerId: number, dto: AddToCartDto) {
    return this.prisma.withActor(this.customerActor(customerId), async (tx) => {
      await this.ensureCustomerExists(tx, customerId);

      const variant = await tx.packaging_variants.findUnique({
        where: { id: dto.variantId },
        include: { medicine: true },
      });

      if (!variant) {
        throw new NotFoundException(`Product packaging variant #${dto.variantId} not found`);
      }

      if (variant.medicine.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Medicine "${variant.medicine.medicine_name}" is currently not available for purchase`,
        );
      }

      const quantityToAdd = dto.quantity && dto.quantity > 0 ? dto.quantity : 1;

      // Check if variant is already in customer's cart
      const existing = await tx.cart_items.findUnique({
        where: {
          customer_id_variant_id: {
            customer_id: customerId,
            variant_id: dto.variantId,
          },
        },
      });

      if (existing) {
        const newQuantity = Math.min(999, existing.quantity + quantityToAdd);
        await tx.cart_items.update({
          where: { id: existing.id },
          data: { quantity: newQuantity },
        });
      } else {
        await tx.cart_items.create({
          data: {
            customer_id: customerId,
            variant_id: dto.variantId,
            quantity: Math.min(999, quantityToAdd),
          },
        });
      }

      return this.getCartInTransaction(tx, customerId);
    });
  }


  async updateQuantity(
    customerId: number,
    variantId: number,
    dto: UpdateCartQuantityDto,
  ) {
    return this.prisma.withActor(this.customerActor(customerId), async (tx) => {
      await this.ensureCustomerExists(tx, customerId);

      const existing = await tx.cart_items.findUnique({
        where: {
          customer_id_variant_id: {
            customer_id: customerId,
            variant_id: variantId,
          },
        },
      });

      if (!existing) {
        throw new NotFoundException(`Item with variant #${variantId} was not found in your cart`);
      }

      if (dto.quantity <= 0) {
        await tx.cart_items.delete({
          where: { id: existing.id },
        });
      } else {
        await tx.cart_items.update({
          where: { id: existing.id },
          data: { quantity: Math.min(999, dto.quantity) },
        });
      }

      return this.getCartInTransaction(tx, customerId);
    });
  }


  async switchVariant(customerId: number, dto: SwitchCartVariantDto) {
    return this.prisma.withActor(this.customerActor(customerId), async (tx) => {
      await this.ensureCustomerExists(tx, customerId);

      if (dto.oldVariantId === dto.newVariantId) {
        return this.getCartInTransaction(tx, customerId);
      }

      const currentItem = await tx.cart_items.findUnique({
        where: {
          customer_id_variant_id: {
            customer_id: customerId,
            variant_id: dto.oldVariantId,
          },
        },
        include: {
          packaging_variants: true,
        },
      });

      if (!currentItem) {
        throw new NotFoundException(
          `Original variant #${dto.oldVariantId} is not in your cart`,
        );
      }

      const newVariant = await tx.packaging_variants.findUnique({
        where: { id: dto.newVariantId },
        include: { medicine: true },
      });

      if (!newVariant) {
        throw new NotFoundException(`New variant #${dto.newVariantId} not found`);
      }

      if (
        currentItem.packaging_variants &&
        currentItem.packaging_variants.medicine_id !== newVariant.medicine_id
      ) {
        throw new BadRequestException('Cannot switch variant between two different medicines');
      }

      if (newVariant.medicine.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Medicine "${newVariant.medicine.medicine_name}" is currently not available for purchase`,
        );
      }

      // Query available live inventory stock for the new variant
      const availableStock = await this.getVariantAvailableStock(
        tx,
        newVariant.id,
        newVariant.medicine,
      );

      // Case 2: Variant 2 has 0 items in stock -> Block immediately with English error message
      if (availableStock <= 0) {
        throw new BadRequestException(
          `Packaging variant "${newVariant.unit_name}" is currently out of stock`,
        );
      }

      // Case 1: Cap to available stock (e.g. customer has 10, but stock is 1 -> target is 1)
      const targetQuantity = Math.min(currentItem.quantity, availableStock);

      // Perform atomic transaction: merge or replace
      const existingTarget = await tx.cart_items.findUnique({
        where: {
          customer_id_variant_id: {
            customer_id: customerId,
            variant_id: dto.newVariantId,
          },
        },
      });

      if (existingTarget) {
        // Merge quantities and cap to availableStock and max limit of 999
        const combinedQuantity = Math.min(
          availableStock,
          Math.min(999, existingTarget.quantity + targetQuantity),
        );
        await tx.cart_items.update({
          where: { id: existingTarget.id },
          data: { quantity: combinedQuantity },
        });
        await tx.cart_items.delete({
          where: { id: currentItem.id },
        });
      } else {
        // Change variant on current item and cap quantity to targetQuantity
        await tx.cart_items.update({
          where: { id: currentItem.id },
          data: {
            variant_id: dto.newVariantId,
            quantity: targetQuantity,
          },
        });
      }

      return this.getCartInTransaction(tx, customerId);
    });
  }

  async removeItem(customerId: number, variantId: number) {
    return this.prisma.withActor(this.customerActor(customerId), async (tx) => {
      await this.ensureCustomerExists(tx, customerId);

      await tx.cart_items.deleteMany({
        where: {
          customer_id: customerId,
          variant_id: variantId,
        },
      });

      return this.getCartInTransaction(tx, customerId);
    });
  }

  async clearCart(customerId: number) {
    return this.prisma.withActor(this.customerActor(customerId), async (tx) => {
      await this.ensureCustomerExists(tx, customerId);

      await tx.cart_items.deleteMany({
        where: { customer_id: customerId },
      });

      return {
        items: [],
        totalItems: 0,
        subtotal: 0,
      };
    });
  }

  async syncCart(customerId: number, dto: SyncCartDto) {
    return this.prisma.withActor(this.customerActor(customerId), async (tx) => {
      await this.ensureCustomerExists(tx, customerId);

      if (!dto.items || dto.items.length === 0) {
        return this.getCartInTransaction(tx, customerId);
      }

      const variantIds = dto.items.map((i) => i.variantId);
      const validVariants = await tx.packaging_variants.findMany({
        where: {
          id: { in: variantIds },
          medicine: { status: 'ACTIVE' },
        },
        select: { id: true },
      });

      const validVariantIdSet = new Set(validVariants.map((v) => v.id));

      // Upsert items into database
      for (const item of dto.items) {
        if (!validVariantIdSet.has(item.variantId)) continue;

        const qty = Math.max(1, Math.min(999, item.quantity));
        const existing = await tx.cart_items.findUnique({
          where: {
            customer_id_variant_id: {
              customer_id: customerId,
              variant_id: item.variantId,
            },
          },
        });

        if (existing) {
          await tx.cart_items.update({
            where: { id: existing.id },
            data: { quantity: Math.max(existing.quantity, qty) },
          });
        } else {
          await tx.cart_items.create({
            data: {
              customer_id: customerId,
              variant_id: item.variantId,
              quantity: qty,
            },
          });
        }
      }

      return this.getCartInTransaction(tx, customerId);
    });
  }
}
