import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { Prisma, vouchers } from '@prisma/client';
import { PrismaService } from "../../prisma/prisma.service";
import { getVariantPrice } from '../../common/variant-price';
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrderQueryDto } from "./dto/order-query.dto";
import { CancelOrderDto } from "./dto/cancel-order.dto";
import {
  calculateHaversineDistance,
  calculateShippingFeeByDistance,
  calculateEstimatedDelivery,
  FREE_SHIPPING_THRESHOLD,
  DEFAULT_SHIPPING_FEE,
} from "./helpers/shipping-calculator.helper";
import { geocodeAddress, isValidCoordinates } from "./helpers/geocoding.helper";
import {
  ORDER_DETAILS_INCLUDE,
  STATUS_DB_MAPPINGS,
  formatOrder,
  isBoxUnit,
  normalizeOrderStatus,
  releaseOrderReservations,
  AVAILABLE_BOX_STATUSES,
} from "./helpers/order.helper";

@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) { }

  async createOrder(customerId: number, dto: CreateOrderDto, quoteOnly = false) {
    const customer = await this.prisma.withAuth(tx => tx.customers.findUnique({
      where: { id: customerId },
    }), { actor: { id: customerId, type: 'customer', role: 'CUSTOMER' } });
    if (!customer) {
      throw new NotFoundException("Customer account not found");
    }

    interface ItemToOrder {
      variantId: number;
      medicineId: number;
      medicineName: string;
      unitName: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
      isPrescription: boolean;
    }

    const variantIds = dto.items.map((i) => i.variantId);
    const variants = await this.prisma.packaging_variants.findMany({
      where: { id: { in: variantIds } },
      include: {
        medicine: true,
      },
    });

    const itemsToOrder: ItemToOrder[] = [];
    const pricingTime = new Date();

    for (const itemDto of dto.items) {
      const variant = variants.find((v) => v.id === itemDto.variantId);
      if (!variant) {
        throw new BadRequestException(
          `Product variant #${itemDto.variantId} not found`,
        );
      }
      if (variant.medicine.status !== "ACTIVE") {
        throw new BadRequestException(
          `Medicine "${variant.medicine.medicine_name}" is currently not available for purchase`,
        );
      }

      const unitPrice = getVariantPrice(variant, pricingTime).price;
      const totalPrice = unitPrice * itemDto.quantity;
      const existingItem = itemsToOrder.find((item) => item.variantId === variant.id);
      if (existingItem) {
        existingItem.quantity += itemDto.quantity;
        existingItem.totalPrice += totalPrice;
        continue;
      }

      itemsToOrder.push({
        variantId: variant.id,
        medicineId: variant.medicine_id,
        medicineName: variant.medicine.medicine_name,
        unitName: variant.unit_name,
        quantity: itemDto.quantity,
        unitPrice,
        totalPrice,
        isPrescription: Boolean(variant.medicine.is_prescription),
      });
    }

    const hasPrescriptionDrug = itemsToOrder.some((i) => i.isPrescription);
    if (!hasPrescriptionDrug && dto.prescriptionId) {
      throw new BadRequestException('A prescription can only be attached to an order containing prescription medicine');
    }
    if (hasPrescriptionDrug && !dto.prescriptionId) {
      throw new BadRequestException("Your order contains prescription drugs (Rx). Please provide or upload an approved doctor prescription.");
    }

    if (dto.prescriptionId) {
      const prescription = await this.prisma.withActor(
        { id: customerId, role: 'CUSTOMER', type: 'customer' },
        (tx) => tx.prescriptions.findFirst({
          where: { id: dto.prescriptionId, customer_id: customerId },
          select: { id: true },
        }),
      );
      if (!prescription) {
        throw new BadRequestException("Invalid prescription or prescription does not belong to your account");
      }
    }

    const subtotal = itemsToOrder.reduce((acc, item) => acc + item.totalPrice, 0);

    let discountFromVoucher = 0;
    let appliedVoucherId: number | null = null;
    let voucherSnapshot: vouchers | null = null;
    if (dto.voucherCode) {
      const voucher = await this.prisma.withVoucher('validate', tx => tx.vouchers.findFirst({
        where: { voucher_code: { equals: dto.voucherCode!.trim().toUpperCase(), mode: 'insensitive' } },
      }), { code: dto.voucherCode });

      if (!voucher || voucher.status !== "ACTIVE") {
        throw new BadRequestException("Promo voucher code is invalid or no longer active");
      }

      const now = new Date();
      if (voucher.start_date && now < new Date(voucher.start_date)) {
        throw new BadRequestException("This voucher has not started yet");
      }
      if (voucher.end_date && now > new Date(voucher.end_date)) {
        throw new BadRequestException("This voucher has expired");
      }
      if (!voucher.total_quantity || voucher.total_quantity <= 0) {
        throw new BadRequestException("This voucher has no valid usage limit configured");
      }
      if ((voucher.used_quantity || 0) >= voucher.total_quantity) {
        throw new BadRequestException("This voucher has reached its total usage limit");
      }
      if (subtotal < Number(voucher.min_order_value || 0)) {
        throw new BadRequestException(`Order subtotal must be at least ${Number(voucher.min_order_value).toLocaleString("vi-VN")}₫ to apply this voucher`);
      }

      if (voucher.discount_type === "PERCENT") {
        discountFromVoucher = (subtotal * Number(voucher.discount_value)) / 100;
        if (voucher.max_discount_amount) {
          discountFromVoucher = Math.min(discountFromVoucher, Number(voucher.max_discount_amount));
        }
      } else {
        discountFromVoucher = Number(voucher.discount_value);
      }

      discountFromVoucher = Math.min(discountFromVoucher, subtotal);
      appliedVoucherId = voucher.id;
      voucherSnapshot = voucher;
    }

    let usedPoints = dto.usedPoints || 0;
    if (usedPoints > 0) {
      if (usedPoints > (customer.reward_points || 0)) {
        throw new BadRequestException(`You only have ${customer.reward_points || 0} reward points available to redeem`);
      }
      const maxAllowedPoints = Math.min(customer.reward_points || 0, Math.floor(subtotal * 0.2));
      usedPoints = Math.min(usedPoints, maxAllowedPoints);
      const remainingAfterVoucher = Math.max(0, subtotal - discountFromVoucher);
      usedPoints = Math.min(usedPoints, remainingAfterVoucher);
    }
    const totalDiscount = discountFromVoucher + usedPoints;

    // If the client already sent GPS coordinates (e.g. from browser Geolocation API),
    // use them directly. Otherwise resolve the shipping address via the geocoding providers.
    const customerCoords = dto.latitude !== undefined && dto.longitude !== undefined
      ? { latitude: dto.latitude, longitude: dto.longitude }
      : await geocodeAddress(dto.shippingAddress);

    const hasValidCustomerCoords =
      customerCoords !== null &&
      customerCoords !== undefined &&
      isValidCoordinates(customerCoords.latitude, customerCoords.longitude);

    const hasRouteableCustomerCoords =
      customerCoords !== null &&
      customerCoords !== undefined &&
      hasValidCustomerCoords &&
      (!("precision" in customerCoords) || ["house", "alley", "street"].includes(customerCoords.precision));

    const allFacilities = await this.prisma.facilities.findMany({
      where: { facility_type: { in: ['CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE', 'PHARMACY'] } },
      include: {
        inventories: {
          where: {
            variant_id: { in: itemsToOrder.map((i) => i.variantId) },
          },
        },
      },
      orderBy: { id: "asc" },
    });

    const medicineIds = [...new Set(itemsToOrder.map(item => item.medicineId))].sort((a, b) => a - b);
    const policies = await this.prisma.withOrder('read', tx => tx.$queryRaw<Array<{
      facility_id: number; selling_facility_id: number; selling_facility_name: string;
      radius_km: Prisma.Decimal; revision: string; requirements_revision: string;
    }>>`SELECT * FROM public.fulfillment_options(${medicineIds}::integer[])`,
    { id: customerId, type: 'customer', role: 'CUSTOMER' });
    if (!hasRouteableCustomerCoords) {
      throw new BadRequestException('Confirm an accurate delivery location before requesting a delivery quote.');
    }

    const getAvailableStock = (facility: (typeof allFacilities)[0], variantId: number) => {
      const inv = facility.inventories.find((entry) => entry.variant_id === variantId);
      return inv ? Math.max(0, inv.stock_quantity - (inv.reserved_quantity ?? 0)) : 0;
    };

    const scoredFacilities = allFacilities.map((facility) => ({
      facility,
      coveredCount: itemsToOrder.filter((item) => getAvailableStock(facility, item.variantId) >= item.quantity).length,
      distanceToCustomer:
        hasRouteableCustomerCoords && customerCoords && facility.latitude !== null && facility.longitude !== null
          && isValidCoordinates(Number(facility.latitude), Number(facility.longitude))
          ? calculateHaversineDistance(customerCoords.latitude, customerCoords.longitude, Number(facility.latitude), Number(facility.longitude))
          : Number.POSITIVE_INFINITY,
    })).filter(candidate => {
      const policy = policies.find(policy => policy.facility_id === candidate.facility.id);
      return policy && candidate.distanceToCustomer <= Number(policy.radius_km);
    });
    scoredFacilities.sort((a, b) =>
      (b.coveredCount - a.coveredCount) || (a.distanceToCustomer - b.distanceToCustomer),
    );
    const primaryFacilityObj = scoredFacilities[0]?.facility;
    if (!primaryFacilityObj) {
      throw new BadRequestException("No suitable fulfillment facility found.");
    }
    const exportFacilityId = primaryFacilityObj.id;
    const policy = policies.find(policy => policy.facility_id === exportFacilityId)!;
    const missingItems = itemsToOrder.filter((item) => getAvailableStock(primaryFacilityObj, item.variantId) < item.quantity);

    let orderInitialStatus = "PENDING";
    const itemSourceFacilityMap = new Map<number, number>();
    let internalTransferPlan: {
      fromFacilityId: number;
      fromFacilityName: string;
      toFacilityId: number;
      distanceKm: number;
      items: {
        variantId: number;
        medicineId: number;
        medicineName: string;
        unitName: string;
        quantity: number;
      }[];
    }[] = [];

    itemsToOrder
      .filter((item) => getAvailableStock(primaryFacilityObj, item.variantId) >= item.quantity)
      .forEach((item) => itemSourceFacilityMap.set(item.variantId, exportFacilityId));

    if (missingItems.length > 0) {
      for (const item of itemsToOrder) {
        const totalNetworkStock = allFacilities.reduce((sum, f) => sum + getAvailableStock(f, item.variantId), 0);
        if (totalNetworkStock < item.quantity) {
          throw new BadRequestException(`Medicine "${item.medicineName}" (${item.unitName}) is out of stock across the entire fulfillment network.`);
        }
      }

      const transfersBySource = new Map<number, {
        sourceFacility: (typeof allFacilities)[0];
        distanceKm: number;
        items: typeof missingItems;
      }>();

      for (const item of missingItems) {
        const eligibleSources = allFacilities.filter((f) => f.id !== exportFacilityId && policies.some(policy => policy.facility_id === f.id) && getAvailableStock(f, item.variantId) >= item.quantity);

        if (eligibleSources.length === 0) {
          throw new BadRequestException(`Medicine "${item.medicineName}" (${item.unitName}) does not have sufficient inventory at any single source warehouse to transfer.`);
        }

        const sourceCandidatesWithDistance = eligibleSources.map((sourceFac) => {
          const distanceKm = calculateHaversineDistance(
            Number(primaryFacilityObj.latitude),
            Number(primaryFacilityObj.longitude),
            Number(sourceFac.latitude),
            Number(sourceFac.longitude),
          );
          return { facility: sourceFac, distanceKm };
        });

        sourceCandidatesWithDistance.sort((a, b) => a.distanceKm - b.distanceKm);
        const bestSource = sourceCandidatesWithDistance[0];

        itemSourceFacilityMap.set(item.variantId, bestSource.facility.id);

        if (!transfersBySource.has(bestSource.facility.id)) {
          transfersBySource.set(bestSource.facility.id, {
            sourceFacility: bestSource.facility,
            distanceKm: bestSource.distanceKm,
            items: [],
          });
        }
        transfersBySource.get(bestSource.facility.id)!.items.push(item);
      }

      internalTransferPlan = Array.from(transfersBySource.values()).map((entry) => ({
        fromFacilityId: entry.sourceFacility.id,
        fromFacilityName: entry.sourceFacility.facility_name,
        toFacilityId: exportFacilityId,
        distanceKm: Math.round(entry.distanceKm * 10) / 10,
        items: entry.items.map((i) => ({
          variantId: i.variantId,
          medicineId: i.medicineId,
          medicineName: i.medicineName,
          unitName: i.unitName,
          quantity: i.quantity,
        })),
      }));

      orderInitialStatus = (dto.paymentMethod || 'COD') === 'COD' ? "WAITING_INTERNAL_TRANSFER" : "PENDING";
    }

    const exportFacility = allFacilities.find((f) => f.id === exportFacilityId);
    const candidateDistanceKm =
      hasRouteableCustomerCoords && customerCoords && exportFacility?.latitude && exportFacility?.longitude && isValidCoordinates(Number(exportFacility.latitude), Number(exportFacility.longitude))
        ? calculateHaversineDistance(customerCoords.latitude, customerCoords.longitude, Number(exportFacility.latitude), Number(exportFacility.longitude))
        : null;

    const shippingFee = candidateDistanceKm !== null
      ? calculateShippingFeeByDistance(candidateDistanceKm, subtotal)
      : subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : DEFAULT_SHIPPING_FEE;

    const totalAmount = Math.max(0, subtotal + shippingFee - totalDiscount);

    const isConsolidated = internalTransferPlan.length > 0;
    const deliveryEstimate = calculateEstimatedDelivery(candidateDistanceKm, isConsolidated);
    if (!deliveryEstimate.isServiceable) {
      throw new BadRequestException('The selected shipping address is outside our delivery coverage area.');
    }

    const planHash = createHash('sha256').update(JSON.stringify({
      facilityId: exportFacilityId,
      policyRevision: policy.revision,
      requirementsRevision: policy.requirements_revision,
      sellingFacilityId: policy.selling_facility_id,
      estimatedHours: deliveryEstimate.estimatedHours,
      items: itemsToOrder.map(item => ({ variantId: item.variantId, quantity: item.quantity, unitPrice: item.unitPrice })).sort((a, b) => a.variantId - b.variantId),
      shippingFee,
      discountFromVoucher,
      usedPoints,
      transfers: internalTransferPlan.map(transfer => ({ source: transfer.fromFacilityId,
        items: transfer.items.map(item => ({ variantId: item.variantId, quantity: item.quantity })).sort((a, b) => a.variantId - b.variantId),
      })).sort((a, b) => a.source - b.source),
    })).digest('hex');

    if (quoteOnly) {
      return {
        subtotalAmount: subtotal,
        shippingFee,
        discountAmount: totalDiscount,
        voucherDiscount: discountFromVoucher,
        pointsDiscount: usedPoints,
        totalAmount,
        facilityId: exportFacilityId,
        facilityName: primaryFacilityObj.facility_name,
        sellingFacilityId: policy.selling_facility_id,
        sellingFacilityName: policy.selling_facility_name,
        distanceKm: candidateDistanceKm ? Math.round(candidateDistanceKm * 10) / 10 : null,
        estimatedDeliveryHours: deliveryEstimate.estimatedHours,
        estimatedDeliveryLabel: deliveryEstimate.label,
        isConsolidated,
        planHash,
        transferPlan: internalTransferPlan,
      };
    }
    if ((dto.expectedTotalAmount !== undefined && dto.expectedTotalAmount !== totalAmount) ||
        (dto.expectedShippingFee !== undefined && dto.expectedShippingFee !== shippingFee) ||
        (dto.expectedFacilityId !== undefined && dto.expectedFacilityId !== exportFacilityId) ||
        (dto.expectedPlanHash !== undefined && dto.expectedPlanHash !== planHash)) {
      throw new BadRequestException('Your delivery quote has changed. Review the updated quote before placing your order.');
    }

    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const orderCode = `ORD-${datePart}-${randomBytes(4).toString("hex").toUpperCase()}`;

    const saveOrder = async (tx: Prisma.TransactionClient) => {
      if (appliedVoucherId) {
        await this.prisma.prepareVoucher(tx, 'checkout', dto.voucherCode);
        const locked = await tx.$queryRaw<{ id: number }[]>`SELECT id FROM public.vouchers WHERE id = ${appliedVoucherId} FOR UPDATE`;
        if (!locked.length) throw new BadRequestException('Voucher is no longer available. Please try again.');
      }
      const order = await tx.orders.create({
        data: {
          order_code: orderCode,
          customer_id: customerId,
          ...(appliedVoucherId ? { voucher_id: appliedVoucherId } : {}),
          export_facility_id: exportFacilityId,
          prescription_id: dto.prescriptionId || null,
          prescription_review_status: hasPrescriptionDrug ? 'PENDING_APPROVAL' : null,
          subtotal_amount: subtotal,
          shipping_fee: shippingFee,
          discount_amount: discountFromVoucher,
          used_points: usedPoints,
          total_amount: totalAmount,
          payment_method: dto.paymentMethod || "COD",
          payment_status: "UNPAID",
          order_status: orderInitialStatus,
          shipping_address: dto.shippingAddress,
          recipient_name: dto.recipientName,
          recipient_phone: dto.recipientPhone,
          note: dto.note || null,
        },
      });

      if (hasPrescriptionDrug && dto.prescriptionId) {
        await tx.order_prescription_reviews.create({
          data: {
            order_id: order.id,
            prescription_id: dto.prescriptionId,
            facility_id: exportFacilityId,
            status: 'PENDING_APPROVAL',
          },
        });
      }

      const reservedUidsByVariant = new Map<number, string[]>();

      for (const item of itemsToOrder) {
        const sourceFacilityId = itemSourceFacilityMap.get(item.variantId) ?? exportFacilityId;

        const reservedInventoryRows = await tx.$executeRaw`
          UPDATE "inventories"
          SET "reserved_quantity" = COALESCE("reserved_quantity", 0) + ${item.quantity},
              "updated_at" = NOW()
          WHERE "facility_id" = ${sourceFacilityId}
            AND "variant_id" = ${item.variantId}
            AND "stock_quantity" - COALESCE("reserved_quantity", 0) >= ${item.quantity}
        `;

        if (reservedInventoryRows !== 1) {
          throw new BadRequestException(`Medicine "${item.medicineName}" (${item.unitName}) does not have enough stock at the assigned facility.`);
        }

        if (!isBoxUnit(item.unitName)) {
          continue;
        }

        const boxes = await tx.medicine_boxes.findMany({
          where: {
            current_facility_id: sourceFacilityId,
            status: { in: AVAILABLE_BOX_STATUSES },
            medicine_batches: { medicine_id: item.medicineId },
          },
          select: { uid: true },
          orderBy: [
            { medicine_batches: { expiry_date: "asc" } },
            { created_at: "asc" },
          ],
          take: item.quantity,
        });

        if (boxes.length !== item.quantity) {
          // Physical packages can be assigned during transfer receipt or packing.
          continue;
        }

        const boxUids = boxes.map((box) => box.uid);
        const claimedBoxes = await tx.medicine_boxes.updateMany({
          where: {
            uid: { in: boxUids },
            current_facility_id: sourceFacilityId,
            status: { in: AVAILABLE_BOX_STATUSES },
          },
          data: { status: "RESERVED" },
        });

        if (claimedBoxes.count !== item.quantity) {
          throw new BadRequestException(`Physical boxes for "${item.medicineName}" were reserved by another order. Please try again.`);
        }

        reservedUidsByVariant.set(item.variantId, boxUids);
      }

      await tx.order_items.createMany({
        data: itemsToOrder.map((item) => ({
          order_id: order.id,
          medicine_id: item.medicineId,
          variant_id: item.variantId,
          medicine_name: item.medicineName,
          unit_name: item.unitName,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          total_price: item.totalPrice,
          assigned_uids: reservedUidsByVariant.get(item.variantId) ?? [],
          inventory_reserved: true,
          source_facility_id: itemSourceFacilityMap.get(item.variantId) ?? exportFacilityId,
        })),
      });

      await tx.$executeRaw`SELECT public.accept_fulfillment_terms(${order.id}, ${policy.revision}::text,
        ${policy.requirements_revision}::text, ${candidateDistanceKm}::numeric,
        ${[...new Set(itemSourceFacilityMap.values())].sort((a, b) => a - b)}::integer[], ${medicineIds}::integer[])`;

      for (const transfer of internalTransferPlan) {
        await tx.internal_transfers.create({
          data: {
            transfer_code: `ITR-${datePart}-${randomBytes(4).toString("hex").toUpperCase()}`,
            order_id: order.id,
            from_facility_id: transfer.fromFacilityId,
            to_facility_id: transfer.toFacilityId,
            status: "REQUESTED",
            items: transfer.items,
            distance_km: transfer.distanceKm,
            estimated_hours: transfer.distanceKm > 100 ? 48 : 24,
            notes: `Internal transfer from ${transfer.fromFacilityName} to consolidate order #${orderCode}`,
          },
        });
      }

      if (appliedVoucherId && voucherSnapshot) {
        await tx.$queryRaw`SELECT set_config('app.voucher_order_id', ${String(order.id)}, true)`;
        const updatedVoucherRows = await tx.$executeRaw`
          UPDATE "vouchers"
          SET "used_quantity" = COALESCE("used_quantity", 0) + 1
          WHERE "id" = ${appliedVoucherId}
            AND "status" = 'ACTIVE'
            AND ("start_date" IS NULL OR "start_date" <= NOW())
            AND ("end_date" IS NULL OR "end_date" >= NOW())
            AND "total_quantity" IS NOT NULL
            AND "total_quantity" > 0
            AND COALESCE("used_quantity", 0) < "total_quantity"
            AND "discount_type" = ${voucherSnapshot.discount_type}
            AND "discount_value" = ${Number(voucherSnapshot.discount_value)}
            AND COALESCE("min_order_value", 0) = ${Number(voucherSnapshot.min_order_value || 0)}
            AND "max_discount_amount" IS NOT DISTINCT FROM ${voucherSnapshot.max_discount_amount == null ? null : Number(voucherSnapshot.max_discount_amount)}::numeric
        `;

        if (updatedVoucherRows !== 1) {
          throw new BadRequestException("This voucher has reached its total usage limit or is no longer active. Please try again.");
        }
      }

      if (usedPoints > 0) {
        const updatedCustomerRows = await tx.$executeRaw`
          UPDATE "customers"
          SET "reward_points" = COALESCE("reward_points", 0) - ${usedPoints}
          WHERE "id" = ${customerId}
            AND COALESCE("reward_points", 0) >= ${usedPoints}
        `;

        if (updatedCustomerRows !== 1) {
          throw new BadRequestException("Your reward points balance is insufficient to apply to this order.");
        }

        await tx.loyalty_point_logs.create({
          data: {
            customer_id: customerId,
            order_id: order.id,
            transaction_type: "REDEEM",
            points: -usedPoints,
            description: `Redeemed ${usedPoints} points for order #${orderCode}`,
          },
        });
      }

      const orderedVariantIds = itemsToOrder.map((i) => i.variantId);
      await tx.cart_items.deleteMany({
        where: {
          customer_id: customerId,
          variant_id: { in: orderedVariantIds },
        },
      });

      return order;
    };

    const newOrder = await this.prisma.withOrder(
      'checkout',
      saveOrder,
      { id: customerId, role: 'CUSTOMER', type: 'customer' },
    );

    return this.getMyOrderById(customerId, newOrder.id);
  }

  async getMyOrders(customerId: number, query: OrderQueryDto) {
    return this.prisma.withOrder('read', async (tx) => {
      const page = Math.max(1, Number(query?.page) || 1);
      const limit = Math.max(1, Math.min(100, Number(query?.limit) || 10));
      const skip = (page - 1) * limit;

      const where: any = { customer_id: customerId };
      if (query.status && query.status !== "ALL") {
        const canonical = normalizeOrderStatus(query.status);
        const list = STATUS_DB_MAPPINGS[canonical] || [query.status];
        where.order_status = { in: list };
      }

      const [total, orders] = await Promise.all([
        tx.orders.count({ where }),
        tx.orders.findMany({
          where,
          skip,
          take: limit,
          orderBy: { created_at: query.sort === "oldest" ? "asc" : "desc" },
          include: ORDER_DETAILS_INCLUDE,
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

    }, { id: customerId, role: 'CUSTOMER', type: 'customer' });
  }

  async getMyOrderById(customerId: number, orderId: number) {
    return this.prisma.withOrder('read', async (tx) => {
      const order = await tx.orders.findUnique({
        where: { id: orderId },
        include: ORDER_DETAILS_INCLUDE,
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      if (order.customer_id !== customerId) {
        throw new ForbiddenException(
          "You do not have permission to view this order",
        );
      }

      let cancellationReason: string | null = null;
      if (order.order_status === 'CANCELLED') {
        try {
          const staffCancel = await tx.$queryRaw<{ reason: string }[]>`
            SELECT reason FROM public.staff_order_cancellations WHERE order_id = ${orderId} LIMIT 1
          `;
          if (staffCancel[0]?.reason) {
            cancellationReason = staffCancel[0].reason;
          }
        } catch {
          // ignore
        }
        if (!cancellationReason) {
          try {
            const custCancel = await tx.$queryRaw<{ reason_code: string; reason_details: string | null }[]>`
              SELECT reason_code, reason_details FROM public.order_cancellation_reasons WHERE order_id = ${orderId} LIMIT 1
            `;
            if (custCancel[0]) {
              const codeMap: Record<string, string> = {
                CHANGED_MIND: 'Changed my mind (Tôi đổi ý / Không còn nhu cầu)',
                ADDRESS_CHANGE: 'Change delivery address or phone (Muốn thay đổi địa chỉ / số điện thoại)',
                OTHER: 'Other reason',
              };
              cancellationReason = custCancel[0].reason_details?.trim() || codeMap[custCancel[0].reason_code] || custCancel[0].reason_code;
            }
          } catch {
            // ignore
          }
        }
        if (!cancellationReason) {
          try {
            const fallbackRows = await this.prisma.$queryRaw<{ reason: string }[]>`
              SELECT reason FROM public.staff_order_cancellations WHERE order_id = ${orderId} LIMIT 1
            `;
            if (fallbackRows[0]?.reason) cancellationReason = fallbackRows[0].reason;
          } catch {
            // ignore
          }
        }
      }

      return formatOrder(order, cancellationReason);

    }, { id: customerId, role: 'CUSTOMER', type: 'customer' });
  }

  async cancelMyOrder(customerId: number, orderId: number, dto: CancelOrderDto) {
    if (!dto || !['CHANGED_MIND', 'ADDRESS_CHANGE', 'OTHER'].includes(dto.reasonCode) ||
      (dto.reasonCode === 'OTHER' && !dto.reasonDetails?.trim())) {
      throw new BadRequestException('Choose a cancellation reason and provide details for other reasons.');
    }
    return this.prisma.withOrder('cancel', async (tx) => {
      await tx.$queryRaw`SELECT id FROM public.orders WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.orders.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new NotFoundException(`Order #${orderId} not found`);
      }

      if (order.customer_id !== customerId) {
        throw new ForbiddenException(
          "You do not have permission to cancel this order",
        );
      }

      const normStatus = normalizeOrderStatus(order.order_status);
      if (!["PENDING", "WAITING_INTERNAL_TRANSFER", "PROCESSING"].includes(normStatus)) {
        throw new BadRequestException(
          `Only unpacked orders can be cancelled. Current status is ${order.order_status}.`,
        );
      }

      if (await tx.shipments.findFirst({ where: { order_id: orderId } })) {
        throw new BadRequestException('Packing has already been committed. Contact customer support.');
      }

      if (order.prescription_id && order.prescription_review_status === 'APPROVED') {
        throw new BadRequestException('Cancellation of an approved prescription requires pharmacist confirmation.');
      }

      await tx.$executeRaw`INSERT INTO public.order_cancellation_reasons (order_id, customer_id, reason_code, reason_details)
        VALUES (${orderId}, ${customerId}, ${dto.reasonCode}, ${dto.reasonDetails?.trim() || null})`;
      const cancelled = await tx.orders.updateMany({
        where: { id: orderId, order_status: order.order_status },
        data: { order_status: "CANCELLED" },
      });
      if (cancelled.count !== 1) throw new BadRequestException('Order status changed. Reload and try again.');

      await releaseOrderReservations(
        tx,
        orderId,
        order.export_facility_id,
      );

      // Refund used reward points
      if (order.used_points && order.used_points > 0) {
        await tx.customers.update({
          where: { id: customerId },
          data: { reward_points: { increment: order.used_points } },
        });
        await tx.loyalty_point_logs.create({
          data: {
            customer_id: customerId,
            order_id: orderId,
            transaction_type: "REDEEM_REVERSAL",
            points: order.used_points,
          },
        });
      }


      return formatOrder(await tx.orders.findUnique({ where: { id: orderId }, include: ORDER_DETAILS_INCLUDE }));

    }, { id: customerId, role: 'CUSTOMER', type: 'customer' });
  }
}
