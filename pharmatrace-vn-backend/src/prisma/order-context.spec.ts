import { PrismaService, OrderOperation } from './prisma.service';
import { AuthActor } from '../common/auth-identity';

describe('Order transaction context', () => {
  let service: PrismaService;
  let tx: { $queryRaw: jest.Mock };
  beforeEach(() => {
    service = Object.create(PrismaService.prototype) as PrismaService;
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]) };
    service.$transaction = jest.fn(run => run(tx)) as any;
  });
  it.each([
    ['checkout', undefined],
    ['checkout', { id: 1, type: 'employee', role: 'SUPER_ADMIN' }],
    ['status', { id: 1, type: 'customer', role: 'CUSTOMER' }],
    ['status', { id: 1, type: 'employee', role: 'WAREHOUSE_STAFF', facilityId: 1 }],
    ['read', { id: 1, type: 'employee', role: 'STORE_MANAGER' }],
    ['receive', { id: 1, type: 'employee', role: 'PHARMACIST', facilityId: 1 }],
    ['loyalty', { id: 1, type: 'employee', role: 'SUPER_ADMIN' }],
    ['read', { id: 1, type: 'employee', role: 'ADMIN' }],
  ])('rejects mismatched identity or facility for %s', async (scope, actor) => {
    const run = jest.fn();
    await expect(service.withOrder(scope as OrderOperation, run, actor as AuthActor)).rejects.toThrow();
    expect(service.$transaction).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['read', 'status', 'pack', 'prescription'] as const)('allows pharmacists to perform %s at their facility', async (scope) => {
    const run = jest.fn().mockResolvedValue(true);
    await expect(service.withOrder(scope, run, { id: 1, type: 'employee', role: 'PHARMACIST', facilityId: 2 })).resolves.toBe(true);
    expect(tx.$queryRaw.mock.calls.slice(1).map(call => call[1])).toEqual([scope, '1', 'employee', 'PHARMACIST', '2']);
    expect(run).toHaveBeenCalledWith(tx);
  });
  it('fails closed when database protection is incomplete', async () => {
    tx.$queryRaw.mockResolvedValue([{ ready: false }]);
    const run = jest.fn();
    await expect(service.withOrder('read', run, { id: 1, role: 'CUSTOMER', type: 'customer' })).rejects.toThrow('Order RLS setup is not ready');
    expect(run).not.toHaveBeenCalled();
  });
  it('clears all identity fields for internal loyalty jobs', async () => {
    await service.withOrder('loyalty', async () => true);
    expect(tx.$queryRaw.mock.calls.slice(1).map(call => call[1])).toEqual(['loyalty', '', '', '', '']);
  });
});
