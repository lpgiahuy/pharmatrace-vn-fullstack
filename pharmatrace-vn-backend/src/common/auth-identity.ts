import { ForbiddenException } from '@nestjs/common';

export interface AuthActor {
  id: number;
  role: string;
  type: 'customer' | 'employee';
  facilityId?: number | null;
}

const roles = [
  'CUSTOMER', 'SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'SALES_STAFF',
  'PHARMACIST', 'WAREHOUSE_STAFF', 'WAREHOUSE_MANAGER', 'FACTORY_WAREHOUSE_STAFF',
];

export function normalizeRole(role?: string): string | undefined {
  if (typeof role !== 'string') return undefined;
  const key = (role || '').trim().replace(/_/g, '').toUpperCase();
  return roles.find((candidate) => candidate.replace(/_/g, '') === key);
}

export function requireCustomer(user?: { id: number; type?: string; role?: string }): number {
  if (!user || user.type !== 'customer' || normalizeRole(user.role) !== 'CUSTOMER') {
    throw new ForbiddenException('A customer account is required');
  }
  return user.id;
}

export function authActor(user: { id: number; type?: string; role?: string; facilityId?: number | null }): AuthActor {
  const role = normalizeRole(user.role);
  if (!Number.isInteger(user.id) || user.id <= 0 || !role
    || (user.type !== 'customer' && user.type !== 'employee')
    || (user.type === 'customer' ? role !== 'CUSTOMER' : role === 'CUSTOMER')) {
    throw new ForbiddenException('Invalid account identity');
  }
  return { id: user.id, type: user.type, role, facilityId: user.facilityId };
}
