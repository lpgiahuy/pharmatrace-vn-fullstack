import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { authActor } from "../../../common/auth-identity";
import { PrismaService } from "../../../prisma/prisma.service";
import { CurrentUserPayload } from "../../../common/decorators/current-user.decorator";
import { isBoxUnit, AVAILABLE_BOX_STATUSES } from "../../../common/inventory/box.helper";
import { DispatchTransferDto } from './dto/dispatch-transfer.dto';
import { LogisticsHistoryEvent } from '../logistics.types';

type TransferItem = Prisma.JsonObject & {
  variantId: number | string;
  medicineId: number | string;
  quantity: number | string;
};

@Injectable()
export class InternalTransferService {
  constructor(private readonly prisma: PrismaService) {}

  private getFacilityScope(user: CurrentUserPayload): number | null {
    const role = (user?.role || "").toString().toLowerCase().replace(/_/g, "");
    if (role === "superadmin") return null;
    const facilityId = Number(user?.facilityId);
    if (!Number.isInteger(facilityId) || facilityId <= 0) {
      throw new ForbiddenException("Staff account is not assigned to a facility.");
    }
    return facilityId;
  }

  async cancelTransfer(id: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('dispatch', async (tx) => {
      const transfer = await tx.internal_transfers.findFirst({ where: { id } });
      const actor = authActor(user);
      if (!transfer || (actor.role !== 'SUPER_ADMIN' && transfer.from_facility_id !== actor.facilityId)) throw new NotFoundException('Transfer not found');
      if (transfer.status !== 'REQUESTED') throw new BadRequestException('Only an unshipped transfer can be cancelled');
      const result = await tx.$queryRaw<{ cancelled: boolean }[]>`SELECT public.cancel_internal_transfer(${id}) AS cancelled`;
      if (!result[0]?.cancelled) throw new BadRequestException('Transfer or order status changed; retry');
      return { id, status: 'CANCELLED', orderActionRequired: true };
    }, authActor(user));
  }

  async adminGetInternalTransfers(orderId: number | undefined, user: CurrentUserPayload, status?: string) {
    return this.prisma.withOrder('transfer_read', async (tx) => {
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

    }, authActor(user));
  }

  async adminGetInternalTransfer(transferId: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('transfer_read', async (tx) => {
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
      return { ...transfer, history };
    }, authActor(user));
  }

  async transportStaff(transferId: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('transfer_read', async (tx) => {
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({ where: { id: transferId, ...(facilityId === null ? {} : { from_facility_id: facilityId }) } });
      if (!transfer) throw new NotFoundException('Transfer not found at your source facility');
      return tx.$queryRaw<{ id: number; full_name: string }[]>`SELECT * FROM public.transfer_transport_staff(${transferId})`;
    }, authActor(user));
  }

