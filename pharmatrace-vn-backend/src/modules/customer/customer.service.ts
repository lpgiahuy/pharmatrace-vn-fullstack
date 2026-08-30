import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { UpdateCustomerStatusDto } from './dto/update-customer-status.dto';
import { CustomerOrderQueryDto } from './dto/customer-order-query.dto';

function formatCustomer(cust: any, orderStats?: any) {
  return {
    id: cust.id,
    fullName: cust.full_name || '',
    email: cust.email || '',
    phoneNumber: cust.phone_number || '',
    membershipTier: cust.membership_tier || 'BRONZE',
    rewardPoints: cust.reward_points ?? 0,
    defaultAddress: cust.default_address || null,
    status: cust.status || 'ACTIVE',
    createdAt: cust.created_at,
    totalOrders: cust._count?.orders ?? undefined,
    orderStats: orderStats || undefined,
  };
}

function formatCustomerOrder(order: any) {
  return {
    id: order.id,
    orderCode: order.order_code,
    subtotalAmount: Number(order.subtotal_amount || 0),
    shippingFee: Number(order.shipping_fee || 0),
    discountAmount: Number(order.discount_amount || 0),
    usedPoints: order.used_points ?? 0,
    totalAmount: Number(order.total_amount || 0),
    paymentMethod: order.payment_method || 'COD',
    paymentStatus: order.payment_status || 'UNPAID',
    orderStatus: order.order_status || 'PENDING',
    shippingAddress: order.shipping_address || null,
    recipientName: order.recipient_name || null,
    recipientPhone: order.recipient_phone || null,
    note: order.note || null,
    createdAt: order.created_at,
    facility: order.facilities
      ? {
        id: order.facilities.id,
        name: order.facilities.facility_name,
        type: order.facilities.facility_type,
      }
      : null,
    shipment: order.shipments
      ? {
        id: order.shipments.id,
        trackingNumber: order.shipments.tracking_number,
        courierName: order.shipments.courier_name,
        shippingStatus: order.shipments.shipping_status,
        pickedUpAt: order.shipments.picked_up_at,
        estimatedDeliveryAt: order.shipments.estimated_delivery_at,
        actualDeliveryAt: order.shipments.actual_delivery_at,
      }
      : null,
    orderItems: (order.order_items || []).map((item: any) => ({
      id: item.id,
      quantity: item.quantity,
      unitPrice: Number(item.unit_price || 0),
      totalPrice: Number(item.total_price || 0),
      medicine: item.medicines
        ? {
          id: item.medicines.id,
          medicineName: item.medicines.medicine_name,
          activeIngredients: item.medicines.active_ingredients || null,
          dosage: item.medicines.dosage || null,
          imageUrl: item.medicines.image_url || null,
        }
        : null,
      packaging: item.packaging_specifications
        ? {
          id: item.packaging_specifications.id,
          unitName: item.packaging_specifications.unit_name,
        }
        : null,
    })),
  };
}

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) { }

  async findAll(query: CustomerQueryDto) {
    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.search && query.search.trim() !== '') {
      const s = query.search.trim();
      where.OR = [
        { full_name: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { phone_number: { contains: s, mode: 'insensitive' } },
      ];
    }

    if (query.membershipTier && query.membershipTier.trim() !== '') {
      where.membership_tier = { equals: query.membershipTier.trim(), mode: 'insensitive' };
    }

    if (query.status && query.status.trim() !== '') {
      where.status = { equals: query.status.trim(), mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      this.prisma.customers.count({ where }),
      this.prisma.customers.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          _count: {
            select: { orders: true },
          },
        },
      }),
    ]);

    return {
      items: items.map((c) => formatCustomer(c)),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async findOne(id: number) {
    const customer = await this.prisma.customers.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const orders = await this.prisma.orders.findMany({
      where: { customer_id: id },
      select: {
        total_amount: true,
        order_status: true,
      },
    });

    const totalOrders = orders.length;
    let totalSpent = 0;
    let completedOrders = 0;
    let cancelledOrders = 0;

    for (const o of orders) {
      totalSpent += Number(o.total_amount || 0);
      const statusUpper = (o.order_status || '').toUpperCase();
      if (statusUpper === 'DELIVERED' || statusUpper === 'COMPLETED' || statusUpper === 'HOANTHANH') {
        completedOrders++;
      } else if (statusUpper === 'CANCELLED' || statusUpper === 'DAHUY') {
        cancelledOrders++;
      }
    }

    const orderStats = {
      totalOrders,
      totalSpent,
      completedOrders,
      cancelledOrders,
    };

    return formatCustomer(customer, orderStats);
  }

  async updateStatus(id: number, dto: UpdateCustomerStatusDto) {
    const existing = await this.prisma.customers.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const resolvedStatus = (dto.status || 'ACTIVE').trim().toUpperCase();

    const updated = await this.prisma.customers.update({
      where: { id },
      data: { status: resolvedStatus },
    });

    return formatCustomer(updated);
  }

  async getCustomerOrders(id: number, query: CustomerOrderQueryDto) {
    const customer = await this.prisma.customers.findUnique({
      where: { id },
      select: { id: true, full_name: true },
    });

    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 10));
    const skip = (page - 1) * limit;

    const where: any = {
      customer_id: id,
    };

    if (query.orderStatus && query.orderStatus.trim() !== '') {
      where.order_status = { equals: query.orderStatus.trim(), mode: 'insensitive' };
    }

    if (query.paymentStatus && query.paymentStatus.trim() !== '') {
      where.payment_status = { equals: query.paymentStatus.trim(), mode: 'insensitive' };
    }

    const [total, items] = await Promise.all([
      this.prisma.orders.count({ where }),
      this.prisma.orders.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'desc' },
        include: {
          facilities: true,
          shipments: true,
          order_items: {
            include: {
              medicines: true,
              packaging_specifications: true,
            },
          },
        },
      }),
    ]);

    return {
      items: items.map(formatCustomerOrder),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
