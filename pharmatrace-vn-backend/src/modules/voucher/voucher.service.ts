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
    const code = dto.voucherCode.trim().toUpperCase();
    const orderSubtotal = Number(dto.orderSubtotal);

    const voucher = await this.prisma.vouchers.findFirst({
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

    const totalQty = voucher.total_quantity ?? 100;
    const usedQty = voucher.used_quantity ?? 0;
    if (totalQty > 0 && usedQty >= totalQty) {
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
  }

  async findAll(query: VoucherQueryDto) {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.search) {
      where.voucher_code = {
        contains: query.search.trim(),
        mode: 'insensitive',
      };
    }

    if (query.status) {
      where.status = query.status.trim().toUpperCase();
    }

    if (query.discountType) {
      where.discount_type = query.discountType.trim().toUpperCase();
    }

    let orderBy: any = { id: 'desc' };
    if (query.sort === 'oldest') {
      orderBy = { id: 'asc' };
    } else if (query.sort === 'usage_desc') {
      orderBy = { used_quantity: 'desc' };
    } else if (query.sort === 'usage_asc') {
      orderBy = { used_quantity: 'asc' };
    } else if (query.sort === 'min_order_asc') {
      orderBy = { min_order_value: 'asc' };
    } else if (query.sort === 'min_order_desc') {
      orderBy = { min_order_value: 'desc' };
    }

    const [items, total] = await Promise.all([
      this.prisma.vouchers.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.vouchers.count({ where }),
    ]);

    return {
      items: items.map((v) => this.formatVoucher(v)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const voucher = await this.prisma.vouchers.findUnique({
      where: { id },
    });
    if (!voucher) {
      throw new NotFoundException(`Voucher #${id} not found`);
    }
    return this.formatVoucher(voucher);
  }

  async create(dto: CreateVoucherDto) {
    const code = dto.voucherCode.trim().toUpperCase();

    const existing = await this.prisma.vouchers.findUnique({
      where: { voucher_code: code },
    });
    if (existing) {
      throw new ConflictException(`Voucher code "${code}" already exists`);
    }

    const discountType = dto.discountType || 'PERCENT';
    const created = await this.prisma.vouchers.create({
      data: {
        voucher_code: code,
        discount_type: discountType,
        discount_value: dto.discountValue,
        min_order_value: dto.minOrderValue ?? 0,
        max_discount_amount: discountType === 'PERCENT' ? (dto.maxDiscountAmount ?? null) : null,
        total_quantity: dto.totalQuantity ?? 100,
        used_quantity: 0,
        start_date: dto.startDate ? new Date(dto.startDate) : null,
        end_date: dto.endDate ? new Date(dto.endDate) : null,
        status: dto.status || 'ACTIVE',
      },
    });

    return this.formatVoucher(created);
  }

  async update(id: number, dto: UpdateVoucherDto) {
    const existing = await this.prisma.vouchers.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Voucher #${id} not found`);
    }

    const data: any = {};

    if (dto.voucherCode) {
      const code = dto.voucherCode.trim().toUpperCase();
      if (code !== existing.voucher_code) {
        const dup = await this.prisma.vouchers.findUnique({
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

    if (dto.totalQuantity !== undefined) data.total_quantity = dto.totalQuantity;
    if (dto.startDate !== undefined) data.start_date = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.end_date = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.status !== undefined) data.status = dto.status;

    const updated = await this.prisma.vouchers.update({
      where: { id },
      data,
    });

    return this.formatVoucher(updated);
  }

  async applyVoucher(dto: ValidateVoucherDto) {
    const validation = await this.validateVoucher(dto);

    await this.prisma.vouchers.update({
      where: { id: validation.voucherId },
      data: {
        used_quantity: {
          increment: 1,
        },
      },
    });

    return {
      ...validation,
      message: 'Voucher applied and usage recorded successfully',
    };
  }

  async remove(id: number) {
    const existing = await this.prisma.vouchers.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Voucher #${id} not found`);
    }

    await this.prisma.vouchers.delete({ where: { id } });
    return { success: true, message: `Voucher #${id} deleted successfully` };
  }
}