  async adminDispatchInternalTransfer(transferId: number, dto: DispatchTransferDto | undefined, user: CurrentUserPayload,) {
    return this.prisma.withOrder('dispatch', async (tx) => {
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
      if (!transferOrder || transferOrder.order_status === 'CANCELLED' || (transferOrder.prescription_review_status && transferOrder.prescription_review_status !== 'APPROVED')) {
        throw new BadRequestException('This transfer cannot be dispatched before pharmacist approval');
      }
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
        include: {
          from_facility: true,
          to_facility: true,
        },
      });

    }, authActor(user));
  }

  async adminRejectDamagedInternalTransfer(transferId: number, user: CurrentUserPayload) {
    return this.prisma.withOrder('replace', async (tx) => {
      const facilityId = this.getFacilityScope(user);
      const transfer = await tx.internal_transfers.findFirst({
        where: facilityId === null ? { id: transferId } : { id: transferId, to_facility_id: facilityId },
        include: { orders: { include: { order_items: true } } },
      });
      if (!transfer) {
        throw new NotFoundException(`Internal transfer #${transferId} not found`);
      }
      if (transfer.status !== "DISPATCHED" || transfer.orders.order_status !== "WAITING_INTERNAL_TRANSFER") {
        throw new BadRequestException("Only dispatched transfers for waiting orders can be rejected as damaged.");
      }

      const items = (transfer.items as TransferItem[]) || [];
      if (items.length === 0) {
        throw new BadRequestException("Transfer has no items to replace.");
      }
      const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
      const rejected = await tx.internal_transfers.updateMany({
        where: { id: transferId, status: "DISPATCHED" },
        data: { status: "REJECTED_UNFULFILLED", notes: `Damaged in transit; replacement required. ${transfer.notes || ""}`.trim() },
      });
      if (rejected.count !== 1) {
        throw new BadRequestException("Transfer status changed. Reload and try again.");
      }

      const replacementReservations: Array<{ variantId: number; quantity: number }> = [];
      const claimedReplacementUids: string[] = [];
      const replacementAssignments: Array<{ orderItemId: number; uids: string[] }> = [];

      const markUnfulfilled = async (reason: string) => {
        if (claimedReplacementUids.length > 0) {
          await tx.medicine_boxes.updateMany({
            where: { uid: { in: claimedReplacementUids }, status: "RESERVED" },
            data: { status: "IN_STOCK" },
          });
        }
        for (const reservation of replacementReservations) {
          await tx.$executeRaw`
            UPDATE "inventories"
            SET "reserved_quantity" = "reserved_quantity" - ${reservation.quantity},
                "updated_at" = NOW()
            WHERE "facility_id" = ${transfer.from_facility_id}
              AND "variant_id" = ${reservation.variantId}
              AND "reserved_quantity" >= ${reservation.quantity}
          `;
        }
        await tx.order_items.updateMany({
          where: {
            order_id: transfer.order_id,
            variant_id: { in: items.map((item) => Number(item.variantId)) },
          },
          data: { assigned_uids: [], inventory_reserved: false },
        });
        return tx.internal_transfers.update({
          where: { id: transferId },
          data: {
            status: "REJECTED_UNFULFILLED",
            notes: `Damaged in transit. Manual replacement required: ${reason}`,
          },
        });
      };

      for (const item of items) {
        const variantId = Number(item.variantId);
        const quantity = Number(item.quantity);
        const medicineId = Number(item.medicineId);
        const orderItem = transfer.orders.order_items.find((oi) => oi.variant_id === variantId);
        if (!orderItem || !Number.isInteger(quantity) || quantity <= 0) {
          throw new BadRequestException("Transfer items do not match the order.");
        }

        const removed = await tx.$executeRaw`
          UPDATE "inventories"
          SET "stock_quantity" = "stock_quantity" - ${quantity},
              "reserved_quantity" = "reserved_quantity" - ${quantity},
              "updated_at" = NOW()
          WHERE "facility_id" = ${transfer.from_facility_id}
            AND "variant_id" = ${variantId}
            AND "stock_quantity" >= ${quantity}
            AND "reserved_quantity" >= ${quantity}
        `;
        if (removed !== 1) {
          throw new BadRequestException(`Damaged stock reservation is inconsistent for variant #${variantId}.`);
        }
        await tx.inventory_logs.create({
          data: {
            facility_id: transfer.from_facility_id,
            medicine_id: medicineId,
            transaction_type: "DAMAGED",
            quantity_changed: -quantity,
            previous_quantity: 0,
            new_quantity: 0,
            reference_code: transfer.transfer_code,
            note: `Damaged in transit to facility #${transfer.to_facility_id} for order #${transfer.orders.order_code}`,
          },
        });

        if (isBoxUnit(orderItem.unit_name)) {
          const damaged = await tx.medicine_boxes.updateMany({
            where: {
              uid: { in: orderItem.assigned_uids },
              current_facility_id: transfer.from_facility_id,
              status: "RESERVED",
            },
            data: { status: "DAMAGED" },
          });
          if (damaged.count !== quantity) {
            throw new BadRequestException(`Damaged package reservation is inconsistent for variant #${variantId}.`);
          }
        }

        const reserved = await tx.$executeRaw`
          UPDATE "inventories"
          SET "reserved_quantity" = "reserved_quantity" + ${quantity},
              "updated_at" = NOW()
          WHERE "facility_id" = ${transfer.from_facility_id}
            AND "variant_id" = ${variantId}
            AND "stock_quantity" - "reserved_quantity" >= ${quantity}
        `;
        if (reserved !== 1) {
          return markUnfulfilled(`Source warehouse has insufficient replacement stock for variant #${variantId}.`);
        }
        replacementReservations.push({ variantId, quantity });

        if (isBoxUnit(orderItem.unit_name)) {
          const boxes = await tx.medicine_boxes.findMany({
            where: {
              current_facility_id: transfer.from_facility_id,
              status: { in: AVAILABLE_BOX_STATUSES },
              medicine_batches: { medicine_id: medicineId },
            },
            select: { uid: true },
            orderBy: [{ medicine_batches: { expiry_date: "asc" } }, { created_at: "asc" }],
            take: quantity,
          });
          if (boxes.length !== quantity) {
            return markUnfulfilled(`Source warehouse has insufficient replacement boxes for variant #${variantId}.`);
          }
          const uids = boxes.map((box) => box.uid);
          for (const uid of uids) {
            const claimed = await tx.medicine_boxes.updateMany({
              where: { uid, current_facility_id: transfer.from_facility_id, status: { in: AVAILABLE_BOX_STATUSES } },
              data: { status: "RESERVED" },
            });
            if (claimed.count !== 1) {
              return markUnfulfilled("Replacement boxes were reserved by another order.");
            }
            claimedReplacementUids.push(uid);
          }
          replacementAssignments.push({ orderItemId: orderItem.id, uids });
        }
      }

      for (const assignment of replacementAssignments) {
        await tx.order_items.update({
          where: { id: assignment.orderItemId },
          data: { assigned_uids: assignment.uids, inventory_reserved: true },
        });
      }
      await tx.internal_transfers.update({
        where: { id: transferId },
        data: { status: "REPLACED" },
      });

      return tx.internal_transfers.create({
        data: {
          transfer_code: `ITR-${datePart}-${randomBytes(4).toString("hex").toUpperCase()}`,
          order_id: transfer.order_id,
          from_facility_id: transfer.from_facility_id,
          to_facility_id: transfer.to_facility_id,
          status: "REQUESTED",
          items,
          distance_km: transfer.distance_km,
          estimated_hours: transfer.estimated_hours,
          notes: `Replacement for damaged transfer #${transfer.transfer_code}`,
        },
      });


    }, authActor(user));
  }

  async adminReceiveInternalTransfer(transferId: number, user: CurrentUserPayload,) {
    return this.prisma.withOrder('receive', async (tx) => {
      // Serialize all receipts for an order before counting its remaining transfers.
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

      if (["CANCELLED", "REJECTED", "REJECTED_UNFULFILLED", "REPLACED"].includes(transfer.status)) {
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

      const received = await tx.internal_transfers.updateMany({
        where: { id: transferId, status: 'DISPATCHED' },
        data: {
          status: "RECEIVED",
          received_at: new Date(),
        },
      });
      if (received.count !== 1) throw new BadRequestException('Transfer status changed. Reload and try again.');

      for (const item of transferItems) {
        const variantId = Number(item.variantId);
        const quantity = Number(item.quantity);
        const medicineId = Number(item.medicineId);

        const deductResult = await tx.$executeRaw`
          UPDATE "inventories"
          SET "stock_quantity" = "stock_quantity" - ${quantity},
              "reserved_quantity" = COALESCE("reserved_quantity", 0) - ${quantity},
              "updated_at" = NOW()
          WHERE "facility_id" = ${transfer.from_facility_id}
            AND "variant_id" = ${variantId}
            AND "stock_quantity" >= ${quantity}
            AND COALESCE("reserved_quantity", 0) >= ${quantity}
        `;

        if (deductResult !== 1) {
          throw new BadRequestException(`Failed to transfer inventory: Source warehouse #${transfer.from_facility_id} has insufficient stock for variant #${variantId}.`);
        }

        const destInv = await tx.inventories.findFirst({
          where: {
            facility_id: transfer.to_facility_id,
            variant_id: variantId,
          },
        });
        if (destInv) {
          await tx.inventories.update({
            where: { id: destInv.id },
            data: {
              stock_quantity: { increment: quantity },
              reserved_quantity: { increment: quantity },
              updated_at: new Date(),
            },
          });
        } else {
          await tx.inventories.create({
            data: {
              facility_id: transfer.to_facility_id,
              variant_id: variantId,
              stock_quantity: quantity,
              reserved_quantity: quantity,
              updated_at: new Date(),
            },
          });
        }

        const orderItem = transfer.orders.order_items.find((oi) => oi.variant_id === variantId);
        let assignedUids = orderItem?.assigned_uids || [];
        if (orderItem && isBoxUnit(orderItem.unit_name)) {
          const needsAssignment = assignedUids.length === 0;
          if (needsAssignment) {
            const boxes = await tx.medicine_boxes.findMany({
              where: {
                current_facility_id: transfer.from_facility_id,
                status: { in: AVAILABLE_BOX_STATUSES },
                medicine_batches: { medicine_id: medicineId },
              },
              select: { uid: true },
              orderBy: [
                { medicine_batches: { expiry_date: "asc" } },
                { created_at: "asc" },
              ],
              take: quantity,
            });
            if (boxes.length !== quantity) {
              throw new BadRequestException(`Not enough physical packages for "${orderItem.medicine_name}" at the source warehouse to receive this transfer.`);
            }
            assignedUids = boxes.map((box) => box.uid);
          }
          const movedBoxes = await tx.medicine_boxes.updateMany({
            where: {
              uid: { in: assignedUids },
              current_facility_id: transfer.from_facility_id,
              status: needsAssignment ? { in: AVAILABLE_BOX_STATUSES } : "RESERVED",
            },
            data: {
              current_facility_id: transfer.to_facility_id,
              status: "RESERVED",
            },
          });
          if (movedBoxes.count !== quantity) {
            throw new BadRequestException("Physical package availability changed. Reload and try receiving the transfer again.");
          }
        }

        if (orderItem) {
          await tx.order_items.update({
            where: { id: orderItem.id },
            data: { source_facility_id: transfer.to_facility_id, assigned_uids: assignedUids },
          });
        }

        await tx.inventory_logs.create({
          data: {
            facility_id: transfer.from_facility_id,
            medicine_id: medicineId,
            transaction_type: "TRANSFER_OUT",
            quantity_changed: -quantity,
            previous_quantity: 0,
            new_quantity: 0,
            reference_code: transfer.transfer_code,
            note: `Transfer to ${transfer.to_facility?.facility_name ?? "facility #" + transfer.to_facility_id} for order #${transfer.orders.order_code}`,
          },
        });

        await tx.inventory_logs.create({
          data: {
            facility_id: transfer.to_facility_id,
            medicine_id: medicineId,
            transaction_type: "TRANSFER_IN",
            quantity_changed: quantity,
            previous_quantity: 0,
            new_quantity: 0,
            reference_code: transfer.transfer_code,
            note: `Received from ${transfer.from_facility?.facility_name ?? "facility #" + transfer.from_facility_id} for order #${transfer.orders.order_code}`,
          },
        });
      }

      const remainingTransfers = await tx.internal_transfers.count({
        where: {
          order_id: transfer.order_id,
          id: { not: transferId },
          status: { notIn: ["RECEIVED", "REPLACED"] },
        },
      });

      if (remainingTransfers === 0) {
        await tx.orders.update({
          where: { id: transfer.order_id },
          data: { order_status: "PROCESSING" },
        });
      }


      return tx.internal_transfers.findUnique({
        where: { id: transferId },
        include: {
          from_facility: true,
          to_facility: true,
        },
      });

    }, authActor(user));
  }
}
