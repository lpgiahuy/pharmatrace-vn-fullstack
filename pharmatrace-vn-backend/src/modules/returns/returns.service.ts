import { Injectable } from '@nestjs/common';
import { Prisma, return_request_lines as Line, return_requests as Request } from '@prisma/client';
import { randomBytes } from 'crypto';
import sharp from 'sharp';
import { AuthActor, authActor } from '../../common/auth-identity';
import { CurrentUserPayload } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import {
  ApproveReturnDto, ChangeReturnMethodDto, CreateReturnDto, CUSTOMER_CHOICE_REASONS, InspectReturnDto, PHARMACY_FAULT_REASONS,
  ReceiveReturnDto, ReturnCarrierDto, ReturnQueryDto, ReturnRefundDto, ReturnRefundPaymentDto, StaffCreateReturnDto,
} from './dto/return.dto';
import { RETURN_WINDOW_DAYS, rmaDatabase, rmaError } from './return-errors';

type Tx = Prisma.TransactionClient;
type Upload = { buffer: Buffer; mimetype: string; size: number };

const MAX_ATTACHMENTS = 5;
const UNRESOLVED = ['REQUESTED', 'NEEDS_INFO', 'APPROVED'];
const INTERNAL_NOTE_ACTIONS = ['INSPECTED', 'EXCHANGE_ORDER_CREATED', 'REFUND_APPROVED', 'REFUNDED'];
const RETURNABLE_BOX_STATUSES = ['PACKAGED', 'SOLD', 'SHIPPED', 'RESERVED', 'IN_TRANSIT'];

type VariantPrice = { price: Prisma.Decimal; original_price: Prisma.Decimal | null; discount_percent: number | null; sale_start_date: Date | null; sale_end_date: Date | null };

function replacementPrice(variant: VariantPrice, now = new Date()) {
  const onSale = ((variant.discount_percent ?? 0) > 0 || (variant.original_price !== null && variant.price.lt(variant.original_price)))
    && variant.sale_start_date !== null && variant.sale_end_date !== null && variant.sale_start_date <= now && now <= variant.sale_end_date;
  return onSale ? variant.price : variant.original_price ?? variant.price;
}

