import { BadRequestException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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

  it('rejects staff delivery confirmation', async () => {
    await expect(service.changeStatus(1, { status: 'DELIVERED' }, actor)).rejects.toThrow(/customer/i);
    expect(prisma.withOrder).not.toHaveBeenCalled();
  });

  it('safely returns shipment details even when logistics_events table is unprivileged or missing', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 4, order_id: 126, tracking_number: 'TRK-4' });
    tx.$queryRaw.mockResolvedValueOnce([{ exists: false }]);
    const result = await service.shipment(4, actor);
    expect(result).toMatchObject({ id: 4, tracking_number: 'TRK-4', history: [] });
  });

  it('fails closed when the COD procedure is unavailable', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7 });
    tx.$queryRaw.mockResolvedValueOnce([{ executable: false }]);
    await expect(service.collect(7, actor)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(tx.shipments.update).not.toHaveBeenCalled();
  });

  it('returns the procedure receipt and never writes a second receipt after retry', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7 });
    tx.$queryRaw.mockResolvedValueOnce([{ executable: true }]).mockResolvedValueOnce([{ cashbook_id: 99 }]);
    await expect(service.collect(7, actor)).resolves.toEqual({ shipmentId: 7, cashbookId: 99 });
    expect(tx.shipments.update).not.toHaveBeenCalled();
  });

  it('propagates procedure failures instead of falling back to a new cashbook write', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7 });
    tx.$queryRaw.mockResolvedValueOnce([{ executable: true }]).mockRejectedValueOnce(new Error('database failed'));
    await expect(service.collect(7, actor)).rejects.toThrow('database failed');
    expect(tx.shipments.update).not.toHaveBeenCalled();
  });

  it('does not collect when the procedure rejects eligibility', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 7 });
    tx.$queryRaw.mockResolvedValueOnce([{ executable: true }]).mockResolvedValueOnce([{ cashbook_id: null }]);
    await expect(service.collect(7, actor)).rejects.toBeInstanceOf(BadRequestException);
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
