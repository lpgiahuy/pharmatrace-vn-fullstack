import { Injectable, OnModuleInit, OnModuleDestroy, ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { AuthActor, authActor } from '../common/auth-identity';

export type ReviewScope = 'public' | 'customer' | 'staff' | 'moderator' | 'helpful';
export type VoucherScope = 'validate' | 'read' | 'manage';
export type OrderOperation = 'read' | 'checkout' | 'cancel' | 'customer_receive' | 'status' | 'pack' | 'transfer_read' | 'dispatch' | 'receive' | 'replace' | 'prescription' | 'loyalty';

export interface AuthContext {
  actor?: AuthActor;
  operation?: 'customer_login' | 'employee_login' | 'register';
  identifier?: string;
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }

  async withAuth<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    context: AuthContext = {},
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      if (process.env.AUTH_RLS_ENABLED === 'true') {
        const [role] = await tx.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean; protected: boolean; connection_restricted: boolean }[]>`
          SELECT r.rolsuper, r.rolbypassrls,
            NOT connection.rolsuper AND NOT connection.rolbypassrls AS connection_restricted,
            (SELECT count(*) = 2 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
                AND c.relowner <> r.oid AND c.relowner <> connection.oid)
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname IN ('customers', 'employees')) AS protected
          FROM pg_roles r JOIN pg_roles connection ON connection.rolname = current_user
          WHERE r.rolname = 'auth_runtime'
        `;
        if (!role || role.rolsuper || role.rolbypassrls || !role.protected || !role.connection_restricted) {
          throw new ServiceUnavailableException('Auth RLS migration is not ready');
        }
        await tx.$executeRaw`SET LOCAL ROLE auth_runtime`;
      }
      const actor = context.actor;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.auth_operation', ${context.operation || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.auth_identifier', ${context.identifier || ''}, true)`;
      return operation(tx);
    });
  }

  async withReview<T>(scope: ReviewScope, operation: (tx: Prisma.TransactionClient) => Promise<T>, identity?: AuthActor): Promise<T> {
    const actor = identity ? authActor(identity) : undefined;
    const staffRoles = ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'PHARMACIST'];
    if (!['public', 'customer', 'staff', 'moderator', 'helpful'].includes(scope)
      || (scope === 'customer' && (actor?.type !== 'customer' || actor.role !== 'CUSTOMER'))
      || (scope === 'staff' && (actor?.type !== 'employee' || !staffRoles.includes(actor.role)))
      || (scope === 'moderator' && (actor?.type !== 'employee' || !['SUPER_ADMIN', 'ADMIN'].includes(actor.role)))
      || (['public', 'helpful'].includes(scope) && actor)) {
      throw new ForbiddenException('Invalid review access scope');
    }
    return this.$transaction(async (tx) => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT runtime.rolsuper AND NOT runtime.rolbypassrls
          AND (SELECT count(*) = 3 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
              AND c.relowner <> runtime.oid)
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname IN ('reviews', 'moderation_reports', 'moderation_audit_logs')) AS ready
        FROM pg_roles runtime WHERE runtime.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Review RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.review_scope', ${scope}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      return operation(tx);
    });
  }

  async prepareVoucher(tx: Prisma.TransactionClient, scope: VoucherScope | 'checkout', code = '', orderId?: number): Promise<void> {
    const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
      SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
        AND c.relowner <> r.oid AS ready
      FROM pg_roles r JOIN pg_class c ON c.relname = 'vouchers'
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
    `;
    if (!state?.ready) throw new ServiceUnavailableException('Voucher RLS setup is not ready');
    await tx.$queryRaw`SELECT set_config('app.voucher_scope', ${scope}, true)`;
    await tx.$queryRaw`SELECT set_config('app.voucher_code', ${code.trim().toUpperCase()}, true)`;
    await tx.$queryRaw`SELECT set_config('app.voucher_order_id', ${orderId ? String(orderId) : ''}, true)`;
  }

  async withCustomerManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'].includes(actor.role)) throw new ForbiddenException('Invalid customer management scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
          AND c.relowner <> r.oid AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'customers'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Customer RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.customer_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.order_operation', ${'read'}, true)`;
      return run(tx);
    });
  }

  async withCatalogManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !['SUPER_ADMIN', 'STORE_MANAGER'].includes(actor.role)) throw new ForbiddenException('Invalid catalog management scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid) AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = ANY(ARRAY['medicines','categories','medicine_categories','packaging_variants'])
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
        GROUP BY r.rolsuper, r.rolbypassrls, r.oid HAVING count(*) = 4
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Catalog RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.catalog_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      return run(tx);
    });
  }


  async withEmployeeManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || !['SUPER_ADMIN', 'STORE_MANAGER'].includes(actor.role)) throw new ForbiddenException('Invalid employee management scope');
    if (actor.role === 'STORE_MANAGER' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) throw new ForbiddenException('Staff account is not assigned to a facility');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
          AND c.relowner <> r.oid AND EXISTS (SELECT FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='employee_facility_management') AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'employees'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Employee RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.employee_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  async withFacilityManagement<T>(identity: AuthActor, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const actor = authActor(identity);
    if (actor.type !== 'employee' || actor.role !== 'SUPER_ADMIN') throw new ForbiddenException('Invalid facility management scope');
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND c.relrowsecurity AND c.relforcerowsecurity
          AND c.relowner <> r.oid AS ready
        FROM pg_roles r JOIN pg_class c ON c.relname = 'facilities'
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public' WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Facility RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.facility_operation', ${'manage'}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      return run(tx);
    });
  }

  async withVoucher<T>(scope: VoucherScope, run: (tx: Prisma.TransactionClient) => Promise<T>, context: { actor?: AuthActor; code?: string } = {}): Promise<T> {
    const actor = context.actor ? authActor(context.actor) : undefined;
    const roles = scope === 'read' ? ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'] : ['SUPER_ADMIN'];
    if (!['validate', 'read', 'manage'].includes(scope)
      || (scope === 'validate' ? !!actor || !context.code?.trim() : actor?.type !== 'employee' || !roles.includes(actor.role))) {
      throw new ForbiddenException('Invalid voucher access scope');
    }
    return this.$transaction(async tx => {
      await this.prepareVoucher(tx, scope, context.code);
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    });
  }

  async withOrder<T>(operation: OrderOperation, run: (tx: Prisma.TransactionClient) => Promise<T>, identity?: AuthActor): Promise<T> {
    const actor = identity ? authActor(identity) : undefined;
    const roles: Record<OrderOperation, string[]> = {
      read: ['CUSTOMER', 'SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF'],
      checkout: ['CUSTOMER'], cancel: ['CUSTOMER'], customer_receive: ['CUSTOMER'],
      status: ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST'],
      pack: ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF'],
      transfer_read: ['SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF'],
      dispatch: ['SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF'],
      receive: ['SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF'],
      replace: ['SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF'],
      prescription: ['SUPER_ADMIN', 'PHARMACIST'], loyalty: [],
    };
    if (!roles[operation] || (operation === 'loyalty' ? !!actor : !actor || !roles[operation].includes(actor.role))) {
      throw new ForbiddenException('Invalid order access scope');
    }
    if (actor?.type === 'employee' && actor.role !== 'SUPER_ADMIN' && (!Number.isInteger(actor.facilityId) || Number(actor.facilityId) <= 0)) {
      throw new ForbiddenException('Staff account is not assigned to a facility.');
    }
    return this.$transaction(async tx => {
      const [state] = await tx.$queryRaw<{ ready: boolean }[]>`
        SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND
          (SELECT count(*) = 5 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity AND c.relowner <> r.oid)
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname IN ('orders', 'order_items', 'shipments', 'internal_transfers', 'loyalty_point_logs')) AS ready
        FROM pg_roles r WHERE r.rolname = current_user
      `;
      if (!state?.ready) throw new ServiceUnavailableException('Order RLS setup is not ready');
      await tx.$queryRaw`SELECT set_config('app.order_operation', ${operation}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${actor ? String(actor.id) : ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor?.type || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor?.role || ''}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor?.facilityId ? String(actor.facilityId) : ''}, true)`;
      return run(tx);
    }, { timeout: 15000 });
  }

  async withActor<T>(
    actor: { id: number; role: string; type: 'customer' | 'employee'; facilityId?: number | null },
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      const [role] = await tx.$queryRaw<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
        SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      `;
      if (!role || role.rolsuper || role.rolbypassrls) {
        throw new ServiceUnavailableException('Actor access requires an RLS-enabled database role');
      }
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return operation(tx);
    });
  }
}
