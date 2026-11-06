import { authActor } from "../../common/auth-identity";
import { CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import { Prisma } from '@prisma/client';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValidateVoucherDto } from './dto/validate-voucher.dto';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { VoucherQueryDto } from './dto/voucher-query.dto';

@Injectable()
export class VoucherService {
  constructor(private readonly prisma: PrismaService) { }

  private checkTerms(v: { voucher_code: string; discount_type: string | null; discount_value: unknown;
    min_order_value: unknown; max_discount_amount: unknown; total_quantity: number; used_quantity: number | null;
    start_date: Date | null; end_date: Date | null; status: string | null }) {
    const value = Number(v.discount_value);
    if (!v.voucher_code.trim() || v.voucher_code.length > 50 || !['PERCENT', 'FIXED'].includes(v.discount_type || '')
      || !Number.isFinite(value) || value <= 0 || (v.discount_type === 'PERCENT' && value > 100)
      || !Number.isFinite(Number(v.min_order_value)) || Number(v.min_order_value) < 0
      || (v.discount_type === 'PERCENT' && v.max_discount_amount == null)
      || (v.max_discount_amount != null && (!Number.isFinite(Number(v.max_discount_amount)) || Number(v.max_discount_amount) <= 0))
      || !Number.isInteger(v.total_quantity) || v.total_quantity < 1 || v.total_quantity < (v.used_quantity || 0)
      || !['ACTIVE', 'INACTIVE', 'EXPIRED'].includes(v.status || '')
      || !v.start_date || !v.end_date || !Number.isFinite(v.start_date.getTime()) || !Number.isFinite(v.end_date.getTime())
      || v.start_date > v.end_date) {
      throw new BadRequestException('Invalid voucher terms, validity dates or usage limit');
    }
  }

