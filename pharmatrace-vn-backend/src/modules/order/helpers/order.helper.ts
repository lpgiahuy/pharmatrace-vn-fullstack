import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export const ORDER_DETAILS_INCLUDE = {
  order_items: { include: { medicines: true, source_facility: true } },
  shipments: true,
  facilities: true,
  internal_transfers: {
    include: {
      from_facility: true,
      to_facility: true,
    },
  },
} as const satisfies Prisma.ordersInclude;

export const AVAILABLE_BOX_STATUSES = [
  "IN_STOCK",
  "MANUFACTURED",
];

export function isBoxUnit(unitName?: string | null): boolean {
  if (!unitName) return true;
  const s = unitName.trim().toUpperCase();
  const knownKeywords = [
    "BOX",
    "BLISTER",
    "BOTTLE",
    "VIAL",
    "TUBE",
    "PACK",
    "SACHET",
    "AMPOULE",
    "PILL",
    "TABLET",
    "CAPSULE",
  ];
  return knownKeywords.some((kw) => s.includes(kw));
}

export function normalizeOrderStatus(status?: string | null): string {
  if (!status) return "PENDING";
  const s = status.trim().toUpperCase();
  if (["PENDING"].includes(s)) return "PENDING";
  if (["WAITING_INTERNAL_TRANSFER", "WAITING_TRANSFER"].includes(s))
    return "WAITING_INTERNAL_TRANSFER";
  if (["PROCESSING"].includes(s)) return "PROCESSING";
  if (["SHIPPING", "IN_TRANSIT"].includes(s)) return "SHIPPING";
  if (["COMPLETED", "DELIVERED"].includes(s)) return "COMPLETED";
  if (["CANCELLED", "CANCELED"].includes(s)) return "CANCELLED";
  if (["RETURNED", "PARTIALLY_RETURNED"].includes(s))
    return "RETURNED";
  return status;
}

export const STATUS_DB_MAPPINGS: Record<string, string[]> = {
  PENDING: ["PENDING"],
  WAITING_INTERNAL_TRANSFER: ["WAITING_INTERNAL_TRANSFER", "WAITING_TRANSFER"],
  PROCESSING: ["PROCESSING"],
  SHIPPING: ["SHIPPING", "IN_TRANSIT"],
  COMPLETED: ["COMPLETED", "DELIVERED"],
  CANCELLED: ["CANCELLED", "CANCELED"],
  RETURNED: ["RETURNED", "PARTIALLY_RETURNED"],
  PARTIALLY_RETURNED: ["RETURNED", "PARTIALLY_RETURNED"],
};

function normalizePaymentStatus(status?: string | null): string {
  if (!status) return "UNPAID";
  const s = status.trim().toUpperCase();
  if (["PAID"].includes(s)) return "PAID";
  if (["UNPAID"].includes(s)) return "UNPAID";
  if (["REFUNDED"].includes(s)) return "REFUNDED";
  return status;
}

function normalizePaymentMethod(method?: string | null): string {
  if (!method) return "COD";
  const s = method.trim().toUpperCase();
  if (["COD", "CASH"].includes(s)) return "COD";
  if (["BANK_TRANSFER", "VIETQR", "BANK"].includes(s)) return "BANK_TRANSFER";
  if (["E_WALLET", "VNPAY", "MOMO", "ZALOPAY"].includes(s)) return "E_WALLET";
  return method;
}

export async function releaseOrderReservations(
  tx: Prisma.TransactionClient,
  orderId: number,
  facilityId: number | null,
): Promise<void> {
  const reservedItems = await tx.order_items.findMany({
    where: { order_id: orderId, inventory_reserved: true },
    select: {
      id: true,
      variant_id: true,
      quantity: true,
      assigned_uids: true,
      source_facility_id: true,
    },
  });

  for (const item of reservedItems) {
    if (!item.variant_id) continue;
    const targetFacilityId = item.source_facility_id ?? facilityId;
    if (!targetFacilityId) continue;

    const releasedInventoryRows = await tx.$executeRaw`
        UPDATE "inventories"
        SET "reserved_quantity" = COALESCE("reserved_quantity", 0) - ${item.quantity},
            "updated_at" = NOW()
        WHERE "facility_id" = ${targetFacilityId}
          AND "variant_id" = ${item.variant_id}
          AND COALESCE("reserved_quantity", 0) >= ${item.quantity}
      `;
    if (releasedInventoryRows !== 1) {
      throw new BadRequestException("The order inventory reservation is inconsistent and could not be released.",);
    }

    if (item.assigned_uids.length > 0) {
      await tx.medicine_boxes.updateMany({
        where: {
          uid: { in: item.assigned_uids },
          current_facility_id: targetFacilityId,
          status: "RESERVED",
        },
        data: { status: "IN_STOCK" },
      });
    }

    await tx.order_items.update({
      where: { id: item.id },
      data: {
        inventory_reserved: false,
        assigned_uids: [],
      },
    });
  }

  await tx.internal_transfers.updateMany({
    where: {
      order_id: orderId,
      status: { notIn: ["RECEIVED", "CANCELLED"] },
    },
    data: {
      status: "CANCELLED",
      notes: "Cancelled automatically due to order cancellation",
    },
  });
}

