import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShipmentQueryDto } from './dto/shipment-query.dto';
import { ShipmentStatusDto } from './dto/shipment-status.dto';
import { ShipmentCarrierDto } from './dto/shipment-carrier.dto';
import { LogisticsHistoryEvent } from '../logistics.types';

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
      const shipment = await tx.shipments.findFirst({
        where: { id, ...(codOnly ? { cod_amount: { gt: 0 } } : {}) },
        include: { orders: true },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');

      let history: LogisticsHistoryEvent[] = [];
      {
        const [eventsTable] = await tx.$queryRaw<{ exists: boolean }[]>`
          SELECT (to_regclass('public.logistics_events') IS NOT NULL
            AND has_table_privilege(current_user, to_regclass('public.logistics_events'), 'SELECT')) AS exists
        `;
        if (eventsTable?.exists) {
          history = await tx.$queryRaw`SELECT e.old_status, e.new_status, e.reason, e.actor_id,
            COALESCE(e.actor_type, CASE WHEN emp.id IS NOT NULL THEN 'employee' WHEN cust.id IS NOT NULL THEN 'customer' END) AS actor_type,
            COALESCE(e.actor_name, a.actor_name, emp.full_name, cust.full_name) AS actor_name,
            COALESCE(e.actor_role, a.actor_role, emp.role, 'CUSTOMER') AS actor_role,
            e.created_at, e.occurred_at
            FROM public.logistics_events e
            LEFT JOIN LATERAL public.logistics_event_actor(e.id) a ON true
            LEFT JOIN public.employees emp ON emp.id = e.actor_id
            LEFT JOIN public.customers cust ON cust.id = e.actor_id AND e.actor_type = 'customer'
            WHERE e.shipment_id = ${id} ORDER BY e.created_at, e.id`;
        }
      }

      let settlements: Array<{ cashbook_id: number; amount: Prisma.Decimal; collected_by: number; collected_at: Date }> = [];
      if (codOnly) {
        {
          const [settlementsTable] = await tx.$queryRaw<{ exists: boolean }[]>`
            SELECT (to_regclass('public.logistics_cod_settlements') IS NOT NULL
              AND has_table_privilege(current_user, to_regclass('public.logistics_cod_settlements'), 'SELECT')) AS exists
          `;
          if (settlementsTable?.exists) {
            settlements = await tx.$queryRaw`SELECT cashbook_id, amount, collected_by, collected_at FROM public.logistics_cod_settlements WHERE shipment_id = ${id}`;
          } else {
            settlements = [];
          }
        }
      }

      return { ...shipment, history, ...(codOnly ? { settlements } : {}) };
    }, authActor(user));
  }

  async updateCarrier(id: number, dto: ShipmentCarrierDto, user: CurrentUserPayload) {
    if (!dto.courierName?.trim() || !dto.trackingNumber?.trim()) {
      throw new BadRequestException('Choose a carrier and enter its tracking number');
    }
    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.shipping_status !== 'PENDING_PICKUP') throw new BadRequestException('Carrier details can only be changed before pickup');
      try {
        const changed = await tx.shipments.updateMany({
          where: { id, shipping_status: 'PENDING_PICKUP' },
          data: { courier_name: dto.courierName.trim().toUpperCase(), tracking_number: dto.trackingNumber.trim(), carrier_confirmed_at: new Date(), updated_at: new Date() },
        });
        if (changed.count !== 1) throw new BadRequestException('Shipment changed. Reload before editing');
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new BadRequestException('This carrier tracking number is already registered');
        throw error;
      }
      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }

  async collect(id: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      const [procedure] = await tx.$queryRaw<{ executable: boolean }[]>`
        SELECT (to_regprocedure('public.collect_shipment_cod(integer)') IS NOT NULL
          AND has_function_privilege(current_user, to_regprocedure('public.collect_shipment_cod(integer)'), 'EXECUTE')) AS executable
      `;
      if (!procedure?.executable) throw new ServiceUnavailableException('COD setup is not ready. Apply the Logistics database upgrade before collecting.');
      // The procedure locks the shipment and returns the existing receipt on retry.
      // Never fall back to another cashbook write after an error or an empty result.
      const result = await tx.$queryRaw<{ cashbook_id: number | null }[]>`SELECT public.collect_shipment_cod(${id}) AS cashbook_id`;
      const cashbookId = result[0]?.cashbook_id;
      if (!cashbookId) throw new BadRequestException('COD requires a completed delivery and an unsettled full payment. Check the collection history.');
      return { shipmentId: id, cashbookId };
    }, authActor(user));
  }

  async changeStatus(id: number, dto: ShipmentStatusDto, user: CurrentUserPayload) {
    if (dto.status === 'DELIVERED') throw new BadRequestException('Only the customer can confirm receipt of this order.');
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now()) throw new BadRequestException('Event time must be valid and cannot be in the future');
    const transitions: Record<string, string[]> = {
      PENDING_PICKUP: ['PICKED_UP'], PICKED_UP: ['IN_TRANSIT', 'DELIVERY_FAILED'],
      IN_TRANSIT: ['DELIVERED', 'DELIVERY_FAILED'], DELIVERY_FAILED: ['IN_TRANSIT'],
      RETURN_REQUESTED: ['RETURN_IN_TRANSIT'], RETURN_IN_TRANSIT: ['RETURNED_TO_WAREHOUSE'],
    };
    if (dto.status === 'DELIVERY_FAILED' && !dto.reason?.trim()) throw new BadRequestException('Failure reason is required');
    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id }, include: { orders: true } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.created_at && occurredAt < shipment.created_at) throw new BadRequestException('Event time cannot be before the shipment was created');
      if (shipment.picked_up_at && occurredAt < shipment.picked_up_at) throw new BadRequestException('Event time cannot be before pickup');
      if (!transitions[shipment.shipping_status]?.includes(dto.status)) throw new BadRequestException('Invalid shipment status transition');
      if (dto.status === 'PICKED_UP' && !shipment.carrier_confirmed_at) throw new BadRequestException('Enter and confirm the actual carrier tracking number before pickup');
      if (dto.status === 'DELIVERED' && shipment.orders.order_status !== 'SHIPPING') throw new BadRequestException('Order is not shipping');
      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${dto.reason?.trim() || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.logistics_occurred_at', ${occurredAt.toISOString()}, true)`;
      const changed = await tx.shipments.updateMany({
        where: { id, shipping_status: shipment.shipping_status },
        data: { shipping_status: dto.status, ...(dto.status === 'DELIVERED' ? { actual_delivery_at: occurredAt } : {}), ...(dto.status === 'PICKED_UP' ? { picked_up_at: occurredAt } : {}), updated_at: new Date() },
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
      if (shipment.shipping_status === 'DELIVERED') throw new BadRequestException('Customer returns after delivery require an approved RMA. This workflow will be available in the RMA module.');
      if (shipment.shipping_status !== 'DELIVERY_FAILED') throw new BadRequestException('Shipment cannot be returned');
      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${reason.trim()}, true)`;
      const changed = await tx.shipments.updateMany({ where: { id, shipping_status: shipment.shipping_status }, data: { shipping_status: 'RETURN_REQUESTED' } });
      if (changed.count !== 1) throw new BadRequestException('Shipment status changed; retry');
      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }
}
