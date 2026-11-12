import { Prisma } from '@prisma/client';
import { AppException } from '../../common/errors/app-exception';
import { rmaDatabase } from './return-errors';
import { ReturnsService } from './returns.service';

const customer = { id: 7, role: 'CUSTOMER', type: 'customer' };
const pharmacist = { id: 3, role: 'PHARMACIST', type: 'employee', facilityId: 2 };

function setup(overrides: { prescription?: boolean; attachments?: number; ratio?: number; goodsValue?: number; line?: Record<string, unknown>; request?: Record<string, unknown> } = {}) {
  const deliveredAt = new Date(Date.now() - 86_400_000);
  const order = {
    id: 10, order_code: 'ORD-1', customer_id: 7, export_facility_id: 2, order_status: 'COMPLETED', shipping_address: 'HCM',
    shipments: { shipping_status: 'DELIVERED', actual_delivery_at: deliveredAt },
    order_items: [{ id: 100, medicine_id: 5, variant_id: 50, quantity: 2, unit_price: 1000, medicine_name: 'Medicine A', unit_name: 'Box',
      medicines: { is_prescription: overrides.prescription ?? false, medicine_name: 'Medicine A' } }],
  };
  const request = { id: 1, code: 'RMA-1', order_id: 10, facility_id: 2, status: 'REQUESTED', return_method: 'CARRIER_PICKUP', resolution: 'REFUND', ...overrides.request };
  const line = { request_id: 1, order_item_id: 100, variant_id: 50, quantity: 2, reason_code: 'DAMAGED', restricted: false, approved_quantity: null,
    received_quantity: null, box_uids: [], ...overrides.line };
  const tx = {
    $queryRaw: jest.fn().mockImplementation((sql: TemplateStringsArray) => {
      const text = sql.join('');
      if (text.includes('return_paid_ratio')) return Promise.resolve([{ ratio: new Prisma.Decimal(overrides.ratio ?? 1) }]);
      if (text.includes('return_request_goods_value')) return Promise.resolve([{ value: new Prisma.Decimal(overrides.goodsValue ?? 0) }]);
      return Promise.resolve(text.includes('return_restricted_medicines') && overrides.prescription ? [{ id: 5 }] : []);
    }),
    orders: { findFirst: jest.fn().mockResolvedValue(order), findMany: jest.fn().mockResolvedValue([]) },
    order_items: { findFirst: jest.fn().mockResolvedValue({ medicine_name: 'Medicine A', assigned_uids: [], medicine_id: 5 }) },
    packaging_variants: { findMany: jest.fn().mockResolvedValue([{ id: 50, medicine_id: 5, unit_name: 'Box', price: new Prisma.Decimal(1000),
      original_price: null, discount_percent: 0, sale_start_date: null, sale_end_date: null }]) },
    facilities: { findFirst: jest.fn().mockResolvedValue({ id: 2 }) },
    return_requests: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: { id?: number } }) => Promise.resolve(where.id ? request : null)),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue(request),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    return_request_lines: {
      findMany: jest.fn().mockImplementation(({ where }: { where: { request_id: unknown } }) => Promise.resolve(typeof where.request_id === 'number' ? [line] : [])),
      createMany: jest.fn(), update: jest.fn(),
    },
    return_attachments: { count: jest.fn().mockResolvedValue(overrides.attachments ?? 0), findMany: jest.fn().mockResolvedValue([]) },
    return_request_events: { findMany: jest.fn().mockResolvedValue([]) },
    return_request_refunds: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = { withOrder: jest.fn((_operation: string, run: (client: typeof tx) => unknown) => run(tx)) };
  return { service: new ReturnsService(prisma as never, {} as never), tx, prisma };
}

const createDto = (reasonCode: string, quantity = 1) => ({
  orderId: 10, resolution: 'REFUND', returnMethod: 'CARRIER_PICKUP', lines: [{ orderItemId: 100, quantity, reasonCode }],
});

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(AppException);
  expect((error as AppException).code).toBe(code);
}

