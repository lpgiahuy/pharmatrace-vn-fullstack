import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { OrderQueryDto } from "./dto/order-query.dto";
import { UpdateOrderStatusDto } from "./dto/update-order-status.dto";
import { PackOrderDto } from "./dto/pack-order.dto";
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

  private getFacilityScope(user: CurrentUserPayload): number | null {
    const role = (user?.role || "").toString().toLowerCase().replace(/_/g, "");

    if (role === "superadmin" || role === "admin") {
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

    const [total, orders] = await Promise.all([
      this.prisma.orders.count({ where }),
      this.prisma.orders.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: query.sort === "oldest" ? "asc" : "desc" },
        include: {
          customers: true,
          ...ORDER_DETAILS_INCLUDE,
        },
      }),
    ]);

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
    const order = await this.prisma.orders.findFirst({
      where: this.orderAccessWhere(orderId, user),
      include: {
        customers: true,
        ...ORDER_DETAILS_INCLUDE,
      },
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    return formatOrder(order);
  }

  async adminUpdateOrderStatus(orderId: number, dto: UpdateOrderStatusDto, user: CurrentUserPayload) {
    const order = await this.prisma.orders.findFirst({
      where: this.orderAccessWhere(orderId, user),
    });

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }

    const currentStatus = normalizeOrderStatus(order.order_status || "PENDING");
    const targetStatus = dto.orderStatus
      ? normalizeOrderStatus(dto.orderStatus)
      : currentStatus;

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

    const updateData: any = {
      order_status: targetStatus,
    };

    if (dto.paymentStatus) {
      updateData.payment_status = dto.paymentStatus;
    }
    if (dto.note) {
      updateData.note = dto.note;
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.orders.updateMany({
        where: { id: orderId, order_status: order.order_status },
        data: updateData,
      });
      if (updated.count !== 1) throw new BadRequestException('Order status changed. Reload and try again.');

      if (targetStatus === "CANCELLED" && currentStatus !== targetStatus) {
        await releaseOrderReservations(tx, orderId, order.export_facility_id);
      }
      if (targetStatus === "COMPLETED") {
        await tx.shipments.updateMany({
          where: { order_id: orderId },
          data: {
            shipping_status: "DELIVERED",
            actual_delivery_at: new Date(),
          },
        });
      }

      if (
        targetStatus === "CANCELLED" &&
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

      if (
        (targetStatus === "RETURNED" ||
          targetStatus === "PARTIALLY_RETURNED") &&
        currentStatus !== targetStatus &&
        order.customer_id
      ) {
        const earnedLog = await tx.loyalty_point_logs.findFirst({
          where: {
            order_id: orderId,
            transaction_type: { in: ["EARN", "EARNED"] },
          },
        });
        if (earnedLog && earnedLog.points > 0) {
          await tx.customers.update({
            where: { id: order.customer_id },
            data: { reward_points: { decrement: earnedLog.points } },
          });
          await tx.loyalty_point_logs.create({
            data: {
              customer_id: order.customer_id,
              order_id: orderId,
              transaction_type: "EARN_REVERSAL",
              points: -earnedLog.points,
              description: `Reverted ${earnedLog.points} points for order #${order.order_code} due to return`,
            },
          });
        }
      }
    });

    return this.adminGetOrderById(orderId, user);
  }

  async adminGetAvailableBoxesForOrder(orderId: number, user: CurrentUserPayload) {
    const order = await this.prisma.orders.findFirst({
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
        ? await this.prisma.medicine_boxes.findMany({
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

      const available = await this.prisma.medicine_boxes.findMany({
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
  }

  async adminPackOrder(orderId: number, dto: PackOrderDto | undefined, user: CurrentUserPayload) {
    const order = await this.prisma.orders.findFirst({
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
        ? await this.prisma.medicine_boxes.findMany({
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
      const availableForMed = boxesByMedicine.get(item.medicine_id!) || [];
      if (availableForMed.length < item.quantity) {
        throw new BadRequestException(
          `Verified packages do not match medicine "${item.medicine_name}". Required: ${item.quantity}, provided: ${availableForMed.length}.`,
        );
      }
    }

    const reservedBoxMap = new Map(boxesToPack.map((box) => [box.uid, box]));

    await this.prisma.$transaction(async (tx) => {
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

        const updatedInventoryRows = await tx.$executeRaw`
          UPDATE "inventories"
          SET "stock_quantity" = "stock_quantity" - ${countNeeded},
              "reserved_quantity" = COALESCE("reserved_quantity", 0) - ${countNeeded},
              "updated_at" = NOW()
          WHERE "facility_id" = ${order.export_facility_id}
            AND "variant_id" = ${item.variant_id}
            AND "stock_quantity" >= ${countNeeded}
            AND COALESCE("reserved_quantity", 0) >= ${countNeeded}
        `;
        if (updatedInventoryRows !== 1) {
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
            transaction_type: "ORDER_PACKED",
            quantity_changed: -countNeeded,
            previous_quantity: inventory.stock_quantity,
            new_quantity: inventory.stock_quantity - countNeeded,
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
          courier_name: dto?.courierName?.trim() || "EXPRESS_LOGISTICS",
          shipping_status: "PENDING_PICKUP",
          cod_amount: order.payment_method === "COD" ? order.total_amount : 0,
          note: dto?.shippingNote || null,
        },
      });

      await tx.orders.update({
        where: { id: orderId },
        data: { order_status: "SHIPPING" },
      });
    });

    return this.adminGetOrderById(orderId, user);
  }

  async adminGetInternalTransfers(orderId: number | undefined, user: CurrentUserPayload,) {
    const facilityId = this.getFacilityScope(user);
    const where: any = {};
    if (orderId) {
      where.order_id = orderId;
    }
    if (facilityId !== null) {
      where.OR = [
        { from_facility_id: facilityId },
        { to_facility_id: facilityId },
      ];
    }
    return this.prisma.internal_transfers.findMany({
      where,
      orderBy: { created_at: "desc" },
      include: {
        from_facility: true,
        to_facility: true,
        orders: {
          select: {
            id: true,
            order_code: true,
            order_status: true,
            recipient_name: true,
          },
        },
      },
    });
  }

  async adminDispatchInternalTransfer(transferId: number, trackingCode: string | undefined, user: CurrentUserPayload,) {
    const facilityId = this.getFacilityScope(user);
    const transfer = await this.prisma.internal_transfers.findFirst({
      where: facilityId === null ? { id: transferId } : { id: transferId, from_facility_id: facilityId },
    });
    if (!transfer) {
      throw new NotFoundException(`Internal transfer #${transferId} not found`);
    }
    const transferOrder = await this.prisma.orders.findUnique({
      where: { id: transfer.order_id },
      select: { prescription_review_status: true, order_status: true },
    });
    if (!transferOrder || transferOrder.order_status === 'CANCELLED' || (transferOrder.prescription_review_status && transferOrder.prescription_review_status !== 'APPROVED')) {
      throw new BadRequestException('This transfer cannot be dispatched before pharmacist approval');
    }
    if (["CANCELLED", "REJECTED", "REJECTED_UNFULFILLED", "REPLACED", "RECEIVED"].includes(transfer.status)) {
      throw new BadRequestException(`Cannot dispatch transfer #${transferId} because its status is ${transfer.status}.`);
    }

    return this.prisma.internal_transfers.update({
      where: { id: transferId },
      data: {
        status: "DISPATCHED",
        tracking_code:
          trackingCode ||
          transfer.tracking_code ||
          `ITR-TRK-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
        dispatched_at: new Date(),
      },
      include: {
        from_facility: true,
        to_facility: true,
        orders: true,
      },
    });
  }

  async adminRejectDamagedInternalTransfer(transferId: number, user: CurrentUserPayload) {
    const facilityId = this.getFacilityScope(user);
    const transfer = await this.prisma.internal_transfers.findFirst({
      where: facilityId === null ? { id: transferId } : { id: transferId, to_facility_id: facilityId },
      include: { orders: { include: { order_items: true } } },
    });
    if (!transfer) {
      throw new NotFoundException(`Internal transfer #${transferId} not found`);
    }
    if (transfer.status !== "DISPATCHED" || transfer.orders.order_status !== "WAITING_INTERNAL_TRANSFER") {
      throw new BadRequestException("Only dispatched transfers for waiting orders can be rejected as damaged.");
    }

    const items = (transfer.items as any[]) || [];
    if (items.length === 0) {
      throw new BadRequestException("Transfer has no items to replace.");
    }
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    return this.prisma.$transaction(async (tx) => {
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
          items: transfer.items as any,
          distance_km: transfer.distance_km,
          estimated_hours: transfer.estimated_hours,
          notes: `Replacement for damaged transfer #${transfer.transfer_code}`,
        },
      });
    });
  }

  async adminReceiveInternalTransfer(transferId: number, user: CurrentUserPayload,) {
    const facilityId = this.getFacilityScope(user);
    const transfer = await this.prisma.internal_transfers.findFirst({
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

    const transferItems = (transfer.items as any[]) || [];

    await this.prisma.$transaction(async (tx) => {
      await tx.internal_transfers.update({
        where: { id: transferId },
        data: {
          status: "RECEIVED",
          received_at: new Date(),
        },
      });

      for (const item of transferItems) {
        const variantId = Number(item.variantId);
        const quantity = Number(item.quantity);
        const medicineId = Number(item.medicineId);

        const deductResult = await tx.$executeRaw`
          UPDATE "inventories"
          SET "stock_quantity" = "stock_quantity" - ${quantity},
              "reserved_quantity" = GREATEST(0, COALESCE("reserved_quantity", 0) - ${quantity}),
              "updated_at" = NOW()
          WHERE "facility_id" = ${transfer.from_facility_id}
            AND "variant_id" = ${variantId}
            AND "stock_quantity" >= ${quantity}
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
        if (orderItem && orderItem.assigned_uids.length > 0) {
          await tx.medicine_boxes.updateMany({
            where: {
              uid: { in: orderItem.assigned_uids },
              current_facility_id: transfer.from_facility_id,
            },
            data: {
              current_facility_id: transfer.to_facility_id,
            },
          });
        }

        if (orderItem) {
          await tx.order_items.update({
            where: { id: orderItem.id },
            data: { source_facility_id: transfer.to_facility_id },
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
    });

    return this.prisma.internal_transfers.findUnique({
      where: { id: transferId },
      include: {
        from_facility: true,
        to_facility: true,
        orders: true,
      },
    });
  }
}
