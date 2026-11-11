import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { ShipmentQueryDto } from './dto/shipment-query.dto';

const actor = { id: 1, type: 'employee' as const, role: 'STORE_MANAGER', facilityId: 2 };

describe('LogisticsService', () => {
  const tx = { shipments: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() }, orders: { updateMany: jest.fn() }, $queryRaw: jest.fn() };
  const prisma = { withOrder: jest.fn((_operation, callback) => callback(tx)) };
  const service = new LogisticsService(prisma as never);
  beforeEach(() => jest.clearAllMocks());

  it('restricts COD listing to positive COD and applies pagination and filters', async () => {
    tx.shipments.count.mockResolvedValue(1);
    tx.shipments.findMany.mockResolvedValue([{ id: 3 }]);
    tx.shipments.groupBy.mockResolvedValue([{ cod_settlement_status: 'UNSETTLED', _count: { _all: 1 }, _sum: { cod_amount: 100 } }]);
    const query = Object.assign(new ShipmentQueryDto(), { page: 2, limit: 10, status: 'UNSETTLED', courier: 'Carrier' });
    const result = await service.shipments(query, actor, true);
    expect(prisma.withOrder).toHaveBeenCalledWith('read', expect.any(Function), expect.objectContaining(actor));
    expect(tx.shipments.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { cod_amount: { gt: 0 }, cod_settlement_status: 'UNSETTLED', courier_name: 'Carrier' }, skip: 10, take: 10,
    }));
    expect(result.pagination.total).toBe(1);
    expect(tx.shipments.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { cod_amount: { gt: 0 }, cod_settlement_status: 'UNSETTLED', courier_name: 'Carrier' } }));
    expect(result.summary).toEqual([{ cod_settlement_status: 'UNSETTLED', _count: { _all: 1 }, _sum: { cod_amount: 100 } }]);
  });

  it('rejects reversed dates before querying', async () => {
    const query = Object.assign(new ShipmentQueryDto(), { from: '2026-11-02', to: '2026-11-01' });
    await expect(service.shipments(query, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('does not expose missing or inaccessible shipment', async () => {
    tx.shipments.findFirst.mockResolvedValue(null);
    await expect(service.shipment(5, actor)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires a reason for failed delivery', async () => {
    await expect(service.changeStatus(1, { status: 'DELIVERY_FAILED' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('rejects duplicate variants before processing a return disposition', async () => {
    const line = { variantId: 7, passQuantity: 1, failQuantity: 0 };
    await expect(service.dispositionReturn(1, { decision: 'RESTOCK', qaNotes: 'Inspected', lines: [line, line] }, actor))
      .rejects.toThrow(/only once/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('requires the actual received quantities for intake', async () => {
    await expect(service.requestPostDeliveryReturn(1, { reason: 'Damaged', lines: [] }, actor))
      .rejects.toThrow(/authorized quantity/i);
    await expect(service.receiveReturn(1, { receivedLines: [] }, actor))
      .rejects.toThrow(/actual quantities/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('quarantines packed boxes returned after a failed delivery', async () => {
    const uid = 'd03e44b1-99b0-4e1f-93e4-ca73eec4f5cd';
    const boxes = { updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
    Object.assign(tx, { medicine_boxes: boxes, $executeRaw: jest.fn().mockRejectedValue(new Error('stop after custody move')) });
    tx.$queryRaw.mockResolvedValue([]);
    tx.shipments.findFirst.mockResolvedValue({
      id: 1, shipping_status: 'RETURN_IN_TRANSIT', return_category: null,
      orders: { export_facility_id: 2, order_items: [{ variant_id: 7, quantity: 1, assigned_uids: [uid] }] },
    });
    await expect(service.receiveReturn(1, { receivedLines: [{ variantId: 7, quantity: 1, boxUids: [uid] }] }, actor))
      .rejects.toThrow(/stop after custody move/);
    expect(boxes.updateMany).toHaveBeenCalledWith({
      where: { uid: { in: [uid] }, status: { in: expect.arrayContaining(['PACKAGED']) } },
      data: { current_facility_id: 2, status: 'QUARANTINED' },
    });
  });

  it('rejects staff delivery confirmation', async () => {
    await expect(service.changeStatus(1, { status: 'DELIVERED' }, actor)).rejects.toThrow(/customer/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('safely returns shipment details even when logistics_events table is unprivileged or missing', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 4, order_id: 126, tracking_number: 'TRK-4' });
    tx.$queryRaw.mockResolvedValueOnce([{ exists: false }]).mockResolvedValue([]);
    const result = await service.shipment(4, actor);
    expect(result).toMatchObject({ id: 4, tracking_number: 'TRK-4', history: [] });
  });

  it('blocks legacy COD collection without reading or writing the database', async () => {
    await expect(service.collect(7, actor)).rejects.toThrow(/COD reconciliation/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('requires RMA approval for a customer return after delivery', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7, shipping_status: 'DELIVERED' });
    await expect(service.requestReturn(7, 'Customer return', actor)).rejects.toThrow(/RMA/);
    expect(tx.shipments.updateMany).not.toHaveBeenCalled();
  });

  it('allows a failed-delivery return without changing the completed-delivery timestamp or inventory', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7, shipping_status: 'DELIVERY_FAILED' });
    tx.shipments.updateMany.mockResolvedValue({ count: 1 });
    await service.requestReturn(7, 'Cannot contact recipient', actor);
    expect(tx.shipments.updateMany).toHaveBeenCalledWith({ where: { id: 7, shipping_status: 'DELIVERY_FAILED' }, data: { shipping_status: 'RETURN_REQUESTED' } });
  });

  it('rejects pickup until actual carrier tracking is confirmed', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7, shipping_status: 'PENDING_PICKUP', carrier_confirmed_at: null });
    await expect(service.changeStatus(7, { status: 'PICKED_UP' }, actor)).rejects.toThrow(/tracking/);
    expect(tx.shipments.updateMany).not.toHaveBeenCalled();
  });

  it('moves the order to picked up when the carrier accepts the shipment', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7, order_id: 10, shipping_status: 'PENDING_PICKUP', carrier_confirmed_at: new Date(), orders: { order_status: 'PENDING_PICKUP' } });
    tx.shipments.updateMany.mockResolvedValue({ count: 1 });
    tx.orders.updateMany.mockResolvedValue({ count: 1 });
    await service.changeStatus(7, { status: 'PICKED_UP' }, actor);
    expect(tx.orders.updateMany).toHaveBeenCalledWith({ where: { id: 10, order_status: 'PENDING_PICKUP' }, data: { order_status: 'PICKED_UP' } });
  });

  it('rejects pickup if the order state does not match the shipment', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7, order_id: 10, shipping_status: 'PENDING_PICKUP', carrier_confirmed_at: new Date(), orders: { order_status: 'CANCELLED' } });
    tx.shipments.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.changeStatus(7, { status: 'PICKED_UP' }, actor)).rejects.toThrow(/does not match/);
  });

  it('confirms actual carrier details before pickup', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7, shipping_status: 'PENDING_PICKUP' });
    tx.shipments.updateMany.mockResolvedValue({ count: 1 });
    await service.updateCarrier(7, { courierName: ' ghn ', trackingNumber: ' ABC ' }, actor);
    expect(tx.shipments.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7, shipping_status: 'PENDING_PICKUP' },
      data: expect.objectContaining({ courier_name: 'GHN', tracking_number: 'ABC', carrier_confirmed_at: expect.any(Date) }),
    }));
  });

  it('rejects a blank carrier or tracking number before writing', async () => {
    await expect(service.updateCarrier(7, { courierName: '  ', trackingNumber: 'ABC' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateCarrier(7, { courierName: 'GHN', trackingNumber: '  ' }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('does not overwrite the carrier after pickup', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7, shipping_status: 'IN_TRANSIT' });
    await expect(service.updateCarrier(7, { courierName: 'GHN', trackingNumber: 'ABC' }, actor)).rejects.toThrow(/before pickup/);
    expect(tx.shipments.updateMany).not.toHaveBeenCalled();
  });
});
