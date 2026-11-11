import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { authActor, normalizeRole } from "../../../common/auth-identity";
import { workflowDatabase } from "../../../common/workflow-database";
import { PrismaService } from "../../../prisma/prisma.service";
import { CurrentUserPayload } from "../../../common/decorators/current-user.decorator";
import { isBoxUnit } from "../../../common/inventory/box.helper";
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';
import { ReceiveTransferDto, ReceiveTransferLineDto } from './dto/receive-transfer.dto';
import { HaltTransferDto, RerouteTransferDto, ReceiveTransferReturnDto } from './dto/transfer-return.dto';
import { validateInspectionUids } from '../inspection.helper';
import { LogisticsHistoryEvent } from '../logistics.types';
import { ResolveDiscrepancyDto } from './dto/resolve-discrepancy.dto';

type TransferItem = Prisma.JsonObject & {
  variantId: number | string;
  medicineId: number | string;
  quantity: number | string;
};

@Injectable()
export class InternalTransferService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveDiscrepancy(id: number, dto: ResolveDiscrepancyDto, user: CurrentUserPayload) {
    return workflowDatabase(this.prisma.withOrder('replace', async tx => {
      const rows = await tx.$queryRaw<{ result: Prisma.JsonObject }[]>`SELECT public.resolve_transfer_discrepancy(
        ${id}, ${dto.action}::text, ${dto.sourceFacilityId ?? null}::integer, ${dto.reason.trim()}::text,
        ${dto.customerAgreement?.trim() || null}::text) AS result`;
      return rows[0]?.result;
    }, authActor(user)));
  }

  private getFacilityScope(user: CurrentUserPayload): number | null {
    const role = (user?.role || "").toString().toLowerCase().replace(/_/g, "");
    if (role === "superadmin") return null;
    const facilityId = Number(user?.facilityId);
    if (!Number.isInteger(facilityId) || facilityId <= 0) {
      throw new ForbiddenException("Staff account is not assigned to a facility.");
    }
    return facilityId;
  }

  cancelTransfer(_id: number, _user: CurrentUserPayload): Promise<never> {
    return Promise.reject(new BadRequestException('Transfer replanning is not supported. Cancel the entire order from its order page.'));
  }

  async adminGetInternalTransfers(orderId: number | undefined, user: CurrentUserPayload, status?: string) {
    return workflowDatabase(this.prisma.withOrder('transfer_read', async (tx) => {
      const facilityId = this.getFacilityScope(user);
      const where: Prisma.internal_transfersWhereInput = {};
      if (status) where.status = status;
      if (orderId) {
        where.order_id = orderId;
      }
      if (facilityId !== null) {
        where.OR = [
          { from_facility_id: facilityId },
          { to_facility_id: facilityId },
        ];
      }
      return tx.internal_transfers.findMany({
        where,
        orderBy: { created_at: "desc" },
        include: {
          from_facility: true,
          to_facility: true,
        },
      });
    }, authActor(user)));
  }

  async adminGetInternalTransfer(transferId: number, user: CurrentUserPayload) {
    return workflowDatabase(this.prisma.withOrder('transfer_read', async (tx) => {
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({
        where: {
          id: transferId,
          ...(facilityId === null ? {} : { OR: [{ from_facility_id: facilityId }, { to_facility_id: facilityId }] }),
        },
        include: { from_facility: true, to_facility: true },
      });
      if (!transfer) throw new NotFoundException(`Internal transfer #${transferId} not found`);
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
            WHERE e.transfer_id = ${transferId} ORDER BY e.created_at, e.id`;
        }
      }
      const manifest = await tx.$queryRaw<Array<{ lines: Prisma.JsonValue; prepared_by: number; prepared_at: Date }>>`
        SELECT lines, prepared_by, prepared_at FROM public.transfer_manifests WHERE transfer_id = ${transferId}
      `;
      const custody = await tx.$queryRaw<Array<{ variant_id: number; quantity: number; outstanding: number; handed_over_at: Date; received_at: Date | null }>>`
        SELECT variant_id, quantity, outstanding, handed_over_at, received_at FROM public.transfer_custody WHERE transfer_id=${transferId} ORDER BY variant_id
      `;
      const resolutions = await tx.$queryRaw<Array<{ action: string; reason: string; customer_agreement: string | null; resolved_by: number; replacement_transfer_id: number | null }>>`
        SELECT action, reason, customer_agreement, resolved_by, replacement_transfer_id FROM public.transfer_resolutions WHERE transfer_id=${transferId}
      `;
      return { ...transfer, history, manifest: manifest[0] || null, custody, resolution: resolutions[0] || null };
    }, authActor(user)));
  }

  async transportStaff(transferId: number, user: CurrentUserPayload) {
    return workflowDatabase(this.prisma.withOrder('transfer_read', async (tx) => {
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({ where: { id: transferId, ...(facilityId === null ? {} : { from_facility_id: facilityId }) } });
      if (!transfer) throw new NotFoundException('Transfer not found at your source facility');
      return tx.$queryRaw<{ id: number; full_name: string }[]>`SELECT * FROM public.transfer_transport_staff(${transferId})`;
    }, authActor(user)));
  }

  async adminDispatchInternalTransfer(transferId: number, dto: DispatchTransferDto | undefined, user: CurrentUserPayload) {
    return workflowDatabase(this.prisma.withOrder('dispatch', async (tx) => {
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({
        where: facilityId === null ? { id: transferId } : { id: transferId, from_facility_id: facilityId },
      });
      if (!transfer) {
        throw new NotFoundException(`Internal transfer #${transferId} not found`);
      }
      if (transfer.status !== 'REQUESTED') throw new BadRequestException('Only a requested transfer can be dispatched');
      if (!dto || !['INTERNAL', 'THIRD_PARTY'].includes(dto.transportMode)) throw new BadRequestException('Choose internal staff or a third-party carrier');

      let employeeName: string | null = null;
      if (dto.transportMode === 'INTERNAL') {
        if (!dto.transportEmployeeId || dto.courierName?.trim() || dto.trackingCode?.trim()) throw new BadRequestException('Internal transport requires a source employee and no carrier tracking');
        const staff = await tx.$queryRaw<{ id: number; full_name: string }[]>`SELECT * FROM public.transfer_transport_staff(${transferId})`;
        employeeName = staff.find((employee) => employee.id === dto.transportEmployeeId)?.full_name ?? null;
        if (!employeeName) throw new BadRequestException('Choose an active employee at the source facility');
      } else if (!dto.courierName?.trim() || !dto.trackingCode?.trim() || dto.transportEmployeeId) {
        throw new BadRequestException('Third-party transport requires the carrier and its actual tracking number');
      }

      const [transferOrder] = await tx.$queryRaw<{ prescription_review_status: string | null; order_status: string }[]>`SELECT * FROM public.transfer_order_state(${transfer.order_id})`;
      if (!transferOrder || transferOrder.order_status === 'CANCELLED') {
        throw new BadRequestException('Cannot dispatch transfer for a cancelled order.');
      }
      if (transferOrder.prescription_review_status && transferOrder.prescription_review_status !== 'APPROVED') {
        throw new BadRequestException('This transfer cannot be dispatched before pharmacist approval');
      }

      if (!Array.isArray(dto.manifest) || dto.manifest.length === 0) {
        throw new BadRequestException('A complete scanned source manifest is required.');
      }
      await tx.$executeRaw`SELECT public.prepare_dispatch_manifest(${transferId}, ${JSON.stringify(dto.manifest)}::jsonb)`;

      const dispatched = await tx.internal_transfers.updateMany({
        where: { id: transferId, status: 'REQUESTED' },
        data: {
          status: "DISPATCHED",
          tracking_code: dto.transportMode === 'THIRD_PARTY' ? dto.trackingCode!.trim() : null,
          transport_mode: dto.transportMode,
          transport_employee_id: dto.transportMode === 'INTERNAL' ? dto.transportEmployeeId : null,
          transport_employee_name: employeeName,
          courier_name: dto.transportMode === 'THIRD_PARTY' ? dto.courierName!.trim().toUpperCase() : null,
          dispatched_at: new Date(),
          updated_at: new Date(),
        },
      });
      if (dispatched.count !== 1) throw new BadRequestException('Transfer changed. Reload before dispatching');
      return tx.internal_transfers.findFirst({
        where: { id: transferId },
        include: { from_facility: true, to_facility: true },
      });
    }, authActor(user)));
  }

  async adminHaltAndReturnTransfer(transferId: number, dto: HaltTransferDto, user: CurrentUserPayload) {
    if (!dto?.reason?.trim()) throw new BadRequestException('Reason is required to stop and return the transfer.');
    return workflowDatabase(this.prisma.withOrder('dispatch', async (tx) => {
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({
        where: facilityId === null ? { id: transferId } : { id: transferId, OR: [{ from_facility_id: facilityId }, { to_facility_id: facilityId }] },
      });
      if (!transfer) throw new NotFoundException(`Internal transfer #${transferId} not found`);
      if (transfer.status !== 'DISPATCHED') {
        throw new BadRequestException(`Cannot halt transfer with status "${transfer.status}". Only dispatched transfers can be halted.`);
      }

      const updated = await tx.internal_transfers.updateMany({
        where: { id: transferId, status: 'DISPATCHED' },
        data: {
          status: 'RETURN_REQUESTED',
          return_reason: dto.reason.trim(),
          notes: `Delivery halted: ${dto.reason.trim()}. Transfer returning to source facility.`,
          updated_at: new Date(),
        },
      });
      if (updated.count !== 1) throw new BadRequestException('Transfer status changed; reload and try again.');
      return tx.internal_transfers.findFirst({ where: { id: transferId }, include: { from_facility: true, to_facility: true } });
    }, authActor(user)));
  }

  adminRerouteTransfer(_transferId: number, _dto: RerouteTransferDto, user: CurrentUserPayload): Promise<never> {
    if (normalizeRole(user.role) !== 'SUPER_ADMIN') {
      return Promise.reject(new ForbiddenException('Only a super admin can reroute a transfer.'));
    }
    return Promise.reject(new BadRequestException('Rerouting would change the accepted delivery plan. Cancel the entire order and place a new order.'));
  }

  async adminReceiveTransferReturn(transferId: number, dto: ReceiveTransferReturnDto | undefined, user: CurrentUserPayload) {
    return workflowDatabase(this.prisma.withOrder('receive', async (tx) => {
      await tx.$queryRaw`SELECT state.order_status FROM public.internal_transfers t CROSS JOIN LATERAL public.transfer_order_state(t.order_id) state WHERE t.id = ${transferId}`;
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({
        where: facilityId === null ? { id: transferId } : { id: transferId, from_facility_id: facilityId },
        include: {
          orders: { include: { order_items: true } },
          from_facility: true,
          to_facility: true,
        },
      });
      if (!transfer) throw new NotFoundException(`Internal transfer #${transferId} not found at your facility.`);
      if (transfer.status !== 'RETURN_REQUESTED') {
        throw new BadRequestException(`Cannot receive return for transfer with status "${transfer.status}". It must be RETURN_REQUESTED.`);
      }

      const items = (transfer.items as TransferItem[]) || [];
      const lineMap = new Map((dto?.lines || []).map(line => [line.variantId, line]));
      if (lineMap.size !== (dto?.lines || []).length || [...lineMap.keys()].some(id => !items.some(item => Number(item.variantId) === id))) throw new BadRequestException('Duplicate or unknown inspection variant.');
      if (!dto?.lines || lineMap.size !== items.length) throw new BadRequestException('Inspection must include every transfer variant.');

      for (const item of items) {
        const variantId = Number(item.variantId);
        const quantity = Number(item.quantity);
        const medicineId = Number(item.medicineId);
        const line = { damagedQuantity: 0, ...lineMap.get(variantId), goodQuantity: lineMap.get(variantId)?.goodQuantity ?? quantity };
        const orderItem = transfer.orders.order_items.find(oi => oi.variant_id === variantId && oi.source_facility_id === transfer.from_facility_id);
        if (!orderItem || !orderItem.inventory_reserved || orderItem.quantity !== quantity) throw new BadRequestException('Transfer return reservation does not match the order.');
        const assigned = orderItem.assigned_uids;
        const goodUids = line.goodUids ?? (line.damagedQuantity === 0 ? assigned : []);
        const damagedUids = line.damagedUids ?? [];
        validateInspectionUids(assigned, [{ quantity: line.goodQuantity, uids: goodUids }, { quantity: line.damagedQuantity, uids: damagedUids }]);

        if (line.goodQuantity + line.damagedQuantity !== quantity) {
          throw new BadRequestException(`Line quantities for variant #${variantId} (${line.goodQuantity} good + ${line.damagedQuantity} damaged) do not sum to expected ${quantity}.`);
        }

        await tx.$queryRaw`SELECT public.consume_transfer_custody(${transferId}, ${variantId}, ${quantity})`;

        if (line.goodQuantity > 0) {
          const released = await tx.$queryRaw<{ available_quantity: number }[]>`
            UPDATE "inventories"
            SET "stock_quantity" = "stock_quantity" + ${line.goodQuantity},
                "updated_at" = NOW()
            WHERE "facility_id" = ${transfer.from_facility_id}
              AND "variant_id" = ${variantId}
            RETURNING "stock_quantity" - COALESCE("reserved_quantity", 0) AS available_quantity
          `;
          if (released.length !== 1) {
            throw new BadRequestException(`Failed to restore reserved stock for variant #${variantId}.`);
          }
          await tx.inventory_logs.create({
            data: {
              facility_id: transfer.from_facility_id,
              medicine_id: medicineId,
              variant_id: variantId,
              stock_bucket: 'AVAILABLE',
              performed_by_id: user.id,
              transaction_type: "TRANSFER_RETURN_RESTOCK",
              quantity_changed: line.goodQuantity,
              previous_quantity: released[0].available_quantity - line.goodQuantity,
              new_quantity: released[0].available_quantity,
              reference_code: transfer.transfer_code,
              note: `Restocked ${line.goodQuantity} unit(s) from cancelled transfer return #${transfer.transfer_code}`,
            },
          });
        }

        if (line.damagedQuantity > 0) {
          await tx.$executeRaw`SELECT public.record_quarantine_movement('TRANSFER_RETURN', ${transferId}, ${variantId}, 'IN', ${line.damagedQuantity})`;
        }

        for (const group of [{ uids: goodUids, status: 'IN_STOCK' }, { uids: damagedUids, status: 'DAMAGED' }]) {
          if (group.uids.length === 0) continue;
          const changed = await tx.medicine_boxes.updateMany({
            where: { uid: { in: group.uids }, current_facility_id: null, status: 'IN_TRANSIT' },
            data: { status: group.status, current_facility_id: transfer.from_facility_id },
          });
          if (changed.count !== group.uids.length) throw new BadRequestException('Returned UID custody changed; retry.');
        }
      }

      await tx.order_items.updateMany({
        where: { order_id: transfer.order_id, source_facility_id: transfer.from_facility_id, variant_id: { in: items.map(item => Number(item.variantId)) } },
        data: { inventory_reserved: false, assigned_uids: [] },
      });

      await tx.internal_transfers.update({
        where: { id: transferId },
        data: {
          status: "RETURNED_TO_SOURCE",
          returned_at: new Date(),
          notes: `Goods received and inspected at source facility. Notes: ${dto?.notes || 'Clean intake'}.`,
          updated_at: new Date(),
        },
      });

      return tx.internal_transfers.findFirst({
        where: { id: transferId },
        include: { from_facility: true, to_facility: true },
      });
    }, authActor(user)));
  }

  async adminReceiveInternalTransfer(transferId: number, user: CurrentUserPayload, dto?: ReceiveTransferDto) {
    return workflowDatabase(this.prisma.withOrder('receive', async (tx) => {
      await tx.$queryRaw`SELECT id FROM public.orders WHERE id = (SELECT order_id FROM public.internal_transfers WHERE id = ${transferId}) FOR UPDATE`;
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({
        where: facilityId === null ? { id: transferId } : { id: transferId, to_facility_id: facilityId },
        include: {
          orders: {
            include: {
              order_items: true,
              internal_transfers: true,
            },
          },
          from_facility: true,
          to_facility: true,
        },
      });

      if (!transfer) {
        const visible = await tx.internal_transfers.findFirst({ where: { id: transferId } });
        if (visible) throw new ForbiddenException('Only staff at the destination facility can confirm receipt. Contact the destination facility manager.');
        throw new NotFoundException(`Internal transfer #${transferId} not found`);
      }

      if (transfer.status === "RECEIVED") {
        return transfer;
      }

      if (["CANCELLED", "REJECTED", "REJECTED_UNFULFILLED", "REPLACED", "RETURNED_TO_SOURCE"].includes(transfer.status)) {
        throw new BadRequestException(`Cannot receive transfer #${transferId} because its status is ${transfer.status}.`);
      }
      if (transfer.status !== "DISPATCHED") {
        throw new BadRequestException(`Transfer #${transferId} must be dispatched before it can be received.`);
      }

      if (transfer.orders.order_status !== 'WAITING_INTERNAL_TRANSFER' ||
        (transfer.orders.prescription_review_status && transfer.orders.prescription_review_status !== 'APPROVED')) {
        throw new BadRequestException('The order must still be waiting for transfers with its prescription approved.');
      }

      const transferItems = (transfer.items as TransferItem[]) || [];
      for (const item of transferItems) {
        if (![item.variantId, item.medicineId, item.quantity].every(value => Number.isSafeInteger(Number(value)) && Number(value) > 0)) {
          throw new BadRequestException('Transfer contains invalid medicine, variant or quantity. Contact the source facility.');
        }
        const orderItem = transfer.orders.order_items.find(oi => oi.variant_id === Number(item.variantId));
        if (!orderItem || orderItem.quantity !== Number(item.quantity) || orderItem.source_facility_id !== transfer.from_facility_id || !orderItem.inventory_reserved) {
          throw new BadRequestException('Transferred items do not match this order reservation. Contact the source facility.');
        }
      }

      const lineMap = new Map<number, ReceiveTransferLineDto>();
      if (dto?.lines && dto.lines.length > 0) {
        for (const l of dto.lines) {
          lineMap.set(l.variantId, l);
        }
      }

      if (lineMap.size !== (dto?.lines || []).length || [...lineMap.keys()].some(id => !transferItems.some(item => Number(item.variantId) === id))) throw new BadRequestException('Duplicate or unknown inspection variant.');
      if (!dto?.lines || lineMap.size !== transferItems.length) throw new BadRequestException('Inspection must include every transfer variant.');

      let totalDamagedCount = 0;
      let totalMissingCount = 0;
      const varianceRecords: { variantId: number; medicineId: number; totalQuantity: number; goodQuantity: number; damagedQuantity: number; missingQuantity: number; goodUids: string[]; damagedUids: string[]; missingUids: string[]; notes: string | null }[] = [];

      for (const item of transferItems) {
        const variantId = Number(item.variantId);
        const totalQuantity = Number(item.quantity);
        const medicineId = Number(item.medicineId);

        const lineSpec = lineMap.get(variantId);
        const goodQty = lineSpec !== undefined ? lineSpec.receivedQuantity : totalQuantity;
        const damagedQty = lineSpec?.damagedQuantity || 0;
        const missingQty = lineSpec?.missingQuantity || 0;

        if (goodQty + damagedQty + missingQty !== totalQuantity) {
          throw new BadRequestException(`Received quantities for variant #${variantId} (${goodQty} good, ${damagedQty} damaged, ${missingQty} missing) do not sum to transferred quantity ${totalQuantity}.`);
        }

        const inspectedItem = transfer.orders.order_items.find(oi => oi.variant_id === variantId)!;
        if ((damagedQty > 0 || missingQty > 0) && isBoxUnit(inspectedItem.unit_name) && inspectedItem.assigned_uids.length !== totalQuantity) {
          throw new BadRequestException('Assign dispatched package UIDs before discrepancy inspection.');
        }
        const inspectedGoodUids = lineSpec?.goodUids ?? (damagedQty === 0 && missingQty === 0 ? inspectedItem.assigned_uids : []);
        const inspectedDamagedUids = lineSpec?.damagedUids ?? [];
        validateInspectionUids(inspectedItem.assigned_uids, [
          { quantity: goodQty, uids: inspectedGoodUids }, { quantity: damagedQty, uids: inspectedDamagedUids },
        ], true);
        const missingUids = inspectedItem.assigned_uids.filter(uid => ![...inspectedGoodUids, ...inspectedDamagedUids].includes(uid));
        if (inspectedItem.assigned_uids.length > 0 && missingUids.length !== missingQty) throw new BadRequestException('Missing UID count does not match inspection.');
        const hasLineDiscrepancy = damagedQty > 0 || missingQty > 0;

        totalDamagedCount += damagedQty;
        totalMissingCount += missingQty;

        varianceRecords.push({
          variantId,
          medicineId,
          totalQuantity,
          goodQuantity: goodQty,
          damagedQuantity: damagedQty,
          missingQuantity: missingQty,
          goodUids: inspectedGoodUids, damagedUids: inspectedDamagedUids, missingUids,
          notes: lineSpec?.notes || null,
        });

        const deducted = await tx.$queryRaw<{ stock_quantity: number }[]>`
          SELECT public.consume_transfer_custody(${transferId}, ${variantId}, ${totalQuantity}) AS stock_quantity
        `;

        let updatedDestination: any = null;
        if (goodQty > 0) {
          const destInv = await tx.inventories.findFirst({
            where: {
              facility_id: transfer.to_facility_id,
              variant_id: variantId,
            },
          });
          updatedDestination = destInv
            ? await tx.inventories.update({
              where: { id: destInv.id },
              data: {
                stock_quantity: { increment: goodQty },
                reserved_quantity: { increment: hasLineDiscrepancy ? 0 : goodQty },
                updated_at: new Date(),
              },
            })
            : await tx.inventories.create({
              data: {
                facility_id: transfer.to_facility_id,
                variant_id: variantId,
                stock_quantity: goodQty,
                reserved_quantity: hasLineDiscrepancy ? 0 : goodQty,
                updated_at: new Date(),
              },
            });

          await tx.inventory_logs.create({
            data: {
              facility_id: transfer.to_facility_id,
              medicine_id: medicineId,
              variant_id: variantId,
              stock_bucket: 'ON_HAND',
              performed_by_id: user.id,
              transaction_type: "TRANSFER_IN",
              quantity_changed: goodQty,
              previous_quantity: updatedDestination.stock_quantity - goodQty,
              new_quantity: updatedDestination.stock_quantity,
              reference_code: transfer.transfer_code,
              note: `Received from ${transfer.from_facility?.facility_name ?? "facility #" + transfer.from_facility_id} for order #${transfer.orders.order_code}`,
            },
          });
        }

        if (damagedQty > 0) {
          await tx.$executeRaw`SELECT public.record_quarantine_movement('TRANSFER', ${transferId}, ${variantId}, 'IN', ${damagedQty})`;
        }

        await tx.inventory_logs.create({
          data: {
            facility_id: transfer.from_facility_id,
            medicine_id: medicineId,
            variant_id: variantId,
            stock_bucket: 'IN_TRANSIT',
            performed_by_id: user.id,
            transaction_type: "TRANSFER_OUT",
            quantity_changed: -(totalQuantity - missingQty),
            previous_quantity: deducted[0].stock_quantity + totalQuantity,
            new_quantity: deducted[0].stock_quantity + missingQty,
            reference_code: transfer.transfer_code,
            note: `Transfer to ${transfer.to_facility?.facility_name ?? "facility #" + transfer.to_facility_id} for order #${transfer.orders.order_code}`,
          },
        });

        if (missingQty > 0) {
          await tx.inventory_logs.create({
            data: {
              facility_id: transfer.from_facility_id,
              medicine_id: medicineId,
              variant_id: variantId,
              stock_bucket: 'IN_TRANSIT',
              performed_by_id: user.id,
              transaction_type: "TRANSFER_LOSS",
              quantity_changed: -missingQty,
              previous_quantity: deducted[0].stock_quantity + missingQty,
              new_quantity: deducted[0].stock_quantity,
              reference_code: transfer.transfer_code,
              note: `Transit shortage of ${missingQty} unit(s) on transfer #${transfer.transfer_code}`,
            },
          });
        }

        const orderItem = transfer.orders.order_items.find((oi) => oi.variant_id === variantId);
        const assignedUids = orderItem?.assigned_uids || [];
        if (orderItem && (assignedUids.length > 0 || isBoxUnit(orderItem.unit_name))) {
          const needsAssignment = assignedUids.length === 0;
          if (needsAssignment) throw new BadRequestException('Dispatched UID manifest is missing; reconcile custody first.');

          const goodUids = hasLineDiscrepancy ? inspectedGoodUids : assignedUids;
          const damagedUids = inspectedDamagedUids;

          if (goodUids.length > 0) {
            const movedBoxes = await tx.medicine_boxes.updateMany({
              where: {
                uid: { in: goodUids },
                current_facility_id: null,
                status: "IN_TRANSIT",
              },
              data: {
                current_facility_id: transfer.to_facility_id,
                status: hasLineDiscrepancy ? "IN_STOCK" : "RESERVED",
              },
            });
            if (movedBoxes.count !== goodUids.length) {
              throw new BadRequestException("Physical package availability changed. Reload and try receiving the transfer again.");
            }
          }
          if (damagedUids.length > 0) {
            const changed = await tx.medicine_boxes.updateMany({
              where: {
                uid: { in: damagedUids },
                current_facility_id: null,
                status: "IN_TRANSIT",
              },
              data: {
                current_facility_id: transfer.to_facility_id,
                status: "DAMAGED",
              },
            });
            if (changed.count !== damagedUids.length) throw new BadRequestException("Damaged UID custody changed; retry.");
          }
          if (missingUids.length > 0) {
            const changed = await tx.medicine_boxes.updateMany({
              where: { uid: { in: missingUids }, current_facility_id: null, status: "IN_TRANSIT" },
              data: { status: "LOST" },
            });
            if (changed.count !== missingUids.length) throw new BadRequestException("Missing UID custody changed; retry.");
          }
        }

        if (orderItem) {
          await tx.order_items.update({
            where: { id: orderItem.id },
            data: {
              source_facility_id: transfer.to_facility_id,
              assigned_uids: hasLineDiscrepancy ? [] : assignedUids,
              ...(hasLineDiscrepancy ? { inventory_reserved: false } : {}),
            },
          });
        }
      }

      const hasDiscrepancy = totalDamagedCount > 0 || totalMissingCount > 0;
      const finalStatus = hasDiscrepancy ? "RECEIVED_WITH_DISCREPANCY" : "RECEIVED";

      await tx.internal_transfers.update({
        where: { id: transferId },
        data: {
          status: finalStatus,
          received_at: new Date(),
          discrepancy_status: hasDiscrepancy ? "DISCREPANCY" : "NONE",
          variance_details: varianceRecords,
          notes: hasDiscrepancy
            ? `Received with discrepancy: ${totalDamagedCount} damaged, ${totalMissingCount} missing. Notes: ${dto?.notes || ''}`
            : transfer.notes,
          updated_at: new Date(),
        },
      });

      const remainingTransfers = await tx.internal_transfers.count({
        where: {
          order_id: transfer.order_id,
          id: { not: transferId },
          status: { notIn: ["RECEIVED", "REPLACED"] },
        },
      });

      if (remainingTransfers === 0 && !hasDiscrepancy) {
        await tx.orders.update({
          where: { id: transfer.order_id },
          data: { order_status: "PROCESSING" },
        });
      }

      return tx.internal_transfers.findUnique({
        where: { id: transferId },
        include: { from_facility: true, to_facility: true },
      });
    }, authActor(user)));
  }

  adminRejectDamagedInternalTransfer(_transferId: number, _user: CurrentUserPayload): Promise<never> {
    return Promise.reject(new BadRequestException('Use counted receipt inspection to quarantine damaged goods, then resolve the discrepancy.'));
  }
}
