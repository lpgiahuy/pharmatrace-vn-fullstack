import { LogisticsService } from './shipment/logistics.service';

describe('Return integrity', () => {
  const actor = { id: 1, type: 'employee' as const, role: 'STORE_MANAGER', facilityId: 2 };
  function setup() {
    const tx = {
      $queryRaw: jest.fn().mockImplementation((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('shipment_return_items') ? [{ variant_id: 3, quantity: 2, box_uids: ['A', 'B'] }] : [])),
      $executeRaw: jest.fn().mockResolvedValue(1),
      shipments: {
        findFirst: jest.fn().mockResolvedValue({
          id: 1, order_id: 2, shipping_status: 'RETURNED_TO_WAREHOUSE', return_qa_status: 'PENDING_INSPECTION',
          orders: { export_facility_id: 2, order_items: [{ variant_id: 3, quantity: 2, assigned_uids: ['A', 'B'] }] },
        }),
        update: jest.fn(),
      },
      inventories: { upsert: jest.fn().mockResolvedValue({ stock_quantity: 1 }) },
      medicine_boxes: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inventory_logs: { create: jest.fn() },
      orders: { updateMany: jest.fn() },
    };
    return { tx, service: new LogisticsService({ withOrder: (_op, run) => run(tx) } as never) };
  }
  it.each([
    { restockBoxUids: ['FOREIGN'], scrapBoxUids: ['B'] },
    { restockBoxUids: ['A'], scrapBoxUids: ['A'] },
    { restockBoxUids: [], scrapBoxUids: ['B'] },
  ])('rejects invalid UID allocation before restocking: %j', async (uids) => {
    const { tx, service } = setup();
    await expect(service.dispositionReturn(1, {
      decision: 'PARTIAL_RESTOCK', qaNotes: 'Inspected',
      lines: [{ variantId: 3, passQuantity: 1, failQuantity: 1, ...uids }],
    }, actor)).rejects.toThrow(/UID/i);
    expect(tx.inventories.upsert).not.toHaveBeenCalled();
  });
  it('locks the shipment before reading QA state', async () => {
    const { tx, service } = setup();
    await service.dispositionReturn(1, { decision: 'PARTIAL_RESTOCK', qaNotes: 'Inspected', lines: [
      { variantId: 3, passQuantity: 1, failQuantity: 1, restockBoxUids: ['A'], scrapBoxUids: ['B'] },
    ] }, actor);
    expect(tx.$queryRaw.mock.calls[0][0].join('')).toMatch(/FOR UPDATE/);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.shipments.findFirst.mock.invocationCallOrder[0]);
  });
  it('uses the recorded received quantity and marks a partially returned order', async () => {
    const { tx, service } = setup();
    tx.$queryRaw.mockImplementation((strings: TemplateStringsArray) => Promise.resolve(strings.join('').includes('shipment_return_items') ? [{ variant_id: 3, quantity: 1, box_uids: ['A'] }] : []));
    await service.dispositionReturn(1, { decision: 'RESTOCK', qaNotes: 'Inspected', lines: [
      { variantId: 3, passQuantity: 1, failQuantity: 0, restockBoxUids: ['A'] },
    ] }, actor);
    expect(tx.orders.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ order_status: 'PARTIALLY_RETURNED' }) }));
  });
});
