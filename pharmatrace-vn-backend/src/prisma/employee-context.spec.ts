import { PrismaService } from './prisma.service';

describe('Employee management context', () => {
  let service: PrismaService;
  let tx: { $queryRaw: jest.Mock };
  beforeEach(() => {
    service = Object.create(PrismaService.prototype) as PrismaService;
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]) };
    service.$transaction = jest.fn(run => run(tx)) as any;
  });
  it.each(['STORE_MANAGER', 'ADMIN', 'PHARMACIST'])('rejects %s before querying', async role => {
    const run = jest.fn();
    await expect(service.withEmployeeManagement({ id: 1, type: 'employee', role }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects customer actor before querying', async () => {
    const run = jest.fn();
    await expect(service.withEmployeeManagement({ id: 1, type: 'customer', role: 'CUSTOMER' }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('fails closed if RLS is not ready', async () => {
    tx.$queryRaw.mockResolvedValue([{ ready: false }]);
    const run = jest.fn();
    await expect(service.withEmployeeManagement({ id: 1, type: 'employee', role: 'SUPER_ADMIN' }, run)).rejects.toThrow('Employee RLS setup is not ready');
    expect(run).not.toHaveBeenCalled();
  });
  it('sets a transaction-local administrator identity', async () => {
    const result = await service.withEmployeeManagement({ id: 12, type: 'employee', role: 'SUPER_ADMIN' }, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(tx.$queryRaw.mock.calls.slice(1).map(call => call[1])).toEqual(['manage', '12', 'employee', 'SUPER_ADMIN']);
  });
});
