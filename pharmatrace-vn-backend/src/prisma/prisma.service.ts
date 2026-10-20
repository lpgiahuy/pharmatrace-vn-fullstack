import { Injectable, OnModuleInit, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required');
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
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
        throw new ServiceUnavailableException('Prescription access requires an RLS-enabled database role');
      }
      await tx.$queryRaw`SELECT set_config('app.current_user_id', ${String(actor.id)}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_role', ${actor.role}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_user_type', ${actor.type}, true)`;
      await tx.$queryRaw`SELECT set_config('app.current_unit_id', ${actor.facilityId ? String(actor.facilityId) : ''}, true)`;
      return operation(tx);
    });
  }
}
