import { PrismaService } from './prisma.service';
import { AuthActor } from '../common/auth-identity';

describe('Review access context', () => {
  let service: PrismaService;
  let tx: { $queryRaw: jest.Mock };
  beforeEach(() => {
    service = Object.create(PrismaService.prototype) as PrismaService;
    tx = { $queryRaw: jest.fn().mockResolvedValue([{ ready: true }]) };
    service.$transaction = jest.fn(operation => operation(tx)) as any;
  });
  it.each([
    ['customer', undefined],
    ['customer', { id: 1, type: 'employee', role: 'PHARMACIST' }],
    ['moderator', { id: 1, type: 'employee', role: 'PHARMACIST' }],
    ['staff', { id: 1, type: 'employee', role: 'WAREHOUSE_STAFF' }],
    ['public', { id: 1, type: 'customer', role: 'CUSTOMER' }],
    ['helpful', { id: 1, type: 'employee', role: 'ADMIN' }],
  ])('rejects an invalid identity for %s before opening a transaction', async (scope, actor) => {
    const operation = jest.fn();
    await expect(service.withReview(scope as any, operation, actor as AuthActor)).rejects.toThrow();
    expect(service.$transaction).not.toHaveBeenCalled();
    expect(operation).not.toHaveBeenCalled();
  });
  it('fails closed when table protection or the runtime role is not ready', async () => {
    tx.$queryRaw.mockResolvedValue([{ ready: false }]);
    const operation = jest.fn();
    await expect(service.withReview('public', operation)).rejects.toThrow('Review RLS setup is not ready');
    expect(operation).not.toHaveBeenCalled();
  });
  it('clears actor context for anonymous calls without switching database roles', async () => {
    await service.withReview('public', async () => true);
    expect(tx.$queryRaw.mock.calls.slice(1).map(call => call[1])).toEqual(['public', '', '', '', '']);
    expect(tx.$queryRaw.mock.calls.some(call => call[0].join('').includes('SET LOCAL ROLE'))).toBe(false);
  });
});