describe('ReturnsService', () => {
  it('creates a request for a delivered order within the return window', async () => {
    const { service, tx } = setup();
    await service.create(createDto('CHANGED_MIND'), customer);
    expect(tx.return_requests.create).toHaveBeenCalledWith({ data: expect.objectContaining({ order_id: 10, customer_id: 7, facility_id: 2, channel: 'ONLINE', pickup_address: 'HCM' }) });
    expect(tx.return_request_lines.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ request_id: 1, quantity: 1, restricted: false })] });
  });

  it('only accepts pharmacy-fault reasons for prescription medicines', async () => {
    const { service, tx } = setup({ prescription: true });
    await expectCode(service.create(createDto('CHANGED_MIND'), customer), 'RMA_RESTRICTED_ITEM');
    await service.create(createDto('WRONG_ITEM'), customer);
    expect(tx.return_request_lines.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ restricted: true })] });
  });

  it('requires a description when the reason is OTHER and stores it trimmed', async () => {
    const { service, tx } = setup();
    await expectCode(service.create(createDto('OTHER'), customer), 'RMA_REASON_NOTE_REQUIRED');
    const dto = createDto('OTHER');
    await service.create({ ...dto, lines: [{ ...dto.lines[0], reasonNote: '  Box smells odd  ' }] }, customer);
    expect(tx.return_request_lines.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ reason_code: 'OTHER', reason_note: 'Box smells odd' })] });
  });

  it('prices other pack sizes at the current price and keeps the paid price for the same variant', async () => {
    const { service, tx } = setup();
    tx.packaging_variants.findMany.mockResolvedValueOnce([
      { id: 50, medicine_id: 5, unit_name: 'Blister', price: new Prisma.Decimal(1), original_price: null, discount_percent: 0, sale_start_date: null, sale_end_date: null },
      { id: 51, medicine_id: 5, unit_name: 'Box', price: new Prisma.Decimal(180000), original_price: new Prisma.Decimal(200000), discount_percent: 10, sale_start_date: null, sale_end_date: null },
    ]);
    const { items } = await service.eligibility({ id: 10 }, customer);
    expect(items[0].exchangeOptions).toEqual([
      { variantId: 50, unitName: 'Blister', unitPrice: new Prisma.Decimal(1000) },
      { variantId: 51, unitName: 'Box', unitPrice: new Prisma.Decimal(200000) },
    ]);
  });

  it('values units at the price actually paid after an order-level voucher', async () => {
    const { service } = setup({ ratio: 0.75 });
    const { items } = await service.eligibility({ id: 10 }, customer);
    expect(items[0].paidUnitPrice).toEqual(new Prisma.Decimal(750));
    expect(items[0].exchangeOptions[0].unitPrice).toEqual(new Prisma.Decimal(750));
  });

  it('closes a refund request without payout only when nothing passed inspection', async () => {
    const credited = setup({ request: { status: 'INSPECTED' }, goodsValue: 500 });
    await expectCode(credited.service.close(1, pharmacist), 'RMA_CLOSE_NOT_ALLOWED');
    const nothing = setup({ request: { status: 'INSPECTED' }, goodsValue: 0 });
    await nothing.service.close(1, pharmacist);
    expect(nothing.tx.return_requests.updateMany).toHaveBeenCalledWith({ where: { id: 1, status: { in: ['INSPECTED'] } }, data: expect.objectContaining({ status: 'CLOSED' }) });
  });

  it('rejects quantities above what is still returnable', async () => {
    const { service } = setup();
    await expectCode(service.create(createDto('DAMAGED', 3), customer), 'RMA_QUANTITY_EXCEEDED');
  });

  it('treats items without a variant as not returnable', async () => {
    const { service, tx } = setup();
    const order = await tx.orders.findFirst();
    tx.orders.findFirst.mockResolvedValueOnce({ ...order, order_items: [{ ...order.order_items[0], variant_id: null }] });
    await expectCode(service.create(createDto('DAMAGED'), customer), 'RMA_QUANTITY_EXCEEDED');
  });

  it('hides internal refund and inspection notes from customers', async () => {
    const { service, tx } = setup();
    tx.return_request_events.findMany.mockResolvedValue([
      { id: 1, action: 'CARRIER_BOOKED', note: 'GHN 123', actor_type: 'employee', actor_name: 'Staff' },
      { id: 2, action: 'REFUNDED', note: 'paid, cashbook #45', actor_type: 'employee', actor_name: 'Staff' },
    ]);
    const detail = await service.detail(1, customer);
    expect(detail.events.map(event => event.note)).toEqual(['GHN 123', null]);
    expect(detail.events.every(event => event.actor_name === undefined)).toBe(true);
  });

  it('rejects orders past the return window', async () => {
    const { service, tx } = setup();
    tx.orders.findFirst.mockResolvedValueOnce({ ...(await tx.orders.findFirst()), shipments: { shipping_status: 'DELIVERED', actual_delivery_at: new Date(Date.now() - 8 * 86_400_000) } });
    await expectCode(service.create(createDto('DAMAGED'), customer), 'RMA_RETURN_WINDOW_EXPIRED');
  });

  it('keeps pharmacy-fault returns free of charge', async () => {
    const { service } = setup();
    await expectCode(service.approve(1, { lines: [{ orderItemId: 100, approvedQuantity: 1 }], customerFee: 20000 }, pharmacist), 'RMA_FEE_NOT_ALLOWED');
  });

  it('requires photo evidence before approving restricted goods', async () => {
    const { service } = setup({ line: { restricted: true } });
    await expectCode(service.approve(1, { lines: [{ orderItemId: 100, approvedQuantity: 1 }] }, pharmacist), 'RMA_EVIDENCE_REQUIRED');
  });

  it('approves with the audit action set before the status change', async () => {
    const { service, tx } = setup({ line: { reason_code: 'CHANGED_MIND' } });
    await service.approve(1, { lines: [{ orderItemId: 100, approvedQuantity: 1 }], customerFee: 15000 }, pharmacist);
    expect(tx.return_request_lines.update).toHaveBeenCalledWith(expect.objectContaining({ data: { approved_quantity: 1 } }));
    expect(tx.return_requests.updateMany).toHaveBeenCalledWith({ where: { id: 1, status: { in: ['REQUESTED'] } }, data: expect.objectContaining({ status: 'APPROVED', customer_fee: 15000 }) });
  });

  it('reports the current status when a transition is no longer possible', async () => {
    const { service, tx } = setup({ request: { status: 'CANCELLED' } });
    tx.return_requests.updateMany.mockResolvedValue({ count: 0 });
    await expectCode(service.reject(1, 'Not eligible', pharmacist), 'RMA_INVALID_TRANSITION');
  });

  it('never restocks prescription or special-storage goods', async () => {
    const { service } = setup({ request: { status: 'RECEIVED' }, line: { restricted: true, approved_quantity: 1, received_quantity: 1 } });
    await expectCode(service.inspect(1, { lines: [{ orderItemId: 100, passQuantity: 1, failQuantity: 0 }] }, pharmacist), 'RMA_RESTRICTED_RESTOCK');
  });

  it('records units that are not the product sold and removes them from quarantine like failed goods', async () => {
    const { service, tx } = setup({ request: { status: 'RECEIVED' }, line: { approved_quantity: 2, received_quantity: 2 } });
    await service.inspect(1, { lines: [{ orderItemId: 100, passQuantity: 0, failQuantity: 1, mismatchQuantity: 1 }] }, pharmacist);
    expect(tx.return_request_lines.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pass_quantity: 0, fail_quantity: 1, mismatch_quantity: 1 } }));
    const movement = tx.$queryRaw.mock.calls.find(([sql]: [TemplateStringsArray]) => sql.join('').includes('record_quarantine_movement'));
    expect(movement?.slice(1)).toEqual([1, 50, 2]);
  });

  it('explains which scanned boxes are wrong at receipt', async () => {
    const sold = '0e434d6b-2621-4488-b435-220421e8c36d';
    const other = '0ad0a4c8-3cab-48cd-b592-71a1653a7392';
    const untracked = setup({ request: { status: 'APPROVED' }, line: { approved_quantity: 1 } });
    await expectCode(untracked.service.receive(1, { lines: [{ orderItemId: 100, quantity: 1, boxUids: [other] }] }, pharmacist), 'RMA_BOXES_NOT_TRACKED');

    const tracked = setup({ request: { status: 'APPROVED' }, line: { approved_quantity: 1 } });
    tracked.tx.order_items.findFirst.mockResolvedValue({ medicine_name: 'Medicine A', assigned_uids: [sold], medicine_id: 5 });
    await expectCode(tracked.service.receive(1, { lines: [{ orderItemId: 100, quantity: 1, boxUids: [other] }] }, pharmacist), 'RMA_BOX_NOT_IN_ORDER');
    await expectCode(tracked.service.receive(1, { lines: [{ orderItemId: 100, quantity: 1, boxUids: [] }] }, pharmacist), 'RMA_BOX_COUNT');
  });

  it('does not allow a wrong-product verdict on boxes that were matched at receipt', async () => {
    const { service } = setup({ request: { status: 'RECEIVED' }, line: { approved_quantity: 1, received_quantity: 1, box_uids: ['0e434d6b-2621-4488-b435-220421e8c36d'] } });
    await expectCode(service.inspect(1, { lines: [{ orderItemId: 100, passQuantity: 0, failQuantity: 0, mismatchQuantity: 1 }] }, pharmacist), 'RMA_MISMATCH_ON_TRACKED_BOXES');
  });

  it('refuses a parcel that does not match, but not after a replacement was sent', async () => {
    const approved = setup({ request: { status: 'APPROVED' } });
    await approved.service.rejectReceipt(1, 'Box contained a different product', pharmacist);
    expect(approved.tx.return_requests.updateMany).toHaveBeenCalledWith({ where: { id: 1, status: { in: ['APPROVED'] } }, data: expect.objectContaining({ status: 'REJECTED', staff_note: 'Box contained a different product' }) });
    const shipped = setup({ request: { status: 'APPROVED', replacement_order_id: 99 } });
    await expectCode(shipped.service.rejectReceipt(1, 'x', pharmacist), 'RMA_RECEIPT_REJECT_NOT_ALLOWED');
  });
});

describe('rmaDatabase', () => {
  const dbError = (code: string, message: string) => new Prisma.PrismaClientKnownRequestError('db', { code: 'P2010', clientVersion: 'test', meta: { code, message } });

  it('maps RMA codes raised by SQL functions to friendly errors', async () => {
    await expectCode(rmaDatabase(Promise.reject(dbError('22023', 'RMA_EXCHANGE_OUT_OF_STOCK'))), 'RMA_EXCHANGE_OUT_OF_STOCK');
  });

  it('maps the one-open-request index to a conflict', async () => {
    await expectCode(rmaDatabase(Promise.reject(dbError('23505', 'duplicate key value violates unique constraint "return_requests_one_open_per_order"'))), 'RMA_OPEN_REQUEST_EXISTS');
  });

  it('maps row-level security rejections to a forbidden error', async () => {
    await expectCode(rmaDatabase(Promise.reject(dbError('42501', 'Return request action is not authorized'))), 'RMA_FORBIDDEN');
  });
});
