import { PrismaService } from '../../prisma/prisma.service';
import { OrderCronService } from './order-cron.service';

describe('OrderCronService loyalty eligibility', () => {
  it('awards one percent of the paid merchandise amount, excluding shipping', async () => {
    const order = { id: 1, customer_id: 2, order_code: 'ORD-1', total_amount: 130000, shipping_fee: 30000 };
    const tx = {
      orders: { findMany: jest.fn().mockResolvedValue([order]), findFirst: jest.fn().mockResolvedValue(order) },
      customers: { update: jest.fn() },
      loyalty_point_logs: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ blocked: false }]),
    };
    const service = new OrderCronService({ withOrder: (_operation, callback) => callback(tx) } as unknown as PrismaService);

    const result = await service.awardPointsForCompletedOrders();

    expect(tx.customers.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { reward_points: { increment: 1000 } } });
    expect(tx.loyalty_point_logs.create).toHaveBeenCalledWith({ data: expect.objectContaining({ points: 1000 }) });
    expect(result.totalPointsAwarded).toBe(1000);
  });
  it('requires payment, delivered shipment and no return when scanning and rechecking', async () => {
    const order = { id: 1, customer_id: 2, order_code: 'ORD-1', total_amount: 10000 };
    const tx = {
      orders: { findMany: jest.fn().mockResolvedValue([order]), findFirst: jest.fn().mockResolvedValue(null) },
      customers: { update: jest.fn() },
      loyalty_point_logs: { create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ blocked: false }]),
    };
    const prisma = { withOrder: jest.fn((_operation, callback) => callback(tx)) };
    const service = new OrderCronService(prisma as unknown as PrismaService);

    const result = await service.awardPointsForCompletedOrders();

    const expected = expect.objectContaining({
      order_status: 'COMPLETED', payment_status: 'PAID',
      shipments: { is: expect.objectContaining({ shipping_status: 'DELIVERED', return_category: null, actual_delivery_at: { lte: expect.any(Date) } }) },
    });
    expect(tx.orders.findMany).toHaveBeenCalledWith({ where: expected });
    expect(tx.orders.findFirst).toHaveBeenCalledWith({ where: expect.objectContaining({ ...tx.orders.findMany.mock.calls[0][0].where, id: 1 }) });
    expect(tx.customers.update).not.toHaveBeenCalled();
    expect(tx.loyalty_point_logs.create).not.toHaveBeenCalled();
    expect(result.awardedCount).toBe(0);
  });
});
