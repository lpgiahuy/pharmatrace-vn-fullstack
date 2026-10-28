import { PrismaService } from './prisma.service';

describe('Customer management context', () => {
  let service: PrismaService;
  let tx: { $queryRaw: jest.Mock };
  beforeEach(() => {
    service = Object.create(PrismaService.prototype) as PrismaService;
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]) };
    service.$transaction = jest.fn(run => run(tx)) as any;
  });
  it.each(['ADMIN', 'WAREHOUSE_STAFF', 'DELIVERY_STAFF'])('rejects %s before querying', async role => {
    const run = jest.fn();
    await expect(service.withCustomerManagement({ id: 1, type: 'employee', role }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects customer actor before querying', async () => {
    const run = jest.fn();
    await expect(service.withCustomerManagement({ id: 1, type: 'customer', role: 'CUSTOMER' }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('fails closed if RLS is not ready', async () => {
    tx.$queryRaw.mockResolvedValue([{ ready: false }]);
    const run = jest.fn();
    await expect(service.withCustomerManagement({ id: 1, type: 'employee', role: 'SUPER_ADMIN' }, run)).rejects.toThrow('Customer RLS setup is not ready');
    expect(run).not.toHaveBeenCalled();
  });
  it('sets transaction-local customer management variables', async () => {
    const result = await service.withCustomerManagement({ id: 12, type: 'employee', role: 'STORE_MANAGER', facilityId: 5 }, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(tx.$queryRaw.mock.calls.slice(1).map(call => call[1])).toEqual(['manage', '12', 'employee', 'STORE_MANAGER', '5', 'read']);
  });
});
