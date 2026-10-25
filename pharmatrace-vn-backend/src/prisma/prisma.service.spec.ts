import { PrismaService } from './prisma.service';

describe('Auth transaction rollout', () => {
  const previous = process.env.AUTH_RLS_ENABLED;
  let service: PrismaService;
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };

  beforeEach(() => {
    service = Object.create(PrismaService.prototype) as PrismaService;
    tx = { $queryRaw: jest.fn().mockResolvedValue([]), $executeRaw: jest.fn().mockResolvedValue(0) };
    service.$transaction = jest.fn((operation) => operation(tx)) as any;
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.AUTH_RLS_ENABLED;
    else process.env.AUTH_RLS_ENABLED = previous;
  });

  it('keeps role switching disabled until activation and still clears every context field', async () => {
    process.env.AUTH_RLS_ENABLED = 'false';
    await service.withAuth(async () => 'ok');
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalledTimes(6);
    for (const call of tx.$queryRaw.mock.calls) expect(call[1]).toBe('');
  });

  it.each([
    { roles: [] },
    { roles: [{ rolsuper: true, rolbypassrls: false, protected: true, connection_restricted: true }] },
    { roles: [{ rolsuper: false, rolbypassrls: true, protected: true, connection_restricted: true }] },
    { roles: [{ rolsuper: false, rolbypassrls: false, protected: false, connection_restricted: true }] },
    { roles: [{ rolsuper: false, rolbypassrls: false, protected: true, connection_restricted: false }] },
  ])('refuses incomplete or privileged RLS configuration: %j', async ({ roles }) => {
    process.env.AUTH_RLS_ENABLED = 'true';
    tx.$queryRaw.mockResolvedValue(roles);
    const operation = jest.fn();
    await expect(service.withAuth(operation)).rejects.toThrow('Auth RLS migration is not ready');
    expect(operation).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('switches the transaction role before running the auth query', async () => {
    process.env.AUTH_RLS_ENABLED = 'true';
    tx.$queryRaw.mockResolvedValue([{ rolsuper: false, rolbypassrls: false, protected: true, connection_restricted: true }]);
    const result = await service.withAuth(async () => {
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      return 'scoped';
    }, { actor: { id: 1, role: 'CUSTOMER', type: 'customer' } });
    expect(result).toBe('scoped');
  });
});
