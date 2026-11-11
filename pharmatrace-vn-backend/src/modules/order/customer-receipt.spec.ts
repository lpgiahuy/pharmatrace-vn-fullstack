import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrderService } from './order.service';

describe('Customer receipt', () => {
  const tx = { $queryRaw: jest.fn() };
  const prisma = { withOrder: jest.fn((_operation, callback) => callback(tx)) };
  const service = new OrderService(prisma as never);
  beforeEach(() => { jest.clearAllMocks(); });

  it.each(['RECEIVED', 'ALREADY_RECEIVED'])('returns the customer order after %s', async (result) => {
    tx.$queryRaw.mockResolvedValueOnce([{ result }]);
    const read = jest.spyOn(service, 'getMyOrderById').mockResolvedValueOnce({ id: 42 } as never);
    await expect(service.confirmReceipt(7, 42)).resolves.toEqual({ id: 42 });
    expect(prisma.withOrder).toHaveBeenCalledWith('customer_receive', expect.any(Function), { id: 7, type: 'customer', role: 'CUSTOMER' });
    expect(read).toHaveBeenCalledWith(7, 42);
    read.mockRestore();
  });

  it('does not reveal a different customer order', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ result: 'NOT_FOUND' }]);
    await expect(service.confirmReceipt(7, 42)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a shipment that is not in transit', async () => {
    tx.$queryRaw.mockResolvedValueOnce([{ result: 'NOT_READY' }]);
    await expect(service.confirmReceipt(7, 42)).rejects.toBeInstanceOf(BadRequestException);
  });
});
