import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { workflowDatabase } from "../../common/workflow-database";
import { authActor, normalizeRole } from "../../common/auth-identity";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { OrderQueryDto } from "./dto/order-query.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { PackOrderDto } from "./dto/pack-order.dto";
import { OnlinePaymentDto, PaymentExceptionDto, ResolvePaymentExceptionDto } from "./dto/online-payment.dto";
import { FulfillmentPolicyDto } from './dto/fulfillment-policy.dto';
import { ApproveCancellationRefundDto, RecordCancellationRefundDto, ResolveDeliveryDisputeDto } from './dto/order-resolution.dto';
import { CurrentUserPayload } from "../../common/decorators/current-user.decorator";
import {
  ORDER_DETAILS_INCLUDE,
  STATUS_DB_MAPPINGS,
  formatOrder,
  isBoxUnit,
  normalizeOrderStatus,
  releaseOrderReservations,
  AVAILABLE_BOX_STATUSES,
} from "./helpers/order.helper";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["WAITING_INTERNAL_TRANSFER", "PROCESSING", "CANCELLED"],
  WAITING_INTERNAL_TRANSFER: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPING", "CANCELLED"],
  SHIPPING: ["COMPLETED"],
  COMPLETED: ["RETURNED", "PARTIALLY_RETURNED"],
  CANCELLED: [],
  RETURNED: [],
  PARTIALLY_RETURNED: [],
};

@Injectable()
export class AdminOrderService {
  constructor(private readonly prisma: PrismaService) { }

