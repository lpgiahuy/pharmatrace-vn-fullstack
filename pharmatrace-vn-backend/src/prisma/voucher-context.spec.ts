import { AuthActor } from '../common/auth-identity';
import { PrismaService, VoucherScope } from './prisma.service';

describe('Voucher transaction context', () => {
  let service: PrismaService;
  let tx: { $queryRaw: jest.Mock };
  beforeEach(() => {
    service = Object.create(PrismaService.prototype) as PrismaService;
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]) };
    service.$transaction = jest.fn(run => run(tx)) as any;
  });
  it.each([
    ['validate', undefined, ''],
    ['validate', { id: 1, role: 'CUSTOMER', type: 'customer' }, 'CODE'],
    ['read', undefined, ''],
    ['read', { id: 1, role: 'CUSTOMER', type: 'customer' }, ''],
    ['read', { id: 1, role: 'WAREHOUSE_STAFF', type: 'employee' }, ''],
    ['manage', { id: 1, role: 'STORE_MANAGER', type: 'employee' }, ''],
    ['manage', { id: 1, role: 'PHARMACIST', type: 'employee' }, ''],
    ['manage', { id: 1, role: 'ADMIN', type: 'employee' }, ''],
  ])('rejects invalid identity for %s', async (scope, actor, code) => {
    const run = jest.fn();
    await expect(service.withVoucher(scope as VoucherScope, run, { actor: actor as AuthActor, code })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
    expect(service.$transaction).not.toHaveBeenCalled();
  });
  it('fails closed before the query when RLS or runtime is not ready', async () => {
    tx.$queryRaw.mockResolvedValue([{ ready: false }]);
    const run = jest.fn();
    await expect(service.withVoucher('validate', run, { code: 'CODE' })).rejects.toThrow('Voucher RLS setup is not ready');
    expect(run).not.toHaveBeenCalled();
  });
  it('normalizes the exact code and clears actor/order fields for public previews', async () => {
    await service.withVoucher('validate', async () => true, { code: ' demo-code ' });
    expect(tx.$queryRaw.mock.calls.slice(1).map(call => call[1])).toEqual(['validate', 'DEMO-CODE', '', '', '', '', '']);
  });
});