  private writeError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') throw new ConflictException('Voucher code already exists');
      if (error.code === 'P2003') throw new ConflictException('Voucher has order history; deactivate it instead');
      if (error.code === 'P2025') throw new NotFoundException('Voucher not found or no longer removable');
    }
    throw error;
  }

  private formatVoucher(v: any) {
    const now = new Date();
    let computedStatus = v.status || 'ACTIVE';
    if (computedStatus === 'ACTIVE' && v.end_date && now > new Date(v.end_date)) {
      computedStatus = 'EXPIRED';
    }

    return {
      id: v.id,
      voucherCode: v.voucher_code,
      discountType: v.discount_type || 'PERCENT',
      discountValue: Number(v.discount_value),
      minOrderValue: Number(v.min_order_value || 0),
      maxDiscountAmount: v.max_discount_amount
        ? Number(v.max_discount_amount)
        : null,
      totalQuantity: v.total_quantity ?? 100,
      usedQuantity: v.used_quantity ?? 0,
      startDate: v.start_date,
      endDate: v.end_date,
      status: computedStatus,
    };
  }

  async validateVoucher(dto: ValidateVoucherDto) {
    return this.prisma.withVoucher('validate', async tx => {
      const code = dto.voucherCode.trim().toUpperCase();
      const orderSubtotal = Number(dto.orderSubtotal);

      const voucher = await tx.vouchers.findFirst({
        where: {
          voucher_code: { equals: code, mode: 'insensitive' },
        },
      });

      if (!voucher) {
        throw new NotFoundException('Voucher code does not exist');
      }

      if (voucher.status !== 'ACTIVE') {
        throw new BadRequestException('Voucher is currently not active');
      }

      const now = new Date();
      if (voucher.start_date && now < new Date(voucher.start_date)) {
        throw new BadRequestException('Voucher is not yet valid');
      }

      if (voucher.end_date && now > new Date(voucher.end_date)) {
        throw new BadRequestException('Voucher has expired');
      }

      if (!voucher.total_quantity || voucher.total_quantity <= 0) {
        throw new BadRequestException('Voucher does not have a valid usage limit');
      }
      const usedQty = voucher.used_quantity ?? 0;
      if (usedQty >= voucher.total_quantity) {
        throw new BadRequestException('Voucher usage limit reached');
      }

      const minOrder = Number(voucher.min_order_value || 0);
      if (orderSubtotal < minOrder) {
        throw new BadRequestException(
          `Order subtotal must be at least ${minOrder.toLocaleString()} VND to use this voucher`,
        );
      }

      const discountVal = Number(voucher.discount_value);
      let discountAmount = 0;

      if (voucher.discount_type === 'PERCENT') {
        discountAmount = (orderSubtotal * discountVal) / 100;
        if (voucher.max_discount_amount) {
          const maxCap = Number(voucher.max_discount_amount);
          if (discountAmount > maxCap) {
            discountAmount = maxCap;
          }
        }
      } else {
        discountAmount = Math.min(discountVal, orderSubtotal);
      }

      discountAmount = Math.round(discountAmount * 100) / 100;
      const finalTotal = Math.max(0, Math.round((orderSubtotal - discountAmount) * 100) / 100);

      return {
        valid: true,
        voucherId: voucher.id,
        voucherCode: voucher.voucher_code,
        discountType: voucher.discount_type || 'PERCENT',
        discountValue: discountVal,
        discountAmount,
        finalTotal,
        minOrderValue: minOrder,
        maxDiscountAmount: voucher.max_discount_amount
          ? Number(voucher.max_discount_amount)
          : null,
        message: 'Voucher applied successfully',
      };

    }, { code: dto.voucherCode });
  }

  async findAll(query: VoucherQueryDto | undefined, user: CurrentUserPayload) {
    return this.prisma.withVoucher('read', async tx => {
      const page = Math.max(1, Number(query?.page) || 1);
      const limit = Math.max(1, Math.min(100, Number(query?.limit) || 10));
      const skip = (page - 1) * limit;

      const where: any = {};

      if (query?.search) {
        where.voucher_code = {
          contains: query.search.trim(),
          mode: 'insensitive',
        };
      }

      if (query?.status) {
        where.status = query.status.trim().toUpperCase();
      }

      if (query?.discountType) {
        where.discount_type = query.discountType.trim().toUpperCase();
      }

      let orderBy: any = { id: 'desc' };
      if (query?.sort === 'oldest') {
        orderBy = { id: 'asc' };
      } else if (query?.sort === 'usage_desc') {
        orderBy = { used_quantity: 'desc' };
      } else if (query?.sort === 'usage_asc') {
        orderBy = { used_quantity: 'asc' };
      } else if (query?.sort === 'min_order_asc') {
        orderBy = { min_order_value: 'asc' };
      } else if (query?.sort === 'min_order_desc') {
        orderBy = { min_order_value: 'desc' };
      }

      const items = await tx.vouchers.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      });
      const total = await tx.vouchers.count({ where });

      return {
        items: items.map((v) => this.formatVoucher(v)),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };

    }, { actor: authActor(user) });
  }

  async findOne(id: number, user: CurrentUserPayload) {
    return this.prisma.withVoucher('read', async tx => {
      const voucher = await tx.vouchers.findUnique({
        where: { id },
      });
      if (!voucher) {
        throw new NotFoundException(`Voucher #${id} not found`);
      }
      return this.formatVoucher(voucher);

    }, { actor: authActor(user) });
  }

  async create(dto: CreateVoucherDto, user: CurrentUserPayload) {
    return this.prisma.withVoucher('manage', async tx => {
      const code = dto.voucherCode.trim().toUpperCase();

      const existing = await tx.vouchers.findUnique({
        where: { voucher_code: code },
      });
      if (existing) {
        throw new ConflictException(`Voucher code "${code}" already exists`);
      }

      if (!dto.totalQuantity || dto.totalQuantity <= 0) {
        throw new BadRequestException('Voucher usage limit (totalQuantity) is required and must be at least 1');
      }

      const discountType = dto.discountType || 'PERCENT';
      const data = {
          voucher_code: code,
          discount_type: discountType,
          discount_value: dto.discountValue,
          min_order_value: dto.minOrderValue ?? 0,
          max_discount_amount: discountType === 'PERCENT' ? (dto.maxDiscountAmount ?? null) : null,
          total_quantity: dto.totalQuantity,
          used_quantity: 0,
          start_date: dto.startDate ? new Date(dto.startDate) : null,
          end_date: dto.endDate ? new Date(dto.endDate) : null,
          status: dto.status || 'ACTIVE',
        };
      this.checkTerms(data);
      const created = await tx.vouchers.create({ data });

      return this.formatVoucher(created);

    }, { actor: authActor(user) }).catch((error: unknown) => this.writeError(error));
  }

  async update(id: number, dto: UpdateVoucherDto, user: CurrentUserPayload) {
    return this.prisma.withVoucher('manage', async tx => {
      await tx.$queryRaw`SELECT id FROM public.vouchers WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.vouchers.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Voucher #${id} not found`);
      }

      const data: any = {};

      if (dto.voucherCode) {
        const code = dto.voucherCode.trim().toUpperCase();
        if (code !== existing.voucher_code) {
          const dup = await tx.vouchers.findUnique({
            where: { voucher_code: code },
          });
          if (dup) {
            throw new ConflictException(`Voucher code "${code}" already exists`);
          }
          data.voucher_code = code;
        }
      }

      const finalDiscountType = dto.discountType !== undefined ? dto.discountType : existing.discount_type;
      if (dto.discountType !== undefined) data.discount_type = dto.discountType;
      if (dto.discountValue !== undefined) data.discount_value = dto.discountValue;
      if (dto.minOrderValue !== undefined) data.min_order_value = dto.minOrderValue;

      if (finalDiscountType === 'FIXED') {
        data.max_discount_amount = null;
      } else if (dto.maxDiscountAmount !== undefined) {
        data.max_discount_amount = dto.maxDiscountAmount;
      }

      if (dto.totalQuantity !== undefined) {
        if (!dto.totalQuantity || dto.totalQuantity <= 0) {
          throw new BadRequestException('Voucher usage limit must be at least 1');
        }
        data.total_quantity = dto.totalQuantity;
      }
      if (dto.startDate !== undefined) data.start_date = dto.startDate ? new Date(dto.startDate) : null;
      if (dto.endDate !== undefined) data.end_date = dto.endDate ? new Date(dto.endDate) : null;
      if (dto.status !== undefined) data.status = dto.status;

      this.checkTerms({ ...existing, ...data });
      const updated = await tx.vouchers.update({
        where: { id },
        data,
      });

      return this.formatVoucher(updated);

    }, { actor: authActor(user) }).catch((error: unknown) => this.writeError(error));
  }
  async remove(id: number, user: CurrentUserPayload) {
    return this.prisma.withVoucher('manage', async tx => {
      await tx.$queryRaw`SELECT id FROM public.vouchers WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.vouchers.findUnique({ where: { id } });
      if (!existing) {
        throw new NotFoundException(`Voucher #${id} not found`);
      }

      if ((existing.used_quantity || 0) > 0) throw new ConflictException('Voucher has been used; deactivate it instead');
      await tx.vouchers.delete({ where: { id } });
      return { success: true, message: `Voucher #${id} deleted successfully` };

    }, { actor: authActor(user) }).catch((error: unknown) => this.writeError(error));
  }
}