  async getOrderResolution(id: number, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => {
      const order = await tx.orders.findFirst({ where: this.orderAccessWhere(id, user), select: { id: true } });
      if (!order) throw new NotFoundException('Order not found');
      const cancellations = await tx.$queryRaw<Array<{
        order_id: number;
        reason: string;
        cancelled_by: number;
        cancelled_at: Date;
        cancelled_by_name?: string | null;
      }>>`
        SELECT c.*, e.full_name AS cancelled_by_name
        FROM public.staff_order_cancellations c
        LEFT JOIN public.employees e ON e.id = c.cancelled_by
        WHERE c.order_id = ${id}
      `;
      const disputes = await tx.$queryRaw<Array<{
        order_id: number;
        reason: string;
        opened_by: number | null;
        opened_at: Date;
        outcome: string | null;
        resolution_reason: string | null;
        resolved_by: number | null;
        resolved_at: Date | null;
        resolved_by_name?: string | null;
      }>>`
        SELECT d.*, e.full_name AS resolved_by_name
        FROM public.delivery_disputes d
        LEFT JOIN public.employees e ON e.id = d.resolved_by
        WHERE d.order_id = ${id}
      `;
      const refunds = await tx.$queryRaw<Array<{
        order_id: number;
        amount: any;
        payment_method: string;
        reason: string;
        approved_by: number;
        approved_at: Date;
        payment_reference: string | null;
        executed_by: number | null;
        executed_at: Date | null;
        cashbook_id: number | null;
        approved_by_name?: string | null;
        executed_by_name?: string | null;
      }>>`
        SELECT r.*, ea.full_name AS approved_by_name, ee.full_name AS executed_by_name
        FROM public.cancellation_refunds r
        LEFT JOIN public.employees ea ON ea.id = r.approved_by
        LEFT JOIN public.employees ee ON ee.id = r.executed_by
        WHERE r.order_id = ${id}
      `;

      const missingStaffIds = new Set<number>();
      for (const c of cancellations) {
        if (!c.cancelled_by_name && c.cancelled_by) missingStaffIds.add(c.cancelled_by);
      }
      for (const d of disputes) {
        if (!d.resolved_by_name && d.resolved_by) missingStaffIds.add(d.resolved_by);
      }
      for (const r of refunds) {
        if (!r.approved_by_name && r.approved_by) missingStaffIds.add(r.approved_by);
        if (!r.executed_by_name && r.executed_by) missingStaffIds.add(r.executed_by);
      }

      if (missingStaffIds.size > 0) {
        try {
          const staffRows = await this.prisma.employees.findMany({
            where: { id: { in: Array.from(missingStaffIds) } },
            select: { id: true, full_name: true },
          });
          const staffMap = new Map(staffRows.map(s => [s.id, s.full_name]));
          for (const c of cancellations) {
            if (!c.cancelled_by_name && c.cancelled_by && staffMap.has(c.cancelled_by)) {
              c.cancelled_by_name = staffMap.get(c.cancelled_by);
            }
          }
          for (const d of disputes) {
            if (!d.resolved_by_name && d.resolved_by && staffMap.has(d.resolved_by)) {
              d.resolved_by_name = staffMap.get(d.resolved_by);
            }
          }
          for (const r of refunds) {
            if (!r.approved_by_name && r.approved_by && staffMap.has(r.approved_by)) {
              r.approved_by_name = staffMap.get(r.approved_by);
            }
            if (!r.executed_by_name && r.executed_by && staffMap.has(r.executed_by)) {
              r.executed_by_name = staffMap.get(r.executed_by);
            }
          }
        } catch {
          // ignore fallback error
        }
      }

      return { cancellations, disputes, refunds };
    });
  }

  async resolveDeliveryDispute(id: number, dto: ResolveDeliveryDisputeDto, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`SELECT public.resolve_delivery_dispute(${id},${dto.outcome}::text,${dto.reason.trim()}::text) AS result`;
      return rows[0]?.result;
    });
  }

  async approveCancellationRefund(id: number, dto: ApproveCancellationRefundDto, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`SELECT public.approve_cancellation_refund(${id},${dto.amount}::numeric,${dto.paymentMethod}::text,${dto.reason.trim()}::text) AS result`;
      return rows[0]?.result;
    });
  }

  async recordCancellationRefund(id: number, dto: RecordCancellationRefundDto, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`SELECT public.record_cancellation_refund(${id},${dto.amount}::numeric,${dto.paymentReference.trim()}::text) AS result`;
      return rows[0]?.result;
    });
  }

  async getPaymentExceptions(id: number, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => {
      const rows = await tx.$queryRaw<Array<any>>`
        SELECT p.*,
          ea.full_name AS approved_by_name,
          coalesce((
            SELECT jsonb_agg(jsonb_build_object(
              'id', a.id,
              'exception_id', a.exception_id,
              'action', a.action,
              'amount', a.amount,
              'reference', a.reference,
              'actor_id', a.actor_id,
              'actor_name', em.full_name,
              'reason', a.reason,
              'created_at', a.created_at
            ) ORDER BY a.id)
            FROM public.payment_exception_actions a
            LEFT JOIN public.employees em ON em.id = a.actor_id
            WHERE a.exception_id=p.id
          ),'[]'::jsonb) AS actions
        FROM public.payment_exceptions p
        LEFT JOIN public.employees ea ON ea.id = p.approved_by
        WHERE p.order_id=${id} ORDER BY p.id
      `;

      const missingStaffIds = new Set<number>();
      for (const p of rows) {
        if (!p.approved_by_name && p.approved_by) missingStaffIds.add(p.approved_by);
        if (Array.isArray(p.actions)) {
          for (const a of p.actions) {
            if (!a.actor_name && a.actor_id) missingStaffIds.add(a.actor_id);
          }
        }
      }
      if (missingStaffIds.size > 0) {
        try {
          const staffRows = await this.prisma.employees.findMany({
            where: { id: { in: Array.from(missingStaffIds) } },
            select: { id: true, full_name: true },
          });
          const staffMap = new Map(staffRows.map(s => [s.id, s.full_name]));
          for (const p of rows) {
            if (!p.approved_by_name && p.approved_by && staffMap.has(p.approved_by)) {
              p.approved_by_name = staffMap.get(p.approved_by);
            }
            if (Array.isArray(p.actions)) {
              for (const a of p.actions) {
                if (!a.actor_name && a.actor_id && staffMap.has(a.actor_id)) {
                  a.actor_name = staffMap.get(a.actor_id);
                }
              }
            }
          }
        } catch {
          // ignore fallback error
        }
      }

      return rows;
    });
  }

  async recordPaymentException(id: number, dto: PaymentExceptionDto, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => {
      const rows = await tx.$queryRaw<{ id: number }[]>`SELECT public.record_payment_exception(${id}, ${dto.amount}::numeric,
        ${dto.paymentMethod}::text, ${dto.paymentReference.trim()}::text, ${dto.reason.trim()}::text) AS id`;
      return rows[0];
    });
  }

  async resolvePaymentException(id: number, receiptId: number, dto: ResolvePaymentExceptionDto, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`SELECT public.resolve_payment_exception(${id}, ${receiptId},
        ${dto.action}::text, ${dto.amount ?? null}::numeric, ${dto.reference.trim()}::text, ${dto.reason.trim()}::text) AS result`;
      return rows[0]?.result;
    });
  }

  async getFulfillmentPolicies(user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, async tx => ({
      policies: await tx.$queryRaw`SELECT p.*, f.facility_name, s.facility_name AS selling_facility_name
        FROM public.facility_fulfillment_policy p JOIN public.facilities f ON f.id=p.facility_id
        JOIN public.facilities s ON s.id=p.selling_facility_id ORDER BY p.facility_id`,
      requirements: await tx.$queryRaw`SELECT r.*, m.medicine_name FROM public.medicine_transport_requirements r
        JOIN public.medicines m ON m.id=r.medicine_id ORDER BY r.medicine_id`,
      warehouseLinks: await tx.$queryRaw`SELECT warehouse_id,pharmacy_id FROM public.warehouse_selling_pharmacies ORDER BY warehouse_id,pharmacy_id`,
    }));
  }

  async saveFulfillmentPolicy(id: number, dto: FulfillmentPolicyDto, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, tx => tx.$executeRaw`SELECT public.save_fulfillment_policy(${id}, ${dto.sellingFacilityId},
      ${dto.enabled}, ${dto.opensMinute}, ${dto.closesMinute}, ${dto.weekdays}::integer[], ${dto.dailyCapacity},
      ${dto.radiusKm}::numeric, ${dto.transportConditions.map(value => value.trim())}::text[])`);
  }

  async saveTransportRequirement(id: number, condition: string, user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, tx => tx.$executeRaw`SELECT public.save_transport_requirement(${id}, ${condition.trim()}::text)`);
  }

  async setWarehouseSellingPharmacies(id: number, pharmacyIds: number[], user: CurrentUserPayload) {
    return this.executeWithStaffContext(user, tx => tx.$executeRaw`SELECT public.set_warehouse_selling_pharmacies(${id}, ${pharmacyIds}::integer[])`);
  }

  private getFacilityScope(user: CurrentUserPayload): number | null {
    const role = (user?.role || "").toString().toLowerCase().replace(/_/g, "");

    if (["superadmin", "accountant", "financemanager"].includes(role)) {
      return null;
    }

    const facilityId = Number(user?.facilityId);
    if (!Number.isInteger(facilityId) || facilityId <= 0) {
      throw new ForbiddenException("Staff account is not assigned to a facility.");
    }

    return facilityId;
  }

  private orderAccessWhere(orderId: number, user: CurrentUserPayload) {
    const facilityId = this.getFacilityScope(user);
    return facilityId === null ? { id: orderId } : { id: orderId, export_facility_id: facilityId };
  }

  private async executeWithStaffContext<T>(
    user: CurrentUserPayload,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return workflowDatabase(this.prisma.withOrder('read', operation, authActor(user)));
  }

  async adminGetAllOrders(query: OrderQueryDto, user: CurrentUserPayload) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const facilityId = this.getFacilityScope(user);
    const where: any = facilityId === null ? {} : { export_facility_id: facilityId };
    if (query.status && query.status !== "ALL") {
      const canonical = normalizeOrderStatus(query.status);
      const list = STATUS_DB_MAPPINGS[canonical] || [query.status];
      where.order_status = { in: list };
    }

    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      where.OR = [
        { order_code: { contains: term, mode: "insensitive" } },
        { recipient_name: { contains: term, mode: "insensitive" } },
        { recipient_phone: { contains: term, mode: "insensitive" } },
      ];
    }

    const { total, orders } = await this.executeWithStaffContext(user, async (tx) => {
      const total = await tx.orders.count({ where });
      const orders = await tx.orders.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: query.sort === "oldest" ? "asc" : "desc" },
        include: {
          customers: { select: { id: true, full_name: true, email: true, phone_number: true } },
          ...ORDER_DETAILS_INCLUDE,
        },
      });
      return { total, orders };
    });

    return {
      items: orders.map((o) => formatOrder(o)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }

  async adminGetOrderById(orderId: number, user: CurrentUserPayload) {
    const { order, cancellationReason } = await this.executeWithStaffContext(user, async (tx) => {
      const order = await tx.orders.findFirst({
        where: this.orderAccessWhere(orderId, user),
        include: {
          customers: { select: { id: true, full_name: true, email: true, phone_number: true } },
          ...ORDER_DETAILS_INCLUDE,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      let cancellationReason: string | null = null;
      if (order.order_status === 'CANCELLED') {
        try {
          const staffCancel = await tx.$queryRaw<{ reason: string }[]>`
            SELECT reason FROM public.staff_order_cancellations WHERE order_id = ${orderId} LIMIT 1
          `;
          if (staffCancel[0]?.reason) {
            cancellationReason = staffCancel[0].reason;
          } else {
            const customerCancel = await tx.$queryRaw<{ reason_details: string | null; reason_code: string }[]>`
              SELECT reason_code, reason_details FROM public.order_cancellation_reasons WHERE order_id = ${orderId} LIMIT 1
            `;
            if (customerCancel[0]) {
              cancellationReason = customerCancel[0].reason_details?.trim() || customerCancel[0].reason_code;
            }
          }
        } catch {
          // ignore lookup error
        }
      }

      return { order, cancellationReason };
    });

    return formatOrder(order, cancellationReason);
  }

  async getOnlinePayments(orderId: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('read', async tx => {
      const order = await tx.orders.findFirst({ where: this.orderAccessWhere(orderId, user), select: { id: true } });
      if (!order) throw new NotFoundException('Order not found');
      const rows = await tx.$queryRaw<Array<{
        id: number;
        amount: Prisma.Decimal;
        payment_method: string;
        payment_reference: string;
        status: string;
        recorded_by: number;
        recorded_at: Date;
        approved_by: number | null;
        approved_at: Date | null;
        rejected_by: number | null;
        rejection_reason: string | null;
        recorded_by_name?: string | null;
        approved_by_name?: string | null;
        rejected_by_name?: string | null;
      }>>`
        SELECT
          p.id, p.amount, p.payment_method, p.payment_reference, p.status,
          p.recorded_by, p.recorded_at, p.approved_by, p.approved_at, p.rejected_by, p.rejection_reason,
          er.full_name AS recorded_by_name,
          ea.full_name AS approved_by_name,
          ej.full_name AS rejected_by_name
        FROM public.online_payment_receipts p
        LEFT JOIN public.employees er ON er.id = p.recorded_by
        LEFT JOIN public.employees ea ON ea.id = p.approved_by
        LEFT JOIN public.employees ej ON ej.id = p.rejected_by
        WHERE p.order_id = ${orderId} ORDER BY p.id DESC
      `;

      const missingStaffIds = new Set<number>();
      for (const r of rows) {
        if (!r.recorded_by_name && r.recorded_by) missingStaffIds.add(r.recorded_by);
        if (!r.approved_by_name && r.approved_by) missingStaffIds.add(r.approved_by);
        if (!r.rejected_by_name && r.rejected_by) missingStaffIds.add(r.rejected_by);
      }
      if (missingStaffIds.size > 0) {
        try {
          const staffRows = await this.prisma.employees.findMany({
            where: { id: { in: Array.from(missingStaffIds) } },
            select: { id: true, full_name: true },
          });
          const staffMap = new Map(staffRows.map(s => [s.id, s.full_name]));
          for (const r of rows) {
            if (!r.recorded_by_name && r.recorded_by && staffMap.has(r.recorded_by)) {
              r.recorded_by_name = staffMap.get(r.recorded_by);
            }
            if (!r.approved_by_name && r.approved_by && staffMap.has(r.approved_by)) {
              r.approved_by_name = staffMap.get(r.approved_by);
            }
            if (!r.rejected_by_name && r.rejected_by && staffMap.has(r.rejected_by)) {
              r.rejected_by_name = staffMap.get(r.rejected_by);
            }
          }
        } catch {
          // ignore fallback error
        }
      }

      return rows;
    }, authActor(user));
  }

  async submitOnlinePayment(orderId: number, dto: OnlinePaymentDto, user: CurrentUserPayload) {
    if (!dto.paymentReference?.trim() || !Number.isFinite(dto.amount) || dto.amount <= 0) throw new BadRequestException('Payment evidence is required.');
    return this.prisma.withOrder('read', async tx => {
      const rows = await tx.$queryRaw<{ id: number }[]>`SELECT public.submit_online_payment(${orderId}, ${dto.amount}::numeric, ${dto.paymentMethod}::text, ${dto.paymentReference.trim()}::text) AS id`;
      return rows[0];
    }, authActor(user));
  }

  async approveOnlinePayment(orderId: number, receiptId: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('read', async tx => {
      const rows = await tx.$queryRaw<{ cashbook_id: number }[]>`SELECT public.approve_online_payment(${orderId}, ${receiptId}) AS cashbook_id`;
      return rows[0];
    }, authActor(user));
  }

  async rejectOnlinePayment(orderId: number, receiptId: number, reason: string, user: CurrentUserPayload) {
    if (!reason?.trim()) throw new BadRequestException('Payment rejection reason is required.');
    return this.prisma.withOrder('read', async tx => {
      await tx.$executeRaw`SELECT public.reject_online_payment(${orderId}, ${receiptId}, ${reason.trim()}::text)`;
      return { rejected: true };
    }, authActor(user));
  }

  async adminUpdateOrderStatus(orderId: number, dto: UpdateOrderStatusDto, user: CurrentUserPayload) {
    return this.prisma.withOrder('status', async (tx) => {
      const order = await tx.orders.findFirst({
        where: this.orderAccessWhere(orderId, user),
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      const currentStatus = normalizeOrderStatus(order.order_status || "PENDING");
      const targetStatus = dto.orderStatus
        ? normalizeOrderStatus(dto.orderStatus)
        : currentStatus;

      if (dto.paymentStatus === 'REFUNDED' && order.payment_status !== 'REFUNDED') {
        throw new BadRequestException('Refunds require a separate financial approval and payment record.');
      }
      if (dto.paymentStatus === 'PAID' && targetStatus === 'CANCELLED') {
        throw new BadRequestException('Cancelled orders cannot be marked paid; reconcile late payments separately.');
      }
      if (dto.paymentStatus === 'PAID' && order.payment_status !== 'PAID') {
        throw new BadRequestException('Use payment evidence and financial approval or COD reconciliation to record payment.');
      }
      if (dto.paymentStatus && dto.paymentStatus !== order.payment_status) {
        throw new BadRequestException('Payment status changes require financial evidence and reconciliation.');
      }

      if (targetStatus === 'SHIPPING' && currentStatus !== targetStatus) {
        throw new BadRequestException('Pack the order to create its shipment before shipping.');
      }
      if (currentStatus !== targetStatus && ['RETURNED', 'PARTIALLY_RETURNED'].includes(targetStatus)) {
        throw new BadRequestException('Customer returns require an approved RMA; they cannot be confirmed by changing the order status.');
      }
      if (targetStatus === 'COMPLETED' && currentStatus !== targetStatus) {
        const shipment = await tx.shipments.findFirst({ where: { order_id: orderId } });
        if (!shipment || shipment.shipping_status !== 'DELIVERED' || !shipment.proof_type?.trim()
          || !shipment.proof_reference?.trim() || !shipment.delivered_to_name?.trim() || !shipment.actual_delivery_at) {
          throw new BadRequestException('A delivered shipment with complete delivery evidence is required.');
        }
      }

      if (order.prescription_review_status && order.prescription_review_status !== 'APPROVED' && !['PENDING', 'WAITING_INTERNAL_TRANSFER', 'CANCELLED'].includes(targetStatus)) {
        throw new BadRequestException('This order requires pharmacist approval before processing');
      }

      if (currentStatus !== targetStatus) {
        const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];
        if (!allowedNext.includes(targetStatus)) {
          throw new BadRequestException(
            `Invalid status transition: Cannot move order from ${currentStatus} to ${targetStatus}. Allowed transitions: ${allowedNext.join(", ") || "None"}`,
          );
        }
      }

      const originalCustomerNote = order.note;
      if (targetStatus === 'CANCELLED' && currentStatus !== targetStatus) {
        if (!dto.note?.trim()) throw new BadRequestException('A cancellation reason is required.');
        if (order.prescription_id && order.prescription_review_status === 'APPROVED') {
          throw new BadRequestException('Cancellation of an approved prescription requires pharmacist confirmation.');
        }
        if (currentStatus === 'PROCESSING' && !['STORE_MANAGER', 'SUPER_ADMIN'].includes(normalizeRole(user.role) || '')) {
          throw new ForbiddenException('Cancellation during processing requires the export facility manager.');
        }
      }

      const updateData: any = {
        order_status: targetStatus,
      };

      if (dto.paymentStatus) {
        updateData.payment_status = dto.paymentStatus;
      }
      if (dto.note) {
        updateData.note = dto.note;
      }

      const updated = await tx.orders.updateMany({
        where: { id: orderId, order_status: order.order_status },
        data: updateData,
      });
      if (updated.count !== 1) throw new BadRequestException('Order status changed. Reload and try again.');

      if (targetStatus === "CANCELLED" && currentStatus !== targetStatus) {
        // Restore customer's original delivery note so the cancellation reason does not overwrite it!
        await tx.orders.update({
          where: { id: orderId },
          data: { note: originalCustomerNote },
        });
        await releaseOrderReservations(tx, orderId, order.export_facility_id);
      }

      if (
        targetStatus === "CANCELLED" &&
        currentStatus !== targetStatus &&
        order.used_points &&
        order.used_points > 0 &&
        order.customer_id
      ) {
        await tx.customers.update({
          where: { id: order.customer_id },
          data: { reward_points: { increment: order.used_points } },
        });
        await tx.loyalty_point_logs.create({
          data: {
            customer_id: order.customer_id,
            order_id: orderId,
            transaction_type: "REDEEM_REVERSAL",
            points: order.used_points,
            description: `Refunded ${order.used_points} points on order #${order.order_code} cancellation`,
          },
        });
      }



      return formatOrder(
        await tx.orders.findFirst({ where: this.orderAccessWhere(orderId, user), include: ORDER_DETAILS_INCLUDE }),
        targetStatus === 'CANCELLED' ? (dto.note?.trim() || undefined) : undefined,
      );
    }, authActor(user));
  }

  async adminGetAvailableBoxesForOrder(orderId: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('pack', async (tx) => {
      const order = await tx.orders.findFirst({
        where: this.orderAccessWhere(orderId, user),
        include: {
          order_items: {
            select: {
              id: true,
              medicine_id: true,
              medicine_name: true,
              unit_name: true,
              quantity: true,
              assigned_uids: true,
            },
          },
        },
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      const boxItems = order.order_items.filter((item) =>
        isBoxUnit(item.unit_name),
      );

      const reservedUids = boxItems.flatMap((item) => item.assigned_uids);

      const reservedBoxes =
        reservedUids.length > 0
          ? await tx.medicine_boxes.findMany({
            where: {
              uid: { in: reservedUids },
              current_facility_id: order.export_facility_id,
              status: "RESERVED",
            },
            include: {
              medicine_batches: {
                include: {
                  medicines: {
                    select: {
                      id: true,
                      medicine_name: true,
                      registration_number: true,
                    },
                  },
                },
              },
            },
            orderBy: [
              { medicine_batches: { expiry_date: "asc" } },
              { created_at: "asc" },
            ],
          })
          : [];

      const existingUids = new Set(reservedBoxes.map((b) => b.uid));
      const fallbackBoxes: typeof reservedBoxes = [];

      for (const item of boxItems) {
        if (!item.medicine_id) continue;
        const countNeeded = item.quantity - item.assigned_uids.length;
        if (countNeeded <= 0) continue;

        const available = await tx.medicine_boxes.findMany({
          where: {
            current_facility_id: order.export_facility_id,
            status: { in: AVAILABLE_BOX_STATUSES },
            medicine_batches: { medicine_id: item.medicine_id },
            uid: { notIn: Array.from(existingUids) },
          },
          include: {
            medicine_batches: {
              include: {
                medicines: {
                  select: {
                    id: true,
                    medicine_name: true,
                    registration_number: true,
                  },
                },
              },
            },
          },
          orderBy: [
            { medicine_batches: { expiry_date: "asc" } },
            { created_at: "asc" },
          ],
          take: Math.max(countNeeded * 3, 10),
        });

        for (const box of available) {
          existingUids.add(box.uid);
          fallbackBoxes.push(box);
        }
      }

      const allBoxes = [...reservedBoxes, ...fallbackBoxes];

      return allBoxes.map((box) => ({
        uid: box.uid,
        status: box.status,
        batchId: box.batch_id,
        batchNumber: box.medicine_batches?.batch_number ?? null,
        expiryDate: box.medicine_batches?.expiry_date ?? null,
        medicineId: box.medicine_batches?.medicines?.id ?? null,
        medicineName: box.medicine_batches?.medicines?.medicine_name ?? null,
        facilityId: box.current_facility_id,
      }));

    }, authActor(user));
  }

  async adminPackOrder(orderId: number, dto: PackOrderDto | undefined, user: CurrentUserPayload) {
    return this.prisma.withOrder('pack', async (tx) => {
      await tx.$queryRaw`SELECT id FROM public.orders WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.orders.findFirst({
        where: this.orderAccessWhere(orderId, user),
        include: {
          order_items: {
            include: { medicines: true },
          },
          shipments: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      if (['BANK_TRANSFER', 'E_WALLET'].includes(order.payment_method || '') && order.payment_status !== 'PAID') {
        throw new BadRequestException('Online payment must be completed before packing.');
      }

      if (order.prescription_review_status && order.prescription_review_status !== 'APPROVED') {
        throw new BadRequestException('This order requires pharmacist approval before packing');
      }

      const normStatus = normalizeOrderStatus(order.order_status);
      if (!["PENDING", "PROCESSING"].includes(normStatus)) {
        throw new BadRequestException(
          `Only orders with status PENDING or PROCESSING can be packed. Current status is ${order.order_status}.`,
        );
      }

      if (order.shipments) {
        throw new BadRequestException(
          "A shipment is already created for this order.",
        );
      }

      const boxItems = order.order_items.filter((item) =>
        isBoxUnit(item.unit_name),
      );

      const totalRequired = boxItems.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      const reservedUids = boxItems.flatMap((item) => item.assigned_uids);

      const submittedUids = (dto?.boxUids || [])
        .map((u) => u.trim())
        .filter(Boolean);

      if (new Set(submittedUids).size !== submittedUids.length) {
        throw new BadRequestException(
          "Duplicate box UIDs detected in packing request.",
        );
      }

      if (submittedUids.length !== totalRequired) {
        throw new BadRequestException(
          `Confirm the UID on each physical package. Received ${submittedUids.length} of ${totalRequired} required UID(s).`,
        );
      }
      const uidsToPack = submittedUids;
      const reservedUidSet = new Set(reservedUids);
      if (reservedUidSet.size !== reservedUids.length) {
        throw new BadRequestException(
          "The order has duplicate reserved package UIDs.",
        );
      }

      const boxesToPack =
        totalRequired > 0
          ? await tx.medicine_boxes.findMany({
            where: {
              uid: { in: uidsToPack },
              current_facility_id: order.export_facility_id,
              status: { in: ["RESERVED", ...AVAILABLE_BOX_STATUSES] },
            },
            include: { medicine_batches: true },
          })
          : [];

      if (boxesToPack.length !== totalRequired) {
        throw new BadRequestException(
          "One or more physical packages for this order are invalid, already dispatched, or not at the export facility.",
        );
      }

      if (
        boxesToPack.some(
          (box) => box.status === "RESERVED" && !reservedUidSet.has(box.uid),
        )
      ) {
        throw new BadRequestException(
          "A scanned package is reserved for another order.",
        );
      }

      const boxesByMedicine = new Map<number, typeof boxesToPack>();
      for (const box of boxesToPack) {
        const medId = box.medicine_batches?.medicine_id;
        if (medId) {
          const list = boxesByMedicine.get(medId) || [];
          list.push(box);
          boxesByMedicine.set(medId, list);
        }
      }

      for (const item of boxItems) {
        if (!item.medicine_id) {
          throw new BadRequestException(
            `Order item "${item.medicine_name}" is missing medicine ID.`,
          );
        }
        const availableForMed = boxesByMedicine.get(item.medicine_id) || [];
        if (availableForMed.length < item.quantity) {
          throw new BadRequestException(
            `Verified packages do not match medicine "${item.medicine_name}". Required: ${item.quantity}, provided: ${availableForMed.length}.`,
          );
        }
      }

      const reservedBoxMap = new Map(boxesToPack.map((box) => [box.uid, box]));

      const replacementUids = boxesToPack
        .filter((box) => !reservedUidSet.has(box.uid))
        .map((box) => box.uid);
      const releasedUids = reservedUids.filter(
        (uid) => !uidsToPack.includes(uid),
      );

      if (replacementUids.length > 0) {
        const claimed = await tx.medicine_boxes.updateMany({
          where: {
            uid: { in: replacementUids },
            current_facility_id: order.export_facility_id,
            status: { in: AVAILABLE_BOX_STATUSES },
          },
          data: { status: "RESERVED" },
        });
        if (claimed.count !== replacementUids.length) {
          throw new BadRequestException(
            "A replacement package is no longer available.",
          );
        }
      }

      if (releasedUids.length > 0) {
        const released = await tx.medicine_boxes.updateMany({
          where: {
            uid: { in: releasedUids },
            current_facility_id: order.export_facility_id,
            status: "RESERVED",
          },
          data: { status: "IN_STOCK" },
        });
        if (released.count !== releasedUids.length) {
          throw new BadRequestException(
            "The original package reservation changed. Reload the order before packing.",
          );
        }
      }

      const batchesToDecrement = new Map<number, number>();

      for (const item of order.order_items) {
        const countNeeded = item.quantity;
        const itemBoxes = isBoxUnit(item.unit_name)
          ? (boxesByMedicine.get(item.medicine_id || 0) || []).splice(
            0,
            item.quantity,
          )
          : [];
        const itemUids = itemBoxes.map((b) => b.uid);

        if (isBoxUnit(item.unit_name)) {
          for (const uid of itemUids) {
            const batchId = reservedBoxMap.get(uid)?.batch_id;
            if (batchId) {
              batchesToDecrement.set(
                batchId,
                (batchesToDecrement.get(batchId) || 0) + 1,
              );
            }
          }
        }

        if (!order.export_facility_id || !item.variant_id) {
          throw new BadRequestException(
            `Order item "${item.medicine_name}" has no export facility or variant.`,
          );
        }

        const inventory = await tx.inventories.findUnique({
          where: {
            facility_id_variant_id: {
              facility_id: order.export_facility_id,
              variant_id: item.variant_id,
            },
          },
        });
        if (!inventory || !item.inventory_reserved) {
          throw new BadRequestException(
            `Inventory for "${item.medicine_name}" is not reserved for this order.`,
          );
        }

        const updatedInventoryRows = await tx.$queryRaw<{ stock_quantity: number }[]>`
          UPDATE "inventories"
          SET "stock_quantity" = "stock_quantity" - ${countNeeded},
              "reserved_quantity" = COALESCE("reserved_quantity", 0) - ${countNeeded},
              "updated_at" = NOW()
          WHERE "facility_id" = ${order.export_facility_id}
            AND "variant_id" = ${item.variant_id}
            AND "stock_quantity" >= ${countNeeded}
            AND COALESCE("reserved_quantity", 0) >= ${countNeeded}
          RETURNING "stock_quantity"
        `;
        if (updatedInventoryRows.length !== 1) {
          throw new BadRequestException(
            `Reserved inventory for "${item.medicine_name}" is inconsistent.`,
          );
        }

        await tx.order_items.update({
          where: { id: item.id },
          data: {
            assigned_uids: itemUids.length > 0 ? itemUids : item.assigned_uids,
            inventory_reserved: false,
          },
        });

        await tx.inventory_logs.create({
          data: {
            facility_id: order.export_facility_id,
            medicine_id: item.medicine_id,
            variant_id: item.variant_id,
            stock_bucket: 'ON_HAND',
            performed_by_id: user.id,
            transaction_type: "ORDER_PACKED",
            quantity_changed: -countNeeded,
            previous_quantity: updatedInventoryRows[0].stock_quantity + countNeeded,
            new_quantity: updatedInventoryRows[0].stock_quantity,
            reference_code: order.order_code,
            note: `Order #${order.order_code} packed with ${countNeeded} ${item.unit_name || "unit"}(s)`,
          },
        });
      }

      if (uidsToPack.length > 0) {
        const packagedBoxes = await tx.medicine_boxes.updateMany({
          where: {
            uid: { in: uidsToPack },
            current_facility_id: order.export_facility_id,
            status: "RESERVED",
          },
          data: { status: "PACKAGED" },
        });
        if (packagedBoxes.count !== uidsToPack.length) {
          throw new BadRequestException(
            "One or more physical packages could not be marked as packaged.",
          );
        }
      }

      for (const [batchId, qty] of batchesToDecrement.entries()) {
        const batch = await tx.batches.findUnique({ where: { id: batchId } });
        if (batch) {
          await tx.batches.update({
            where: { id: batchId },
            data: {
              remaining_quantity: Math.max(0, batch.remaining_quantity - qty),
            },
          });
        }
      }

      const trackingNumber = `TRK-${order.order_code}-${Date.now().toString().slice(-4)}`;

      await tx.shipments.create({
        data: {
          order_id: orderId,
          tracking_number: trackingNumber,
          courier_name: dto?.courierName?.trim().toUpperCase() || "EXPRESS_LOGISTICS",
          shipping_status: "PENDING_PICKUP",
          cod_amount: order.payment_method === "COD" ? order.total_amount : 0,
          note: dto?.shippingNote || null,
        },
      });

      await tx.orders.update({
        where: { id: orderId },
        data: { order_status: "PENDING_PICKUP" },
      });

      return formatOrder(await tx.orders.findFirst({ where: this.orderAccessWhere(orderId, user), include: ORDER_DETAILS_INCLUDE }));
    }, authActor(user));
  }

}