export function formatOrder(order: any) {
  const voucherDiscount = Number(order.discount_amount || 0);
  const usedPoints = Number(order.used_points || 0);

  const formattedShipment = order.shipments
    ? {
      id: order.shipments.id,
      trackingNumber: order.shipments.tracking_number,
      courierName: order.shipments.courier_name,
      shippingStatus: order.shipments.shipping_status,
      codAmount: Number(order.shipments.cod_amount || 0),
      shippedAt: order.shipments.shipped_at,
      deliveredAt: order.shipments.delivered_at,
      createdAt: order.shipments.created_at,
    }
    : undefined;

  const formattedItems = (order.order_items || []).map((item: any) => {
    const medicine = item.medicines
      ? {
        id: item.medicines.id,
        name: item.medicines.medicine_name,
        imageUrl: item.medicines.image_url,
        images: item.medicines.image_url ? [item.medicines.image_url] : [],
        slug: item.medicines.slug,
        isPrescription: item.medicines.is_prescription,
      }
      : undefined;

    return {
      id: item.id,
      orderId: item.order_id,
      medicineId: item.medicine_id,
      variantId: item.variant_id,
      medicineName: item.medicine_name,
      unitName: item.unit_name,
      quantity: item.quantity,
      unitPrice: Number(item.unit_price || 0),
      totalPrice: Number(item.total_price || 0),
      assignedUids: item.assigned_uids || [],
      sourceFacilityId: item.source_facility_id ?? order.export_facility_id,
      sourceFacilityName: item.source_facility?.facility_name ?? undefined,
      medicine,
      variant: {
        id: item.variant_id,
        unitName: item.unit_name,
        price: Number(item.unit_price || 0),
        medicine,
      },
    };
  });

  const formattedTransfers = (order.internal_transfers || []).map((t: any) => ({
    id: t.id,
    transferCode: t.transfer_code,
    fromFacilityId: t.from_facility_id,
    fromFacilityName: t.from_facility?.facility_name ?? `Facility #${t.from_facility_id}`,
    toFacilityId: t.to_facility_id,
    toFacilityName: t.to_facility?.facility_name ?? `Facility #${t.to_facility_id}`,
    status: t.status,
    items: t.items,
    trackingCode: t.tracking_code,
    distanceKm: Number(t.distance_km || 0),
    estimatedHours: t.estimated_hours,
    notes: t.notes,
    dispatchedAt: t.dispatched_at,
    receivedAt: t.received_at,
    createdAt: t.created_at,
  }));

  return {
    id: order.id,
    orderCode: order.order_code,
    customerId: order.customer_id,
    exportFacilityId: order.export_facility_id,
    exportFacility: order.facilities
      ? {
        id: order.facilities.id,
        facilityName: order.facilities.facility_name,
        address: order.facilities.address,
      }
      : undefined,
    prescriptionId: order.prescription_id,
    prescriptionReviewStatus: order.prescription_review_status,
    subtotalAmount: Number(order.subtotal_amount || 0),
    shippingFee: Number(order.shipping_fee || 0),
    discountAmount: voucherDiscount,
    voucherDiscount: voucherDiscount,
    pointsDiscount: usedPoints,
    usedPoints: usedPoints,
    totalAmount: Number(order.total_amount || 0),
    paymentMethod: normalizePaymentMethod(order.payment_method),
    paymentStatus: normalizePaymentStatus(order.payment_status),
    orderStatus: normalizeOrderStatus(order.order_status),
    shippingAddress: order.shipping_address,
    recipientName: order.recipient_name,
    recipientPhone: order.recipient_phone,
    note: order.note,
    createdAt: order.created_at,
    customer: order.customers
      ? {
        id: order.customers.id,
        fullName: order.customers.full_name,
        phone: order.customers.phone_number,
        email: order.customers.email,
      }
      : undefined,
    items: formattedItems,
    orderItems: formattedItems,
    shipment: formattedShipment,
    shipments: formattedShipment ? [formattedShipment] : [],
    internalTransfers: formattedTransfers,
  };
}
