import { PrismaService } from './prisma.service';

describe('Catalog management context', () => {
  let service: PrismaService;
  let tx: { $queryRaw: jest.Mock };
  beforeEach(() => {
    service = Object.create(PrismaService.prototype) as PrismaService;
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]) };
    service.$transaction = jest.fn(run => run(tx)) as any;
  });
  it.each(['ADMIN', 'PHARMACIST', 'WAREHOUSE_STAFF', 'DELIVERY_STAFF'])('rejects %s before querying', async role => {
    const run = jest.fn();
    await expect(service.withCatalogManagement({ id: 1, type: 'employee', role }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('rejects customer actor before querying', async () => {
    const run = jest.fn();
    await expect(service.withCatalogManagement({ id: 1, type: 'customer', role: 'CUSTOMER' }, run)).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });
  it('fails closed if RLS is not ready', async () => {
    tx.$queryRaw.mockResolvedValue([{ ready: false }]);
    const run = jest.fn();
    await expect(service.withCatalogManagement({ id: 1, type: 'employee', role: 'SUPER_ADMIN' }, run)).rejects.toThrow('Catalog RLS setup is not ready');
    expect(run).not.toHaveBeenCalled();
  });
  it('sets a transaction-local catalog management identity', async () => {
    const result = await service.withCatalogManagement({ id: 12, type: 'employee', role: 'STORE_MANAGER' }, () => Promise.resolve('ok'));
    expect(result).toBe('ok');
    expect(tx.$queryRaw.mock.calls.slice(1).map(call => call[1])).toEqual(['manage', '12', 'employee', 'STORE_MANAGER']);
  });
});
