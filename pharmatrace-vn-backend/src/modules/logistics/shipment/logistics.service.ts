import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShipmentQueryDto } from './dto/shipment-query.dto';
import { ShipmentStatusDto } from './dto/shipment-status.dto';

@Injectable()
export class LogisticsService {
  constructor(private readonly prisma: PrismaService) {}

  async shipments(query: ShipmentQueryDto, user: CurrentUserPayload, codOnly = false) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) throw new BadRequestException('Invalid date range');
    const where: Prisma.shipmentsWhereInput = {
      ...(codOnly ? { cod_amount: { gt: 0 } } : {}),
      ...(query.status ? (codOnly ? { cod_settlement_status: query.status } : { shipping_status: query.status }) : {}),
      ...(query.courier ? { courier_name: query.courier } : {}),
      ...(from || to ? { created_at: { gte: from, lte: to } } : {}),
    };
    return this.prisma.withOrder('read', async (tx) => {
      const [total, data, summary] = await Promise.all([
        tx.shipments.count({ where }),
        tx.shipments.findMany({ where, orderBy: { created_at: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
        codOnly ? tx.shipments.groupBy({ by: ['cod_settlement_status'], where, _count: { _all: true }, _sum: { cod_amount: true } }) : Promise.resolve(undefined),
      ]);
      return { data, pagination: { page: query.page, limit: query.limit, total }, ...(codOnly ? { summary } : {}) };
    }, authActor(user));
  }

  async shipment(id: number, user: CurrentUserPayload, codOnly = false) {
    return this.prisma.withOrder('read', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id, ...(codOnly ? { cod_amount: { gt: 0 } } : {}) } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      const history = await tx.$queryRaw`SELECT old_status, new_status, reason, actor_id, created_at FROM public.logistics_events WHERE shipment_id = ${id} ORDER BY created_at, id`;
      const settlements = codOnly ? await tx.$queryRaw`SELECT cashbook_id, amount, collected_by, collected_at FROM public.logistics_cod_settlements WHERE shipment_id = ${id}` : undefined;
      return { ...shipment, history, ...(codOnly ? { settlements } : {}) };
    }, authActor(user));
  }

  async collect(id: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.shipping_status !== 'DELIVERED' || shipment.cod_settlement_status !== 'UNSETTLED' || !shipment.cod_amount.gt(0)) {
        throw new BadRequestException('Shipment COD cannot be collected');
      }
      const result = await tx.$queryRaw<{ cashbook_id: number | null }[]>`SELECT public.collect_shipment_cod(${id}) AS cashbook_id`;
      if (!result[0]?.cashbook_id) throw new BadRequestException('Shipment COD cannot be collected');
      return { shipmentId: id, cashbookId: result[0].cashbook_id };
    }, authActor(user));
  }

  async changeStatus(id: number, dto: ShipmentStatusDto, user: CurrentUserPayload) {
    const transitions: Record<string, string[]> = {
      PENDING_PICKUP: ['PICKED_UP'], PICKED_UP: ['IN_TRANSIT', 'DELIVERY_FAILED'],
      IN_TRANSIT: ['DELIVERED', 'DELIVERY_FAILED'], DELIVERY_FAILED: ['IN_TRANSIT'],
      RETURN_REQUESTED: ['RETURN_IN_TRANSIT'], RETURN_IN_TRANSIT: ['RETURNED_TO_WAREHOUSE'],
    };
    if (dto.status === 'DELIVERY_FAILED' && !dto.reason?.trim()) throw new BadRequestException('Failure reason is required');
    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id }, include: { orders: true } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (!transitions[shipment.shipping_status]?.includes(dto.status)) throw new BadRequestException('Invalid shipment status transition');
      if (dto.status === 'DELIVERED' && shipment.orders.order_status !== 'SHIPPING') throw new BadRequestException('Order is not shipping');
      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${dto.reason?.trim() || ''}, true)`;
      const changed = await tx.shipments.updateMany({
        where: { id, shipping_status: shipment.shipping_status },
        data: { shipping_status: dto.status, ...(dto.status === 'DELIVERED' ? { actual_delivery_at: new Date() } : {}) },
      });
      if (changed.count !== 1) throw new BadRequestException('Shipment status changed; retry');
      if (dto.status === 'DELIVERED') {
        const updated = await tx.orders.updateMany({ where: { id: shipment.order_id, order_status: 'SHIPPING' }, data: { order_status: 'COMPLETED' } });
        if (updated.count !== 1) throw new BadRequestException('Order status changed; retry');
      }
      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }

  async requestReturn(id: number, reason: string, user: CurrentUserPayload) {
    if (!reason.trim()) throw new BadRequestException('Return reason is required');
    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (!['DELIVERED', 'DELIVERY_FAILED'].includes(shipment.shipping_status)) throw new BadRequestException('Shipment cannot be returned');
      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${reason.trim()}, true)`;
      const changed = await tx.shipments.updateMany({ where: { id, shipping_status: shipment.shipping_status }, data: { shipping_status: 'RETURN_REQUESTED' } });
      if (changed.count !== 1) throw new BadRequestException('Shipment status changed; retry');
      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }
}
