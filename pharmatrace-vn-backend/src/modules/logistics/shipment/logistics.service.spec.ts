import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LogisticsService } from './logistics.service';
import { ShipmentQueryDto } from './dto/shipment-query.dto';

const actor = { id: 1, type: 'employee' as const, role: 'STORE_MANAGER', facilityId: 2 };

describe('LogisticsService', () => {
  const tx = { shipments: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), groupBy: jest.fn() }, orders: { updateMany: jest.fn() }, $queryRaw: jest.fn() };
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

  it('updates the order in the same transaction when delivered', async () => {
    tx.shipments.findFirst.mockResolvedValue({ id: 1, order_id: 2, shipping_status: 'IN_TRANSIT', orders: { order_status: 'SHIPPING' } });
    tx.shipments.updateMany.mockResolvedValue({ count: 1 });
    tx.orders.updateMany.mockResolvedValue({ count: 1 });
    await service.changeStatus(1, { status: 'DELIVERED' }, actor);
    expect(tx.orders.updateMany).toHaveBeenCalledWith({ where: { id: 2, order_status: 'SHIPPING' }, data: { order_status: 'COMPLETED' } });
  });
});
