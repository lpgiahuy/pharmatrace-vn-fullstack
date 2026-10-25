import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtStrategy } from './jwt.strategy';

describe('JWT identity revalidation', () => {
  const tx = { customers: { findUnique: jest.fn() }, employees: { findUnique: jest.fn() } };
  const prisma = { withAuth: jest.fn((operation) => operation(tx)) };
  const config = { getOrThrow: () => 'test-jwt-secret-not-for-deployment' };
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(config as unknown as ConfigService, prisma as unknown as PrismaService);
  });

  it('rejects missing type and inconsistent IDs before accessing the database', async () => {
    await expect(strategy.validate({ id: 1, role: 'CUSTOMER' })).rejects.toThrow();
    await expect(strategy.validate({ id: 1, sub: 2, role: 'CUSTOMER', type: 'customer' })).rejects.toThrow();
    expect(prisma.withAuth).not.toHaveBeenCalled();
  });

  it('rejects a locked customer even if the token has not expired', async () => {
    tx.customers.findUnique.mockResolvedValue({ id: 1, status: 'INACTIVE' });
    await expect(strategy.validate({ id: 1, role: 'CUSTOMER', type: 'customer' })).rejects.toThrow();
  });

  it('uses the employee table rather than the same numeric customer ID', async () => {
    tx.employees.findUnique.mockResolvedValue({ id: 1, role: 'PHARMACIST', status: 'ACTIVE', facility_id: 2 });
    await expect(strategy.validate({ id: 1, role: 'PHARMACIST', type: 'employee', facilityId: 2 }))
      .resolves.toMatchObject({ id: 1, type: 'employee', role: 'PHARMACIST', facilityId: 2 });
    expect(tx.customers.findUnique).not.toHaveBeenCalled();
  });

  it.each([
    { role: 'STORE_MANAGER', facility_id: 2 },
    { role: 'PHARMACIST', facility_id: 3 },
  ])('rejects stale employee permissions: %j', async (permissions) => {
    tx.employees.findUnique.mockResolvedValue({ id: 1, status: 'ACTIVE', ...permissions });
    await expect(strategy.validate({ id: 1, role: 'PHARMACIST', type: 'employee', facilityId: 2 })).rejects.toThrow();
  });
});
