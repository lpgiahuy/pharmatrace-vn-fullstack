import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { authActor } from '../../../common/auth-identity';
import { workflowDatabase } from '../../../common/workflow-database';
import { CurrentUserPayload } from '../../../common/decorators/current-user.decorator';
import { PrismaService } from '../../../prisma/prisma.service';
import { ShipmentQueryDto } from './dto/shipment-query.dto';
import { ShipmentStatusDto } from './dto/shipment-status.dto';
import { ShipmentCarrierDto } from './dto/shipment-carrier.dto';
import { DeliveryProofDto } from './dto/delivery-proof.dto';
import { ReceiveReturnDto, RequestPostDeliveryReturnDto, ReturnDispositionDto } from './dto/return-intake-disposition.dto';
import { ReconcileCodDto } from './dto/cod-reconciliation.dto';
import { RecordRefundPaymentDto, ReturnRefundDto } from './dto/return-refund.dto';
import { validateInspectionUids } from '../inspection.helper';
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
      const total = await tx.shipments.count({ where });
      const data = await tx.shipments.findMany({ where, orderBy: { created_at: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit });
      const summary = codOnly ? await tx.shipments.groupBy({ by: ['cod_settlement_status'], where, _count: { _all: true }, _sum: { cod_amount: true } }) : undefined;
      return { data, pagination: { page: query.page, limit: query.limit, total }, ...(codOnly ? { summary } : {}) };
    }, authActor(user));
  }

  async shipment(id: number, user: CurrentUserPayload, codOnly = false) {
    return this.prisma.withOrder('read', async (tx) => {
      const shipment = await tx.shipments.findFirst({
        where: { id, ...(codOnly ? { cod_amount: { gt: 0 } } : {}) },
        include: { orders: { include: { order_items: true } } },
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

      let settlements: Array<{
        cashbook_id: number;
        amount: Prisma.Decimal;
        courier_fee?: Prisma.Decimal;
        adjustment_amount?: Prisma.Decimal;
        net_amount?: Prisma.Decimal;
        statement_reference?: string;
        discrepancy_amount?: Prisma.Decimal;
        discrepancy_status?: string;
        collected_by: number;
        collected_at: Date;
      }> = [];
      let statementReviews: Array<{ id: number; gross: Prisma.Decimal; fee: Prisma.Decimal; adjustment: Prisma.Decimal; net: Prisma.Decimal; statement_reference: string; status: string; recorded_by: number; approved_by: number | null; recorded_at: Date }> = [];

      if (codOnly) {
        try {
          const settlementsTableResult = await tx.$queryRaw<{ exists: boolean }[]>`
            SELECT (to_regclass('public.logistics_cod_settlements') IS NOT NULL
              AND has_table_privilege(current_user, to_regclass('public.logistics_cod_settlements'), 'SELECT')) AS exists
          `;
          if (Array.isArray(settlementsTableResult) && settlementsTableResult[0]?.exists) {
            settlements = await tx.$queryRaw`
              SELECT cashbook_id, amount, courier_fee, adjustment_amount, net_amount, statement_reference,
                     discrepancy_amount, discrepancy_status, collected_by, collected_at
              FROM public.logistics_cod_settlements
              WHERE shipment_id = ${id}
              ORDER BY collected_at DESC
            `;
          }
        } catch {
          settlements = [];
        }
        statementReviews = await tx.$queryRaw`
          SELECT id,gross,fee,adjustment,net,statement_reference,status,recorded_by,approved_by,recorded_at
          FROM public.cod_statement_reviews WHERE shipment_id = ${id} ORDER BY id DESC
        `;
      }

      const returnItems = await tx.$queryRaw<Array<{ variant_id: number; quantity: number; box_uids: string[] }>>`
        SELECT variant_id, quantity, box_uids FROM public.shipment_return_items WHERE shipment_id = ${id} ORDER BY variant_id
      `;
      const authorizedItems = await tx.$queryRaw<Array<{ variant_id: number; quantity: number; reason: string; approved_by: number; approved_at: Date }>>`
        SELECT variant_id, quantity, reason, approved_by, approved_at FROM public.shipment_return_authorizations WHERE shipment_id = ${id} ORDER BY variant_id
      `;
      const refundDecisions = await tx.$queryRaw<Array<{ goods_value: Prisma.Decimal; customer_fee: Prisma.Decimal; refund_amount: Prisma.Decimal; payment_method: string; payment_reference: string | null; approved_by: number; approved_at: Date; status: string; executed_by: number | null; executed_at: Date | null }>>`
        SELECT goods_value, customer_fee, refund_amount, payment_method, payment_reference, approved_by, approved_at, status, executed_by, executed_at
        FROM public.return_refund_decisions WHERE shipment_id = ${id}
      `;
      return { ...shipment, history, returnItems, authorizedItems, refundDecision: refundDecisions[0] || null, ...(codOnly ? { settlements, statementReviews } : {}) };
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

  async changeStatus(id: number, dto: ShipmentStatusDto, user: CurrentUserPayload) {
    if (dto.status === 'RETURNED_TO_WAREHOUSE') throw new BadRequestException('Use return intake to record the quantities physically received.');
    if (dto.status === 'DELIVERED') throw new BadRequestException('Only the customer can confirm receipt of this order. Use Proof of Delivery to confirm delivery with evidence.');
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now()) throw new BadRequestException('Event time must be valid and cannot be in the future');
    const transitions: Record<string, string[]> = {
      PENDING_PICKUP: ['PICKED_UP'],
      PICKED_UP: ['IN_TRANSIT', 'DELIVERY_FAILED'],
      IN_TRANSIT: ['DELIVERY_FAILED'],
      DELIVERY_FAILED: ['IN_TRANSIT', 'RETURN_REQUESTED'],
      RETURN_REQUESTED: ['RETURN_IN_TRANSIT'],
      RETURN_IN_TRANSIT: [],
    };
    if (dto.status === 'DELIVERY_FAILED' && !dto.reason?.trim()) throw new BadRequestException('Failure reason is required');

    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id }, include: { orders: true } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.created_at && occurredAt < shipment.created_at) throw new BadRequestException('Event time cannot be before the shipment was created');
      if (shipment.picked_up_at && occurredAt < shipment.picked_up_at) throw new BadRequestException('Event time cannot be before pickup');
      if (!transitions[shipment.shipping_status]?.includes(dto.status)) throw new BadRequestException(`Invalid shipment status transition from ${shipment.shipping_status} to ${dto.status}`);
      if (dto.status === 'PICKED_UP' && !shipment.carrier_confirmed_at) throw new BadRequestException('Enter and confirm the actual carrier tracking number before pickup');

      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${dto.reason?.trim() || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.logistics_occurred_at', ${occurredAt.toISOString()}, true)`;

      const changed = await tx.shipments.updateMany({
        where: { id, shipping_status: shipment.shipping_status },
        data: {
          shipping_status: dto.status,
          ...(dto.status === 'PICKED_UP' ? { picked_up_at: occurredAt } : {}),
          updated_at: new Date(),
        },
      });
      if (changed.count !== 1) throw new BadRequestException('Shipment status changed; retry');

      if (dto.status === 'PICKED_UP' || dto.status === 'IN_TRANSIT') {
        const previous = dto.status === 'PICKED_UP' ? 'PENDING_PICKUP' : 'PICKED_UP';
        const next = dto.status === 'PICKED_UP' ? 'PICKED_UP' : 'SHIPPING';
        if (shipment.orders.order_status === previous) {
          const updated = await tx.orders.updateMany({ where: { id: shipment.order_id, order_status: previous }, data: { order_status: next } });
          if (updated.count !== 1) throw new BadRequestException('Order status changed; retry');
        } else if (shipment.orders.order_status !== 'SHIPPING') {
          throw new BadRequestException('Order status does not match the shipment');
        }
      }

      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }

  async confirmDeliveryWithProof(id: number, dto: DeliveryProofDto, user: CurrentUserPayload) {
    if (!dto.proofType || !dto.proofReference?.trim() || !dto.deliveredToName?.trim()) {
      throw new BadRequestException('Proof type, proof reference, and delivered-to recipient name are required.');
    }
    const occurredAt = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    if (!Number.isFinite(occurredAt.getTime()) || occurredAt.getTime() > Date.now()) throw new BadRequestException('Delivery time must be valid and cannot be in the future');

    return this.prisma.withOrder('status', async (tx) => {
      const shipment = await tx.shipments.findFirst({ where: { id }, include: { orders: true } });
      if (!shipment) throw new NotFoundException('Shipment not found');

      if (shipment.shipping_status === 'DELIVERED') {
        return shipment;
      }
      if (shipment.shipping_status !== 'IN_TRANSIT') {
        throw new BadRequestException(`Cannot record delivery proof for shipment with status "${shipment.shipping_status}". Shipment must be in transit.`);
      }

      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${`Delivery evidenced by ${dto.proofType}: ${dto.deliveryNotes || ''}`.trim()}, true)`;
      await tx.$queryRaw`SELECT set_config('app.logistics_occurred_at', ${occurredAt.toISOString()}, true)`;

      const updatedShipment = await tx.shipments.updateMany({
        where: { id, shipping_status: 'IN_TRANSIT' },
        data: {
          shipping_status: 'DELIVERED',
          actual_delivery_at: occurredAt,
          proof_type: dto.proofType,
          proof_reference: dto.proofReference?.trim() || null,
          delivered_to_name: dto.deliveredToName?.trim() || null,
          delivery_notes: dto.deliveryNotes?.trim() || null,
          updated_at: new Date(),
        },
      });
      if (updatedShipment.count !== 1) throw new BadRequestException('Shipment status changed. Reload and try again.');

      if (shipment.orders.order_status === 'SHIPPING') {
        await tx.orders.updateMany({
          where: { id: shipment.order_id, order_status: 'SHIPPING' },
          data: { order_status: 'COMPLETED' },
        });
      }

      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }

  async disputeDelivery(shipmentId: number, customerId: number, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Dispute reason is required.');
    return this.prisma.withOrder('customer_receive', async (tx) => {
      const shipment = await tx.shipments.findFirst({
        where: { id: shipmentId },
        include: { orders: true },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.orders.customer_id !== customerId) throw new BadRequestException('You do not have permission to dispute this shipment');
      const rows = await tx.$queryRaw<{ result: string }[]>`SELECT public.submit_delivery_dispute(${shipment.order_id}, ${reason.trim()}) AS result`;
      if (rows[0]?.result !== 'SUBMITTED') throw new BadRequestException('Only shipped or completed orders can be disputed.');
      return { success: true, message: 'Delivery dispute submitted. Customer support will investigate.' };
    }, { id: customerId, role: 'CUSTOMER', type: 'customer' });
  }

  async requestReturn(id: number, reason: string, user: CurrentUserPayload) {
    if (!reason?.trim()) throw new BadRequestException('Return reason is required');
    return this.prisma.withOrder('status', async (tx) => {
      await tx.$queryRaw`SELECT o.id FROM public.orders o JOIN public.shipments s ON s.order_id = o.id WHERE s.id = ${id} FOR UPDATE OF o`;
      const shipment = await tx.shipments.findFirst({ where: { id } });
      if (!shipment) throw new NotFoundException('Shipment not found');

      if (shipment.shipping_status === 'DELIVERED') {
        throw new BadRequestException('Customer returns after delivery require an approved RMA. This workflow will be available in the RMA module.');
      } else if (shipment.shipping_status !== 'DELIVERY_FAILED') {
        throw new BadRequestException(`Shipment with status "${shipment.shipping_status}" cannot be returned. It must be DELIVERY_FAILED.`);
      }

      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${reason.trim()}, true)`;

      const changed = await tx.shipments.updateMany({
        where: { id, shipping_status: shipment.shipping_status },
        data: {
          shipping_status: 'RETURN_REQUESTED',
        },
      });
      if (changed.count !== 1) throw new BadRequestException('Shipment status changed; retry');
      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }

  async requestPostDeliveryReturn(id: number, dto: RequestPostDeliveryReturnDto, user: CurrentUserPayload) {
    if (!dto.reason?.trim()) throw new BadRequestException('Return reason is required');
    if (!dto.lines?.length || new Set(dto.lines.map(line => line.variantId)).size !== dto.lines.length) {
      throw new BadRequestException('Choose each returned variant once and provide its authorized quantity.');
    }
    return this.prisma.withOrder('status', async (tx) => {
      await tx.$queryRaw`SELECT o.id FROM public.orders o JOIN public.shipments s ON s.order_id = o.id WHERE s.id = ${id} FOR UPDATE OF o`;
      const shipment = await tx.shipments.findFirst({ where: { id }, include: { orders: { include: { order_items: true } } } });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.shipping_status !== 'DELIVERED') {
        throw new BadRequestException(`Post-delivery return requires shipment to be DELIVERED. Current status: ${shipment.shipping_status}`);
      }

      for (const line of dto.lines) {
        const item = shipment.orders.order_items.find(entry => entry.variant_id === line.variantId);
        if (!item || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > item.quantity) {
          throw new BadRequestException('Authorized quantities must belong to the order and not exceed purchased quantities.');
        }
        await tx.$executeRaw`INSERT INTO public.shipment_return_authorizations (shipment_id, variant_id, quantity, reason, approved_by)
          VALUES (${id}, ${line.variantId}, ${line.quantity}, ${dto.reason.trim()}, ${user.id})`;
      }

      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${`Post-delivery return: ${dto.reason.trim()}`}, true)`;

      const changed = await tx.shipments.updateMany({
        where: { id, shipping_status: 'DELIVERED' },
        data: {
          shipping_status: 'RETURN_REQUESTED',
          return_category: 'POST_DELIVERY_RMA',
          return_reason: dto.reason.trim(),
          return_qa_status: 'PENDING_INSPECTION',
          updated_at: new Date(),
        },
      });
      if (changed.count !== 1) throw new BadRequestException('Shipment status changed; retry');
      return tx.shipments.findFirst({ where: { id } });
    }, authActor(user));
  }

  async receiveReturn(id: number, dto: ReceiveReturnDto | undefined, user: CurrentUserPayload) {
    if (!dto?.receivedLines?.length) throw new BadRequestException('Enter the actual quantities received for this return.');
    if (new Set(dto.receivedLines.map(line => line.variantId)).size !== dto.receivedLines.length) {
      throw new BadRequestException('Each returned variant must appear only once.');
    }
    return this.prisma.withOrder('receive', async (tx) => {
      await tx.$queryRaw`SELECT o.id FROM public.orders o JOIN public.shipments s ON s.order_id = o.id WHERE s.id = ${id} FOR UPDATE OF o`;
      await tx.$queryRaw`SELECT o.id FROM public.orders o JOIN public.shipments s ON s.order_id = o.id WHERE s.id = ${id} FOR UPDATE OF o`;
      await tx.$queryRaw`SELECT id FROM public.shipments WHERE id = ${id} FOR UPDATE`;
      const shipment = await tx.shipments.findFirst({
        where: { id },
        include: { orders: { include: { order_items: true } } },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (!['RETURN_REQUESTED', 'RETURN_IN_TRANSIT'].includes(shipment.shipping_status)) {
        throw new BadRequestException(`Cannot receive return for shipment with status "${shipment.shipping_status}". It must be RETURN_REQUESTED or RETURN_IN_TRANSIT.`);
      }

      const orderItems = shipment.orders.order_items;
      const exportFacilityId = shipment.orders.export_facility_id;
      const authorizedLines = shipment.return_category === 'POST_DELIVERY_RMA'
        ? await tx.$queryRaw<Array<{ variant_id: number; quantity: number }>>`SELECT variant_id, quantity FROM public.shipment_return_authorizations WHERE shipment_id = ${id}`
        : [];

      if (!exportFacilityId) throw new BadRequestException('The order has no export facility.');
      for (const line of dto.receivedLines) {
        const item = orderItems.find(entry => entry.variant_id === line.variantId);
        if (!item || !Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > item.quantity) {
          throw new BadRequestException('Returned quantities must belong to the order and cannot exceed the ordered quantity.');
        }
        if (shipment.return_category === 'POST_DELIVERY_RMA' &&
          line.quantity > (authorizedLines.find(authorized => authorized.variant_id === line.variantId)?.quantity || 0)) {
          throw new BadRequestException('Received quantity exceeds the approved return authorization.');
        }
        const boxUids = line.boxUids ?? [];
        validateInspectionUids(item.assigned_uids, [{ quantity: line.quantity, uids: boxUids }], true);
        if (item.assigned_uids.length > 0) {
          const moved = await tx.medicine_boxes.updateMany({
            where: { uid: { in: boxUids }, status: { in: ['PACKAGED', 'SOLD', 'SHIPPED', 'RESERVED', 'IN_TRANSIT'] } },
            data: {
              current_facility_id: exportFacilityId,
              status: 'QUARANTINED',
            },
          });
          if (moved.count !== boxUids.length) throw new BadRequestException('Returned UID custody changed; reload and retry.');
        }
        await tx.$executeRaw`INSERT INTO public.shipment_return_items (shipment_id, variant_id, quantity, box_uids, received_by)
          VALUES (${id}, ${line.variantId}, ${line.quantity}, ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(boxUids)}::jsonb)::uuid), ${user.id})`;
        await tx.$executeRaw`SELECT public.record_quarantine_movement('SHIPMENT', ${id}, ${line.variantId}, 'IN', ${line.quantity})`;
      }

      await tx.$queryRaw`SELECT set_config('app.logistics_reason', ${'Returned shipment physically received at warehouse; quarantined for inspection.'}, true)`;

      await tx.shipments.update({
        where: { id },
        data: {
          shipping_status: 'RETURNED_TO_WAREHOUSE',
          return_received_at: new Date(),
          return_qa_status: 'PENDING_INSPECTION',
          delivery_notes: dto?.notes ? `Intake: ${dto.notes}` : shipment.delivery_notes,
          updated_at: new Date(),
        },
      });

      return tx.shipments.findFirst({ where: { id }, include: { orders: true } });
    }, authActor(user));
  }

  async dispositionReturn(id: number, dto: ReturnDispositionDto, user: CurrentUserPayload) {
    if (!dto.decision || !dto.qaNotes?.trim() || !dto.lines || dto.lines.length === 0) {
      throw new BadRequestException('Disposition decision, QA notes, and line items assessment are required.');
    }
    if (new Set(dto.lines.map((line) => line.variantId)).size !== dto.lines.length) {
      throw new BadRequestException('Each returned variant must appear only once.');
    }

    return this.prisma.withOrder('status', async (tx) => {
      await tx.$queryRaw`SELECT o.id FROM public.orders o JOIN public.shipments s ON s.order_id = o.id WHERE s.id = ${id} FOR UPDATE OF o`;
      await tx.$queryRaw`SELECT o.id FROM public.orders o JOIN public.shipments s ON s.order_id = o.id WHERE s.id = ${id} FOR UPDATE OF o`;
      await tx.$queryRaw`SELECT id FROM public.shipments WHERE id = ${id} FOR UPDATE`;
      const shipment = await tx.shipments.findFirst({
        where: { id },
        include: { orders: { include: { order_items: true } } },
      });
      if (!shipment) throw new NotFoundException('Shipment not found');
      if (shipment.shipping_status !== 'RETURNED_TO_WAREHOUSE') {
        throw new BadRequestException(`Cannot perform QA disposition for shipment with status "${shipment.shipping_status}". Goods must be received at warehouse first.`);
      }
      if (shipment.return_qa_status === 'COMPLETED') {
        throw new BadRequestException('Quality assessment disposition has already been finalized for this return.');
      }

      const exportFacilityId = shipment.orders.export_facility_id;
      const receivedLines = await tx.$queryRaw<Array<{ variant_id: number; quantity: number; box_uids: string[] }>>`
        SELECT variant_id, quantity, box_uids FROM public.shipment_return_items WHERE shipment_id = ${id} ORDER BY variant_id
      `;
      if (!exportFacilityId || receivedLines.length === 0 || dto.lines.length !== receivedLines.length) {
        throw new BadRequestException('Inspect every returned variant at its export facility.');
      }
      for (const line of dto.lines) {
        const item = receivedLines.find(oi => oi.variant_id === line.variantId);
        if (!item) throw new BadRequestException('Variant does not belong to this order.');
        validateInspectionUids(item.box_uids, [
          { quantity: line.passQuantity, uids: line.restockBoxUids },
          { quantity: line.failQuantity, uids: line.scrapBoxUids },
        ]);
      }
      const passed = dto.lines.reduce((sum, line) => sum + line.passQuantity, 0);
      const failed = dto.lines.reduce((sum, line) => sum + line.failQuantity, 0);
      if ((dto.decision === 'RESTOCK' && failed > 0) || (dto.decision === 'SCRAP' && passed > 0) ||
          (dto.decision === 'PARTIAL_RESTOCK' && (passed === 0 || failed === 0))) {
        throw new BadRequestException('Disposition decision does not match inspected quantities.');
      }
      let totalPassed = 0;
      let totalFailed = 0;

      for (const line of dto.lines) {
        const orderItem = shipment.orders.order_items.find((oi) => oi.variant_id === line.variantId);
        if (!orderItem) throw new BadRequestException(`Variant #${line.variantId} does not belong to this shipment order.`);
        const received = receivedLines.find(item => item.variant_id === line.variantId)!;

        if (line.passQuantity + line.failQuantity !== received.quantity) {
          throw new BadRequestException(`Line quantities (${line.passQuantity} pass + ${line.failQuantity} fail) do not equal returned item quantity ${received.quantity}.`);
        }

        totalPassed += line.passQuantity;
        totalFailed += line.failQuantity;

        // Passed QA: return to sellable stock
        if (line.passQuantity > 0 && exportFacilityId) {
          await tx.$executeRaw`SELECT public.record_quarantine_movement('SHIPMENT', ${id}, ${line.variantId}, 'RESTOCK', ${line.passQuantity})`;
          const inventory = await tx.inventories.upsert({
            where: {
              facility_id_variant_id: {
                facility_id: exportFacilityId,
                variant_id: line.variantId,
              },
            },
            update: {
              stock_quantity: { increment: line.passQuantity },
              updated_at: new Date(),
            },
            create: {
              facility_id: exportFacilityId,
              variant_id: line.variantId,
              stock_quantity: line.passQuantity,
              reserved_quantity: 0,
              updated_at: new Date(),
            },
          });

          if (line.restockBoxUids && line.restockBoxUids.length > 0) {
            const changed = await tx.medicine_boxes.updateMany({
              where: { uid: { in: line.restockBoxUids }, current_facility_id: exportFacilityId, status: 'QUARANTINED' },
              data: { status: 'IN_STOCK', current_facility_id: exportFacilityId },
            });
            if (changed.count !== line.restockBoxUids.length) throw new BadRequestException('Restock UID custody changed; retry.');
          }

          await tx.inventory_logs.create({
            data: {
              facility_id: exportFacilityId,
              medicine_id: orderItem.medicine_id,
              variant_id: line.variantId,
              stock_bucket: 'ON_HAND',
              performed_by_id: user.id,
              transaction_type: 'RETURN_RESTOCK',
              quantity_changed: line.passQuantity,
              previous_quantity: inventory.stock_quantity - line.passQuantity,
              new_quantity: inventory.stock_quantity,
              reference_code: shipment.tracking_number,
              note: `Restocked ${line.passQuantity} unit(s) passed QA from return #${shipment.tracking_number}`,
            },
          });
        }

        if (line.failQuantity > 0 && exportFacilityId) {
          await tx.$executeRaw`SELECT public.record_quarantine_movement('SHIPMENT', ${id}, ${line.variantId}, 'FAILED_QA', ${line.failQuantity})`;
          if (line.scrapBoxUids && line.scrapBoxUids.length > 0) {
            const changed = await tx.medicine_boxes.updateMany({
              where: { uid: { in: line.scrapBoxUids }, current_facility_id: exportFacilityId, status: 'QUARANTINED' },
              data: { status: 'DAMAGED', current_facility_id: exportFacilityId },
            });
            if (changed.count !== line.scrapBoxUids.length) throw new BadRequestException('Scrap UID custody changed; retry.');
          }

        }
      }

      const finalDisposition = dto.decision;
      const returnedQuantity = totalPassed + totalFailed;
      const orderedQuantity = shipment.orders.order_items.reduce((sum, item) => sum + item.quantity, 0);
      const orderReturnStatus = returnedQuantity < orderedQuantity ? 'PARTIALLY_RETURNED' : 'RETURNED';

      await tx.shipments.update({
        where: { id },
        data: {
          return_qa_status: 'COMPLETED',
          return_disposition: finalDisposition,
          return_qa_notes: dto.qaNotes.trim(),
          return_disposed_at: new Date(),
          updated_at: new Date(),
        },
      });

      await tx.orders.updateMany({
        where: { id: shipment.order_id },
        data: { order_status: orderReturnStatus },
      });

      return tx.shipments.findFirst({ where: { id }, include: { orders: true } });
    }, authActor(user));
  }

  async reconcileCod(id: number, dto: ReconcileCodDto, user: CurrentUserPayload) {
    if (!dto.statementReference?.trim() ||
        ![dto.grossAmount, dto.courierFee, dto.netAmount, dto.adjustmentAmount ?? 0].every(Number.isFinite) ||
        [dto.grossAmount, dto.courierFee, dto.netAmount].some(value => value < 0)) {
      throw new BadRequestException('Valid COD amounts and carrier statement reference are required.');
    }
    if ([dto.grossAmount, dto.courierFee, dto.netAmount, dto.adjustmentAmount ?? 0].some(value => Math.abs(value * 100 - Math.round(value * 100)) > 1e-6)) {
      throw new BadRequestException('COD amounts may have at most 2 decimal places.');
    }
    return workflowDatabase(this.prisma.withOrder('read', async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`
        SELECT public.submit_cod_statement(${id}, ${dto.grossAmount}::numeric, ${dto.courierFee}::numeric,
          ${dto.adjustmentAmount ?? 0}::numeric, ${dto.netAmount}::numeric,
          ${dto.statementReference.trim()}::text, ${dto.discrepancyNote?.trim() || null}::text) AS result
      `;
      if (!rows[0]?.result) throw new BadRequestException('COD requires a delivered shipment with a positive amount.');
      return rows[0].result;
    }, authActor(user)));
  }

  async approveCodStatement(id: number, statementId: number, user: CurrentUserPayload) {
    return workflowDatabase(this.prisma.withOrder('read', async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`SELECT public.approve_cod_statement(${id}, ${statementId}) AS result`;
      return rows[0].result;
    }, authActor(user)));
  }

  async approveReturnRefund(id: number, dto: ReturnRefundDto, user: CurrentUserPayload) {
    if (!Number.isFinite(dto.goodsValue) || !Number.isFinite(dto.customerFee) || dto.goodsValue <= 0 ||
      dto.customerFee < 0 || dto.customerFee >= dto.goodsValue || !dto.reason?.trim()) {
      throw new BadRequestException('Refund value, fee, payment method and reason are required.');
    }
    return this.prisma.withOrder('status', async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`
        SELECT public.approve_return_refund(${id}, ${dto.goodsValue}::numeric, ${dto.customerFee}::numeric,
          ${dto.paymentMethod}::text, ${dto.reason.trim()}::text) AS result
      `;
      return rows[0].result;
    }, authActor(user));
  }

  async recordRefundPayment(id: number, dto: RecordRefundPaymentDto, user: CurrentUserPayload) {
    if (!dto.paymentReference?.trim()) throw new BadRequestException('Refund payment reference is required.');
    return this.prisma.withOrder('status', async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`
        SELECT public.record_approved_refund(${id}, ${dto.paymentReference.trim()}::text) AS result
      `;
      return rows[0].result;
    }, authActor(user));
  }

  collect(_id: number, _user: CurrentUserPayload): Promise<never> {
    return Promise.reject(new BadRequestException('Carrier statement and actual remittance evidence are required. Use COD reconciliation.'));
  }
}
