import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { authActor } from "../../common/auth-identity";
import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
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

    if (role === "superadmin") {
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
    return this.prisma.withOrder('read', operation, authActor(user));
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
    const order = await this.executeWithStaffContext(user, (tx) =>
      tx.orders.findFirst({
        where: this.orderAccessWhere(orderId, user),
        include: {
          customers: { select: { id: true, full_name: true, email: true, phone_number: true } },
          ...ORDER_DETAILS_INCLUDE,
        },
      }),
    );

    if (!order) {
      throw new NotFoundException(`Order #${orderId} not found`);
    }



    return formatOrder(order);
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

      if (currentStatus !== targetStatus && ['RETURNED', 'PARTIALLY_RETURNED'].includes(targetStatus)) {
        throw new BadRequestException('Customer returns require an approved RMA; they cannot be confirmed by changing the order status.');
      }
      if (targetStatus === 'COMPLETED' && currentStatus !== targetStatus) {
        throw new BadRequestException('Only the customer can confirm receipt of this order.');
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
        await releaseOrderReservations(tx, orderId, order.export_facility_id);
      }
      if (targetStatus === "COMPLETED" && currentStatus !== targetStatus) {
        const delivered = await tx.shipments.updateMany({
          where: { order_id: orderId, shipping_status: 'IN_TRANSIT' },
          data: {
            shipping_status: "DELIVERED",
            actual_delivery_at: new Date(),
          },
        });
        if (delivered.count !== 1) throw new BadRequestException('Shipment changed. Reload before confirming delivery.');
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


      return formatOrder(await tx.orders.findFirst({ where: this.orderAccessWhere(orderId, user), include: ORDER_DETAILS_INCLUDE }));

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
          courier_name: dto?.courierName?.trim().toUpperCase() || "EXPRESS_LOGISTICS",
          shipping_status: "PENDING_PICKUP",
          cod_amount: order.payment_method === "COD" ? order.total_amount : 0,
          note: dto?.shippingNote || null,
        },
      });

      await tx.orders.update({
        where: { id: orderId },
        data: { order_status: "SHIPPING" },
      });


      return formatOrder(await tx.orders.findFirst({ where: this.orderAccessWhere(orderId, user), include: ORDER_DETAILS_INCLUDE }));

    }, authActor(user));
  }

}
