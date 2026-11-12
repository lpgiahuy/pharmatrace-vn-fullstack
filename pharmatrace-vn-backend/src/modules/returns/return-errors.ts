import { HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';

export const RETURN_WINDOW_DAYS = 7;

const STATUS_LABELS: Record<string, string> = {
  REQUESTED: 'Awaiting review', NEEDS_INFO: 'Waiting for more information', APPROVED: 'Approved, waiting for goods', REJECTED: 'Rejected',
  CANCELLED: 'Cancelled', RECEIVED: 'Goods received, awaiting inspection', INSPECTED: 'Inspected', REFUND_APPROVED: 'Refund approved',
  REFUNDED: 'Refunded', CLOSED: 'Completed',
};

type Params = Record<string, string | number>;
const { NOT_FOUND, CONFLICT, UNPROCESSABLE_ENTITY: INVALID, FORBIDDEN } = HttpStatus;

const CATALOG: Record<string, [HttpStatus, (p: Params) => string]> = {
  RMA_NOT_FOUND: [NOT_FOUND, () => 'We could not find this return request.'],
  RMA_ORDER_NOT_FOUND: [NOT_FOUND, () => 'We could not find this order.'],
  RMA_ATTACHMENT_NOT_FOUND: [NOT_FOUND, () => 'We could not find this photo.'],
  RMA_FORBIDDEN: [FORBIDDEN, () => 'You do not have permission to perform this action on the return request.'],
  RMA_ORDER_NOT_DELIVERED: [INVALID, () => 'This order has not been delivered yet, so it cannot be returned.'],
  RMA_RETURN_WINDOW_EXPIRED: [INVALID, () => `This order is past the ${RETURN_WINDOW_DAYS}-day return window counted from delivery.`],
  RMA_OPEN_REQUEST_EXISTS: [CONFLICT, () => 'This order already has a return request in progress. Please follow that request.'],
  RMA_INVALID_LINES: [INVALID, () => 'Each product can be selected only once and must belong to this order or request.'],
  RMA_QUANTITY_EXCEEDED: [INVALID, p => `You can return at most ${p.max} of "${p.name}".`],
  RMA_RESTRICTED_ITEM: [INVALID, p => `"${p.name}" is a prescription or special-storage medicine and can only be returned if it was wrong or defective.`],
  RMA_REASON_NOTE_REQUIRED: [INVALID, p => `Please describe the reason for returning "${p.name}".`],
  RMA_EXCHANGE_VARIANT_INVALID: [INVALID, () => 'You can only exchange for another pack size of the same medicine, and only when exchange is selected.'],
  RMA_PICKUP_ADDRESS_REQUIRED: [INVALID, () => 'Please enter an address for the courier to collect the goods.'],
  RMA_INVALID_TRANSITION: [CONFLICT, p => `This request is "${STATUS_LABELS[p.status] ?? p.status}", so this action is not available. Please reload the page.`],
  RMA_EVIDENCE_REQUIRED: [INVALID, () => 'This request includes prescription or special-storage goods and needs photo evidence. Ask the customer to add photos before approving.'],
  RMA_FEE_NOT_ALLOWED: [INVALID, () => 'A fee can only be charged when the customer changed their mind and returns goods by courier. Pharmacy errors are free of charge.'],
  RMA_NOTHING_APPROVED: [INVALID, () => 'Approve a return quantity for at least one product.'],
  RMA_NOT_PICKUP: [INVALID, () => 'The customer chose to bring the goods to the pharmacy, so no courier is needed.'],
  RMA_NOTHING_RECEIVED: [INVALID, () => 'Enter the received quantity for at least one product.'],
  RMA_BOX_MISMATCH: [INVALID, p => `The scanned box codes for "${p.name}" do not match the order or the quantity. Please scan again.`],
  RMA_BOXES_NOT_TRACKED: [INVALID, p => `"${p.name}" was sold without tracked boxes, so no box codes are needed. Remove the codes and enter only the quantity.`],
  RMA_BOX_NOT_IN_ORDER: [INVALID, p => `These boxes were not sold in this order for "${p.name}": ${p.codes}. Check you are receiving the right request, or refuse the parcel if the goods do not match.`],
  RMA_BOX_DUPLICATE: [INVALID, p => `The same box was scanned twice for "${p.name}". Remove the duplicate.`],
  RMA_BOX_COUNT: [INVALID, p => `You scanned ${p.scanned} box${p.scanned === 1 ? '' : 'es'} for "${p.name}" but entered ${p.quantity} received. Scan one box per received unit.`],
  RMA_INSPECTION_MISMATCH: [INVALID, p => `Passed, failed and wrong-product quantities for "${p.name}" must add up to the received quantity (${p.received}).`],
  RMA_MISMATCH_ON_TRACKED_BOXES: [INVALID, p => `The boxes of "${p.name}" were matched to this order when they were scanned in, so they cannot be marked as a different product. Mark them as failed instead.`],
  RMA_RECEIPT_REJECT_NOT_ALLOWED: [INVALID, () => 'Goods can only be refused while the request is approved and waiting for them, and before a replacement order has been created.'],
  RMA_RESTRICTED_RESTOCK: [INVALID, p => `"${p.name}" is a prescription or special-storage medicine and cannot go back into stock. Mark it as failed.`],
  RMA_EXCHANGE_NOT_ALLOWED: [INVALID, () => 'The replacement order cannot be created yet. Inspect the returned goods first. It can only ship earlier when every item was delivered wrong, the boxes are tracked, and the customer sent photos. Each request allows one replacement order.'],
  RMA_EXCHANGE_OUT_OF_STOCK: [CONFLICT, () => 'The replacement product is out of stock at this pharmacy. Choose another product or refund instead.'],
  RMA_REFUND_NOT_ALLOWED: [INVALID, () => 'A refund is only possible after the returned goods are inspected (for exchanges, after the replacement order is created).'],
  RMA_ORDER_NOT_PAID: [INVALID, () => 'The original order has no recorded payment, so it cannot be refunded.'],
  RMA_NOTHING_TO_REFUND: [INVALID, () => 'There is no amount to refund: either nothing passed inspection, or earlier refunds on this order already cover what the customer paid. Close the request instead.'],
  RMA_REFUND_NOT_APPROVED: [INVALID, () => 'The refund must be approved before the payout can be recorded.'],
  RMA_PAYMENT_REFERENCE_USED: [CONFLICT, () => 'This payment reference has already been used for another refund.'],
  RMA_CLOSE_NOT_ALLOWED: [INVALID, () => 'Only inspected requests can be completed: exchanges once the replacement order exists, refunds only when no goods passed inspection.'],
  RMA_ATTACHMENT_INVALID: [INVALID, () => 'Please upload a JPG, PNG or WEBP photo smaller than 8 MB.'],
  RMA_ATTACHMENT_LIMIT: [INVALID, () => 'You can attach at most 5 photos to a request.'],
};

export function rmaError(code: keyof typeof CATALOG, params: Params = {}) {
  const [status, message] = CATALOG[code];
  return new AppException(code, message(params), status, Object.keys(params).length ? params : undefined);
}

export async function rmaDatabase<T>(operation: Promise<T>): Promise<T> {
  try { return await operation; }
  catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) throw error;
    const meta = error.meta as { code?: string; message?: string; target?: unknown; driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string } } } | undefined;
    const code = meta?.code ?? meta?.driverAdapterError?.cause?.originalCode;
    const message = `${meta?.message ?? meta?.driverAdapterError?.cause?.originalMessage ?? ''} ${JSON.stringify(meta?.target ?? '')}`;
    const raised = message.match(/RMA_[A-Z_]+/)?.[0];
    if (raised && raised in CATALOG) throw rmaError(raised);
    if (code === '23505' || error.code === 'P2002') {
      if (/one_open_per_order|order_id/.test(message)) throw rmaError('RMA_OPEN_REQUEST_EXISTS');
      if (message.includes('payment_reference')) throw rmaError('RMA_PAYMENT_REFERENCE_USED');
    }
    if (code === '42501') throw rmaError('RMA_FORBIDDEN');
    throw error;
  }
}
