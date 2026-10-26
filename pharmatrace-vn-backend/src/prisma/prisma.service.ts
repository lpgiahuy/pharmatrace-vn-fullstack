import { Injectable, OnModuleInit, OnModuleDestroy, ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { AuthActor, authActor } from '../common/auth-identity';

export type ReviewScope = 'public' | 'customer' | 'staff' | 'moderator' | 'helpful';

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
    const staffRoles = ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'SALES_STAFF', 'PHARMACIST'];
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