@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService, private readonly cloudinary: CloudinaryService) {}


  eligibility(where: Prisma.ordersWhereInput, user: CurrentUserPayload) {
    return this.prisma.withOrder('read', async tx => {
      const { order: _order, ...summary } = await this.loadEligibility(tx, where);
      return summary;
    }, authActor(user));
  }

  create(dto: CreateReturnDto | StaffCreateReturnDto, user: CurrentUserPayload) {
    const actor = authActor(user);
    const channel = 'channel' in dto ? dto.channel : 'ONLINE';
    if (new Set(dto.lines.map(line => line.orderItemId)).size !== dto.lines.length) throw rmaError('RMA_INVALID_LINES');

    return rmaDatabase(this.prisma.withOrder(actor.type === 'customer' ? 'read' : 'status', async tx => {
      const eligibility = await this.loadEligibility(tx, { id: dto.orderId });
      if (eligibility.blocker) throw rmaError(eligibility.blocker);
      const order = eligibility.order;

      const lines = dto.lines.map(line => {
        const item = eligibility.items.find(entry => entry.orderItemId === line.orderItemId);
        if (!item) throw rmaError('RMA_INVALID_LINES');
        if (line.quantity > item.returnableQuantity) throw rmaError('RMA_QUANTITY_EXCEEDED', { name: item.medicineName, max: item.returnableQuantity });
        if (!item.allowedReasons.includes(line.reasonCode)) throw rmaError('RMA_RESTRICTED_ITEM', { name: item.medicineName });
        const reasonNote = line.reasonCode === 'OTHER' ? line.reasonNote?.trim() : undefined;
        if (line.reasonCode === 'OTHER' && !reasonNote) throw rmaError('RMA_REASON_NOTE_REQUIRED', { name: item.medicineName });
        if (line.exchangeVariantId && (dto.resolution !== 'EXCHANGE' || !item.exchangeOptions.some(option => option.variantId === line.exchangeVariantId))) {
          throw rmaError('RMA_EXCHANGE_VARIANT_INVALID');
        }
        return { order_item_id: item.orderItemId, variant_id: item.variantId, quantity: line.quantity, reason_code: line.reasonCode, reason_note: reasonNote ?? null,
          restricted: item.restricted, exchange_variant_id: line.exchangeVariantId ?? null };
      });
      const pickupAddress = dto.pickupAddress?.trim() || order.shipping_address;
      if (dto.returnMethod === 'CARRIER_PICKUP' && !pickupAddress) throw rmaError('RMA_PICKUP_ADDRESS_REQUIRED');

      await this.audit(tx, 'CREATED', channel === 'ONLINE' ? undefined : `Recorded by staff ${channel === 'COUNTER' ? 'at the counter' : 'by phone'}`);
      const date = new Date().toISOString().slice(2, 10).replace(/-/g, '');
      const request = await tx.return_requests.create({
        data: {
          code: `RMA-${date}-${randomBytes(3).toString('hex').toUpperCase()}`,
          order_id: order.id, customer_id: order.customer_id, facility_id: order.export_facility_id!, channel,
          resolution: dto.resolution, return_method: dto.returnMethod, description: dto.description?.trim() || null,
          pickup_address: dto.returnMethod === 'CARRIER_PICKUP' ? pickupAddress : null,
        },
      });
      await tx.return_request_lines.createMany({ data: lines.map(line => ({ ...line, request_id: request.id })) });
      return this.loadDetail(tx, request.id, actor);
    }, actor));
  }

  private async loadEligibility(tx: Tx, where: Prisma.ordersWhereInput) {
    const order = await tx.orders.findFirst({ where, include: { order_items: { include: { medicines: true } }, shipments: true } });
    if (!order || !order.export_facility_id) throw rmaError('RMA_ORDER_NOT_FOUND');
    const deliveredAt = order.shipments?.shipping_status === 'DELIVERED' && order.order_status === 'COMPLETED' ? order.shipments.actual_delivery_at : null;
    const deadline = deliveredAt ? new Date(deliveredAt.getTime() + RETURN_WINDOW_DAYS * 86_400_000) : null;
    const openRequest = await tx.return_requests.findFirst({ where: { order_id: order.id, status: { in: [...UNRESOLVED, 'RECEIVED', 'INSPECTED', 'REFUND_APPROVED'] } }, select: { id: true, code: true } });
    const blocker = !deadline ? 'RMA_ORDER_NOT_DELIVERED' as const
      : deadline < new Date() ? 'RMA_RETURN_WINDOW_EXPIRED' as const
        : openRequest ? 'RMA_OPEN_REQUEST_EXISTS' as const : undefined;

    const previousRequests = await tx.return_requests.findMany({ where: { order_id: order.id, status: { notIn: ['REJECTED', 'CANCELLED'] } }, select: { id: true } });
    const previousLines = await tx.return_request_lines.findMany({ where: { request_id: { in: previousRequests.map(request => request.id) } } });
    const medicineIds = order.order_items.map(item => item.medicine_id).filter((value): value is number => value !== null);
    const restrictedIds = (await tx.$queryRaw<{ id: number }[]>`SELECT public.return_restricted_medicines(${medicineIds}::integer[]) AS id`).map(row => row.id);
    const [{ ratio }] = await tx.$queryRaw<{ ratio: Prisma.Decimal | null }[]>`SELECT public.return_paid_ratio(${order.id}) AS ratio`;
    const paidRatio = new Prisma.Decimal(ratio ?? 1);
    const variants = await tx.packaging_variants.findMany({
      where: { medicine_id: { in: medicineIds } },
      select: { id: true, medicine_id: true, unit_name: true, price: true, original_price: true, discount_percent: true, sale_start_date: true, sale_end_date: true },
      orderBy: { price: 'asc' },
    });

    const items = order.order_items.map(item => {
      const alreadyReturned = previousLines.filter(line => line.order_item_id === item.id)
        .reduce((sum, line) => sum + (line.approved_quantity ?? line.quantity), 0);
      const restricted = item.medicine_id !== null && restrictedIds.includes(item.medicine_id);
      return {
        orderItemId: item.id, variantId: item.variant_id ?? 0, medicineName: item.medicine_name ?? item.medicines?.medicine_name ?? '',
        unitName: item.unit_name, unitPrice: item.unit_price, purchasedQuantity: item.quantity,
        // What one unit is worth back after the order's voucher/points are spread over its lines.
        paidUnitPrice: new Prisma.Decimal(item.unit_price).mul(paidRatio).toDecimalPlaces(0),
        returnableQuantity: item.variant_id ? Math.max(item.quantity - alreadyReturned, 0) : 0, restricted, evidenceRequired: restricted,
        allowedReasons: restricted ? PHARMACY_FAULT_REASONS : [...PHARMACY_FAULT_REASONS, ...CUSTOMER_CHOICE_REASONS],
        // Same variant keeps the price paid; other pack sizes use today's price, matching public.return_replacement_lines.
        exchangeOptions: variants.filter(variant => variant.medicine_id === item.medicine_id).map(variant => ({
          variantId: variant.id, unitName: variant.unit_name,
          unitPrice: variant.id === item.variant_id ? new Prisma.Decimal(item.unit_price).mul(paidRatio).toDecimalPlaces(0) : replacementPrice(variant),
        })),
      };
    });
    return { order, orderId: order.id, orderCode: order.order_code, deliveredAt, deadline, blocker, openRequest, items };
  }


  list(query: ReturnQueryDto, user: CurrentUserPayload) {
    return this.prisma.withOrder('read', async tx => {
      const q = query.q?.trim();
      const orderIds = q ? (await tx.orders.findMany({ where: { order_code: { contains: q, mode: 'insensitive' } }, select: { id: true }, take: 100 })).map(order => order.id) : [];
      const where: Prisma.return_requestsWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(q ? { OR: [{ code: { contains: q, mode: 'insensitive' } }, { order_id: { in: orderIds } }] } : {}),
      };
      const [total, data] = await Promise.all([
        tx.return_requests.count({ where }),
        tx.return_requests.findMany({ where, orderBy: { created_at: 'desc' }, skip: (query.page - 1) * query.limit, take: query.limit }),
      ]);
      return { data, pagination: { page: query.page, limit: query.limit, total } };
    }, authActor(user));
  }

  detail(id: number, user: CurrentUserPayload) {
    const actor = authActor(user);
    return this.prisma.withOrder('read', tx => this.loadDetail(tx, id, actor), actor);
  }

  private async loadDetail(tx: Tx, id: number, actor: AuthActor) {
    const request = await this.findRequest(tx, id);
    const [lines, attachments, events, refund, order] = await Promise.all([
      tx.return_request_lines.findMany({ where: { request_id: id } }),
      tx.return_attachments.findMany({ where: { request_id: id }, select: { id: true, uploaded_by_type: true, created_at: true }, orderBy: { id: 'asc' } }),
      tx.return_request_events.findMany({ where: { request_id: id }, orderBy: { id: 'asc' } }),
      tx.return_request_refunds.findFirst({ where: { request_id: id } }),
      tx.orders.findFirst({ where: { id: request.order_id }, select: { order_code: true, order_items: { select: { id: true, medicine_name: true, unit_name: true, unit_price: true, assigned_uids: true } } } }),
    ]);
    const facility = await tx.facilities.findFirst({ where: { id: request.facility_id }, select: { id: true, facility_name: true, address: true, phone_number: true } });
    const items = new Map(order?.order_items.map(item => [item.id, item]));
    const forCustomer = actor.type === 'customer';
    return {
      ...request,
      order_code: order?.order_code,
      handover: { method: request.return_method, code: request.code, facility, pickupAddress: request.pickup_address,
        courierName: request.courier_name, trackingNumber: request.tracking_number },
      lines: lines.map(line => {
        const item = items.get(line.order_item_id);
        return {
          ...line, medicine_name: item?.medicine_name, unit_name: item?.unit_name, unit_price: item?.unit_price,
          // Whether boxes of this line carry UIDs; receipt then has to scan them.
          tracked: (item?.assigned_uids?.length ?? 0) > 0,
        };
      }),
      attachments,
      events: forCustomer ? events.map(event => ({
        ...event,
        actor_id: undefined,
        actor_name: event.actor_type === 'customer' ? event.actor_name : undefined,
        note: INTERNAL_NOTE_ACTIONS.includes(event.action) ? null : event.note,
      })) : events,
      refund: forCustomer && refund ? { refund_amount: refund.refund_amount, payment_method: refund.payment_method, executed_at: refund.executed_at } : refund,
    };
  }


  async addAttachment(id: number, file: Upload | undefined, user: CurrentUserPayload) {
    const actor = authActor(user);
    const image = await this.normalizeImage(file);
    const uploaded = await this.cloudinary.uploadPrivateImage(image, 'pharmatrace/returns');
    try {
      return await this.prisma.withOrder('read', async tx => {
        const request = await this.findRequest(tx, id, true);
        const editable = actor.type === 'customer' ? ['REQUESTED', 'NEEDS_INFO'] : [...UNRESOLVED, 'RECEIVED'];
        if (!editable.includes(request.status)) throw rmaError('RMA_INVALID_TRANSITION', { status: request.status });
        if (await tx.return_attachments.count({ where: { request_id: id } }) >= MAX_ATTACHMENTS) throw rmaError('RMA_ATTACHMENT_LIMIT');
        return tx.return_attachments.create({
          data: { request_id: id, image_reference: uploaded.publicId, uploaded_by_type: actor.type, uploaded_by_id: actor.id },
          select: { id: true, uploaded_by_type: true, created_at: true },
        });
      }, actor);
    } catch (error) {
      await this.cloudinary.deletePrivateImage(uploaded.publicId);
      throw error;
    }
  }

  async attachment(id: number, attachmentId: number, user: CurrentUserPayload) {
    const attachment = await this.prisma.withOrder('read',
      tx => tx.return_attachments.findFirst({ where: { id: attachmentId, request_id: id } }), authActor(user));
    if (!attachment) throw rmaError('RMA_ATTACHMENT_NOT_FOUND');
    return this.cloudinary.downloadPrivateImage(attachment.image_reference);
  }

  private async normalizeImage(file?: Upload) {
    if (!file?.buffer?.length || file.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      throw rmaError('RMA_ATTACHMENT_INVALID');
    }
    try {
      return await sharp(file.buffer, { limitInputPixels: 40_000_000 }).rotate()
        .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    } catch {
      throw rmaError('RMA_ATTACHMENT_INVALID');
    }
  }


  cancel(id: number, user: CurrentUserPayload) {
    return this.act(id, user, 'read', async (tx, request) => {
      if (request.replacement_order_id) throw rmaError('RMA_INVALID_TRANSITION', { status: request.status });
      await this.transition(tx, request, UNRESOLVED, 'CANCELLED', {}, 'Cancelled by customer');
    });
  }

  provideInfo(id: number, note: string, user: CurrentUserPayload) {
    return this.act(id, user, 'read', async (tx, request) => {
      await this.transition(tx, request, ['NEEDS_INFO'], 'REQUESTED', {}, note.trim(), 'INFO_PROVIDED');
    });
  }

  changeMethod(id: number, dto: ChangeReturnMethodDto, user: CurrentUserPayload) {
    return this.act(id, user, 'read', async (tx, request) => {
      if (request.tracking_number) throw rmaError('RMA_INVALID_TRANSITION', { status: request.status });
      const order = await tx.orders.findFirst({ where: { id: request.order_id }, select: { shipping_address: true } });
      const pickupAddress = dto.pickupAddress?.trim() || request.pickup_address || order?.shipping_address;
      if (dto.returnMethod === 'CARRIER_PICKUP' && !pickupAddress) throw rmaError('RMA_PICKUP_ADDRESS_REQUIRED');
      await this.transition(tx, request, UNRESOLVED, request.status, {
        return_method: dto.returnMethod, pickup_address: dto.returnMethod === 'CARRIER_PICKUP' ? pickupAddress : null,
      }, `Return method changed to ${dto.returnMethod === 'CARRIER_PICKUP' ? 'courier pickup' : 'bringing the goods to the pharmacy'}`, 'RETURN_METHOD_CHANGED');
    });
  }


  approve(id: number, dto: ApproveReturnDto, user: CurrentUserPayload) {
    return this.act(id, user, 'status', async (tx, request) => {
      const lines = await this.matchLines(tx, id, dto.lines);
      const approved = lines.map(({ line, input }) => ({ line, quantity: input?.approvedQuantity ?? 0 }));
      for (const { line, quantity } of approved) {
        if (quantity > line.quantity) throw rmaError('RMA_QUANTITY_EXCEEDED', { name: await this.itemName(tx, line), max: line.quantity });
      }
      const kept = approved.filter(entry => entry.quantity > 0);
      if (!kept.length) throw rmaError('RMA_NOTHING_APPROVED');
      if (kept.some(entry => entry.line.restricted) && !(await tx.return_attachments.count({ where: { request_id: id } }))) {
        throw rmaError('RMA_EVIDENCE_REQUIRED');
      }
      const fee = dto.customerFee ?? 0;
      const customerChoiceOnly = kept.every(entry => CUSTOMER_CHOICE_REASONS.includes(entry.line.reason_code));
      if (fee > 0 && !(customerChoiceOnly && request.return_method === 'CARRIER_PICKUP')) throw rmaError('RMA_FEE_NOT_ALLOWED');

      for (const { line, quantity } of approved) {
        await tx.return_request_lines.update({ where: { request_id_order_item_id: { request_id: id, order_item_id: line.order_item_id } }, data: { approved_quantity: quantity } });
      }
      await this.transition(tx, request, ['REQUESTED'], 'APPROVED', { customer_fee: fee, staff_note: dto.note?.trim() || null }, dto.note?.trim());
    });
  }

  reject(id: number, note: string, user: CurrentUserPayload) {
    return this.act(id, user, 'status', async (tx, request) => {
      await this.transition(tx, request, ['REQUESTED', 'NEEDS_INFO'], 'REJECTED', { staff_note: note.trim() }, note.trim());
    });
  }

  /** The parcel that arrived is not what was approved (another product, an empty box...), so the request ends here. */
  rejectReceipt(id: number, note: string, user: CurrentUserPayload) {
    return this.act(id, user, 'status', async (tx, request) => {
      if (request.status !== 'APPROVED' || request.replacement_order_id) throw rmaError('RMA_RECEIPT_REJECT_NOT_ALLOWED');
      await this.transition(tx, request, ['APPROVED'], 'REJECTED', { staff_note: note.trim() }, note.trim(), 'RECEIPT_REJECTED');
    });
  }

  requestInfo(id: number, note: string, user: CurrentUserPayload) {
    return this.act(id, user, 'status', async (tx, request) => {
      await this.transition(tx, request, ['REQUESTED'], 'NEEDS_INFO', { staff_note: note.trim() }, note.trim());
    });
  }

  setCarrier(id: number, dto: ReturnCarrierDto, user: CurrentUserPayload) {
    return this.act(id, user, 'status', async (tx, request) => {
      if (request.return_method !== 'CARRIER_PICKUP') throw rmaError('RMA_NOT_PICKUP');
      await this.transition(tx, request, ['APPROVED'], 'APPROVED', {
        courier_name: dto.courierName.trim().toUpperCase(), tracking_number: dto.trackingNumber.trim().toUpperCase(),
      }, `${dto.courierName.trim().toUpperCase()} ${dto.trackingNumber.trim().toUpperCase()}`, 'CARRIER_BOOKED');
    });
  }


  receive(id: number, dto: ReceiveReturnDto, user: CurrentUserPayload) {
    return this.act(id, user, 'receive', async (tx, request) => {
      if (request.status !== 'APPROVED') throw rmaError('RMA_INVALID_TRANSITION', { status: request.status });
      const lines = await this.matchLines(tx, id, dto.lines);
      if (!lines.some(({ input }) => (input?.quantity ?? 0) > 0)) throw rmaError('RMA_NOTHING_RECEIVED');

      for (const { line, input } of lines) {
        const quantity = input?.quantity ?? 0;
        const boxUids = input?.boxUids ?? [];
        const name = await this.itemName(tx, line);
        if (quantity > (line.approved_quantity ?? 0)) throw rmaError('RMA_QUANTITY_EXCEEDED', { name, max: line.approved_quantity ?? 0 });
        const item = await tx.order_items.findFirst({ where: { id: line.order_item_id }, select: { assigned_uids: true } });
        const assigned = item?.assigned_uids ?? [];
        // Say exactly what is wrong, so staff know whether to rescan, drop a code, or refuse the parcel.
        if (!assigned.length && boxUids.length) throw rmaError('RMA_BOXES_NOT_TRACKED', { name });
        if (assigned.length) {
          const foreign = boxUids.filter(uid => !assigned.includes(uid));
          if (foreign.length) throw rmaError('RMA_BOX_NOT_IN_ORDER', { name, codes: foreign.join(', ') });
          if (new Set(boxUids).size !== boxUids.length) throw rmaError('RMA_BOX_DUPLICATE', { name });
          if (boxUids.length !== quantity) throw rmaError('RMA_BOX_COUNT', { name, scanned: boxUids.length, quantity });
        }
        if (boxUids.length) {
          const moved = await tx.medicine_boxes.updateMany({
            where: { uid: { in: boxUids }, status: { in: RETURNABLE_BOX_STATUSES } },
            data: { current_facility_id: request.facility_id, status: 'QUARANTINED' },
          });
          if (moved.count !== boxUids.length) throw rmaError('RMA_BOX_MISMATCH', { name });
        }
        await tx.return_request_lines.update({
          where: { request_id_order_item_id: { request_id: id, order_item_id: line.order_item_id } },
          data: { received_quantity: quantity, box_uids: boxUids },
        });
        if (quantity > 0) await tx.$queryRaw`SELECT public.record_quarantine_movement('RMA', ${id}, ${line.variant_id}, 'IN', ${quantity})`;
      }
      await this.transition(tx, request, ['APPROVED'], 'RECEIVED', {}, 'Goods received and moved to quarantine for inspection');
    });
  }

  inspect(id: number, dto: InspectReturnDto, user: CurrentUserPayload) {
    return this.act(id, user, 'status', async (tx, request) => {
      if (request.status !== 'RECEIVED') throw rmaError('RMA_INVALID_TRANSITION', { status: request.status });
      const lines = (await this.matchLines(tx, id, dto.lines)).filter(({ line }) => (line.received_quantity ?? 0) > 0);

      for (const { line, input } of lines) {
        const name = await this.itemName(tx, line);
        const pass = input?.passQuantity ?? 0;
        const fail = input?.failQuantity ?? 0;
        const mismatch = input?.mismatchQuantity ?? 0;
        const restock = input?.restockBoxUids ?? [];
        const scrap = input?.scrapBoxUids ?? [];
        if (pass + fail + mismatch !== line.received_quantity) throw rmaError('RMA_INSPECTION_MISMATCH', { name, received: line.received_quantity ?? 0 });
        // Tracked boxes were checked against the order at receipt, so a "different product" verdict cannot apply.
        if (mismatch > 0 && line.box_uids.length) throw rmaError('RMA_MISMATCH_ON_TRACKED_BOXES', { name });
        if (line.restricted && pass > 0) throw rmaError('RMA_RESTRICTED_RESTOCK', { name });
        const boxes = [...restock, ...scrap];
        if (line.box_uids.length ? restock.length !== pass || scrap.length !== fail || new Set(boxes).size !== boxes.length || boxes.some(uid => !line.box_uids.includes(uid)) : boxes.length > 0) {
          throw rmaError('RMA_BOX_MISMATCH', { name });
        }
        if (pass > 0) await this.restock(tx, request, line, pass, restock, name, user.id);
        // Wrong products leave quarantine stock the same way as failed goods; the line records why.
        if (fail + mismatch > 0) {
          await tx.$queryRaw`SELECT public.record_quarantine_movement('RMA', ${id}, ${line.variant_id}, 'FAILED_QA', ${fail + mismatch})`;
          if (scrap.length) await this.moveQuarantinedBoxes(tx, request.facility_id, scrap, 'DAMAGED', name);
        }
        await tx.return_request_lines.update({
          where: { request_id_order_item_id: { request_id: id, order_item_id: line.order_item_id } },
          data: { pass_quantity: pass, fail_quantity: fail, mismatch_quantity: mismatch },
        });
      }
      await this.transition(tx, request, ['RECEIVED'], 'INSPECTED', {}, dto.notes?.trim());
    });
  }

  private async restock(tx: Tx, request: Request, line: Line, quantity: number, boxUids: string[], name: string, performedBy: number) {
    await tx.$queryRaw`SELECT public.record_quarantine_movement('RMA', ${request.id}, ${line.variant_id}, 'RESTOCK', ${quantity})`;
    const item = await tx.order_items.findFirst({ where: { id: line.order_item_id }, select: { medicine_id: true } });
    const inventory = await tx.inventories.upsert({
      where: { facility_id_variant_id: { facility_id: request.facility_id, variant_id: line.variant_id } },
      update: { stock_quantity: { increment: quantity }, updated_at: new Date() },
      create: { facility_id: request.facility_id, variant_id: line.variant_id, stock_quantity: quantity, reserved_quantity: 0, updated_at: new Date() },
    });
    if (boxUids.length) await this.moveQuarantinedBoxes(tx, request.facility_id, boxUids, 'IN_STOCK', name);
    await tx.inventory_logs.create({
      data: {
        facility_id: request.facility_id, medicine_id: item?.medicine_id, variant_id: line.variant_id, stock_bucket: 'ON_HAND',
        performed_by_id: performedBy, transaction_type: 'RETURN_RESTOCK', quantity_changed: quantity,
        previous_quantity: inventory.stock_quantity - quantity, new_quantity: inventory.stock_quantity,
        reference_code: request.code, note: `Restocked ${quantity} unit(s) that passed inspection from ${request.code}`,
      },
    });
  }

  private async moveQuarantinedBoxes(tx: Tx, facilityId: number, uids: string[], status: string, name: string) {
    const moved = await tx.medicine_boxes.updateMany({ where: { uid: { in: uids }, current_facility_id: facilityId, status: 'QUARANTINED' }, data: { status } });
    if (moved.count !== uids.length) throw rmaError('RMA_BOX_MISMATCH', { name });
  }


  createExchangeOrder(id: number, user: CurrentUserPayload) {
    return this.callFunction(user, Prisma.sql`SELECT public.create_return_replacement_order(${id}) AS result`);
  }

  approveRefund(id: number, dto: ReturnRefundDto, user: CurrentUserPayload) {
    return this.callFunction(user, Prisma.sql`SELECT public.approve_return_request_refund(${id}, ${dto.paymentMethod}::text, ${dto.reason.trim()}::text) AS result`);
  }

  recordRefundPayment(id: number, dto: ReturnRefundPaymentDto, user: CurrentUserPayload) {
    return this.callFunction(user, Prisma.sql`SELECT public.record_return_request_refund(${id}, ${dto.paymentReference.trim()}::text) AS result`);
  }

  close(id: number, user: CurrentUserPayload) {
    return this.act(id, user, 'status', async (tx, request) => {
      if (request.status !== 'INSPECTED') throw rmaError('RMA_CLOSE_NOT_ALLOWED');
      if (request.resolution === 'EXCHANGE') {
        if (!request.replacement_order_id) throw rmaError('RMA_CLOSE_NOT_ALLOWED');
        await this.transition(tx, request, ['INSPECTED'], 'CLOSED', {}, 'Exchange completed');
        return;
      }
      // A refund request whose goods all failed inspection for a customer-choice reason credits nothing.
      const [{ value }] = await tx.$queryRaw<{ value: Prisma.Decimal }[]>`SELECT public.return_request_goods_value(${id}) AS value`;
      if (new Prisma.Decimal(value).gt(0)) throw rmaError('RMA_CLOSE_NOT_ALLOWED');
      await this.transition(tx, request, ['INSPECTED'], 'CLOSED', {}, 'Closed without refund: no goods passed inspection');
    });
  }


  private act(id: number, user: CurrentUserPayload, operation: 'read' | 'status' | 'receive', run: (tx: Tx, request: Request) => Promise<void>) {
    const actor = authActor(user);
    return rmaDatabase(this.prisma.withOrder(operation, async tx => {
      await run(tx, await this.findRequest(tx, id, true));
      return this.loadDetail(tx, id, actor);
    }, actor));
  }

  private callFunction(user: CurrentUserPayload, query: Prisma.Sql) {
    return rmaDatabase(this.prisma.withOrder('status', async tx => (await tx.$queryRaw<{ result: Prisma.JsonObject }[]>(query))[0].result, authActor(user)));
  }

  private async findRequest(tx: Tx, id: number, lock = false) {
    if (lock) await tx.$queryRaw`SELECT id FROM public.return_requests WHERE id = ${id} FOR UPDATE`;
    const request = await tx.return_requests.findFirst({ where: { id } });
    if (!request) throw rmaError('RMA_NOT_FOUND');
    return request;
  }

  private async matchLines<T extends { orderItemId: number }>(tx: Tx, id: number, inputs: T[]) {
    const lines = await tx.return_request_lines.findMany({ where: { request_id: id } });
    if (new Set(inputs.map(input => input.orderItemId)).size !== inputs.length
      || inputs.some(input => !lines.some(line => line.order_item_id === input.orderItemId))) {
      throw rmaError('RMA_INVALID_LINES');
    }
    return lines.map(line => ({ line, input: inputs.find(input => input.orderItemId === line.order_item_id) }));
  }

  private async itemName(tx: Tx, line: Line) {
    return (await tx.order_items.findFirst({ where: { id: line.order_item_id }, select: { medicine_name: true } }))?.medicine_name ?? `#${line.order_item_id}`;
  }

  private async transition(tx: Tx, request: Request, from: string[], to: string, data: Prisma.return_requestsUpdateManyMutationInput, note?: string, action = to) {
    await this.audit(tx, action, note);
    const changed = await tx.return_requests.updateMany({ where: { id: request.id, status: { in: from } }, data: { ...data, status: to, updated_at: new Date() } });
    if (changed.count !== 1) throw rmaError('RMA_INVALID_TRANSITION', { status: request.status });
  }

  private async audit(tx: Tx, action: string, note?: string) {
    await tx.$queryRaw`SELECT set_config('app.rma_action', ${action}, true), set_config('app.rma_note', ${note ?? ''}, true)`;
  }
}
