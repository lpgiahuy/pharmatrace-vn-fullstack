import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { CustomerGuard } from './customer.guard';

function context(user: unknown) {
  return { getHandler: () => null, getClass: () => null,
    switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

describe('Account role boundaries', () => {
  const guard = (roles: string[]) => new RolesGuard({ getAllAndOverride: () => roles } as unknown as Reflector);

  it('does not let ADMIN bypass a SUPER_ADMIN-only endpoint', () => {
    expect(guard(['SUPER_ADMIN']).canActivate(context({ role: 'ADMIN', type: 'employee' }))).toBe(false);
  });

  it('accepts known legacy spellings without granting a different role', () => {
    expect(guard(['STORE_MANAGER']).canActivate(context({ role: 'StoreManager', type: 'employee' }))).toBe(true);
    expect(guard(['PHARMACIST']).canActivate(context({ role: 'StoreManager', type: 'employee' }))).toBe(false);
  });

  it('does not let a super administrator use customer-only routes', () => {
    expect(guard(['CUSTOMER']).canActivate(context({ role: 'SUPER_ADMIN', type: 'employee' }))).toBe(false);
  });

  it('rejects a role paired with the wrong account type', () => {
    expect(guard(['SUPER_ADMIN']).canActivate(context({ role: 'SUPER_ADMIN', type: 'customer' }))).toBe(false);
  });

  it('rejects an employee token on customer routes even when IDs coincide', () => {
    expect(() => new CustomerGuard().canActivate(context({ id: 1, role: 'PHARMACIST', type: 'employee' }))).toThrow();
    expect(new CustomerGuard().canActivate(context({ id: 1, role: 'CUSTOMER', type: 'customer' }))).toBe(true);
  });

  it('rejects a missing identity', () => {
    expect(() => new CustomerGuard().canActivate(context(undefined))).toThrow();
  });
});
