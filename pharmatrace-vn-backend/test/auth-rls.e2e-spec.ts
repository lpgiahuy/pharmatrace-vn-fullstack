import { Controller, Get, INestApplication, UseGuards, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AddressInfo } from 'node:net';
import { AuthModule } from '../src/modules/auth/auth.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { CustomerGuard } from '../src/common/guards/customer.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Roles } from '../src/common/decorators/roles.decorator';

@Controller('probe')
class BoundaryController {
  @Get('customer')
  @UseGuards(JwtAuthGuard, CustomerGuard)
  customer() { return { ok: true }; }

  @Get('super-admin')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  superAdmin() { return { ok: true }; }
}

const integration = process.env.AUTH_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Auth HTTP + Prisma + PostgreSQL RLS', () => {
  const id = 800001;
  const otherId = 800002;
  const password = 'AuthRlsTestOnly2026!';
  let app: INestApplication;
  let prisma: PrismaService;
  let owner: Pool;
  let hash: string;
  let baseUrl: string;
  const previous = { database: process.env.DATABASE_URL, enabled: process.env.AUTH_RLS_ENABLED, secret: process.env.JWT_SECRET };

  beforeAll(async () => {
    const runtimeUrl = process.env.AUTH_RLS_TEST_DATABASE_URL!;
    const ownerUrl = process.env.AUTH_RLS_TEST_ADMIN_URL!;
    for (const value of [runtimeUrl, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_auth_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('Auth integration tests require the disposable localhost pharmatrace_auth_rls_test database');
      }
    }
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AUTH_RLS_ENABLED = 'true';
    process.env.JWT_SECRET = 'isolated-auth-rls-test-secret-not-for-deployment';
    owner = new Pool({ connectionString: ownerUrl });
    await owner.query("DELETE FROM public.employees WHERE id = $1 AND email = 'auth-staff@example.test'", [id]);
    await owner.query("DELETE FROM public.customers WHERE email IN ('auth-a@example.test', 'auth-b@example.test', 'auth-new@example.test')");
    hash = await bcrypt.hash(password, 10);
    await owner.query(`INSERT INTO public.customers
      (id, full_name, email, phone_number, password_hash, status)
      VALUES ($1, 'Demo Auth Customer A', 'auth-a@example.test', '0977770001', $3, 'ACTIVE'),
             ($2, 'Demo Auth Customer B', 'auth-b@example.test', '0977770002', $3, 'ACTIVE')`, [id, otherId, hash]);
    await owner.query(`INSERT INTO public.employees
      (id, full_name, email, password_hash, role, status, facility_id)
      VALUES ($1, 'Demo Auth Employee A', 'auth-staff@example.test', $2, 'ADMIN', 'ACTIVE', 1)`, [id, hash]);
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule],
      controllers: [BoundaryController],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
  }, 30000);

  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      await owner.query("DELETE FROM public.employees WHERE id = $1 AND email = 'auth-staff@example.test'", [id]);
      await owner.query("DELETE FROM public.customers WHERE email IN ('auth-a@example.test', 'auth-b@example.test', 'auth-new@example.test')");
      await owner.end();
    }
    for (const [key, value] of Object.entries({ DATABASE_URL: previous.database, AUTH_RLS_ENABLED: previous.enabled, JWT_SECRET: previous.secret })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  function request(_server: unknown) {
    const make = (method: string) => (path: string) => {
      let payload: unknown;
      let token: string | undefined;
      const call = {
        send(value: unknown) { payload = value; return call; },
        auth(value: string, _options: { type: string }) { token = value; return call; },
        async expect(status: number) {
          const response = await fetch(baseUrl + path, {
            method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
          });
          expect(response.status).toBe(status);
          return { body: await response.json() };
        },
      };
      return call;
    };
    return { get: make('GET'), post: make('POST'), patch: make('PATCH') };
  }

  async function customerToken() {
    const result = await request(app.getHttpServer()).post('/auth/login')
      .send({ identifier: '0977770001', password }).expect(200);
    expect(result.body.data.user.password_hash).toBeUndefined();
    return result.body.data.accessToken as string;
  }
  async function staffToken() {
    const result = await request(app.getHttpServer()).post('/admin/auth/login')
      .send({ email: 'auth-staff@example.test', password }).expect(200);
    expect(result.body.data.user.password_hash).toBeUndefined();
    return result.body.data.accessToken as string;
  }

  it('registers a customer with defaults and rejects duplicate/privileged registration', async () => {
    const data = { name: 'Demo New Customer', phone: '0977770003', email: 'auth-new@example.test', password };
    const result = await request(app.getHttpServer()).post('/auth/register').send(data).expect(201);
    expect(result.body.data.user).toMatchObject({ role: 'CUSTOMER', membershipTier: 'BRONZE', rewardPoints: 0 });
    expect(result.body.data.user.password_hash).toBeUndefined();
    await request(app.getHttpServer()).post('/auth/register').send(data).expect(409);
    await request(app.getHttpServer()).post('/auth/register').send({ ...data, role: 'SUPER_ADMIN' }).expect(400);
  });

  it('returns the correct account when customer and employee IDs coincide', async () => {
    const customer = await request(app.getHttpServer()).get('/auth/me').auth(await customerToken(), { type: 'bearer' }).expect(200);
    const employee = await request(app.getHttpServer()).get('/auth/me').auth(await staffToken(), { type: 'bearer' }).expect(200);
    expect(customer.body.data).toMatchObject({ id, fullName: 'Demo Auth Customer A', role: 'CUSTOMER' });
    expect(employee.body.data).toMatchObject({ id, fullName: 'Demo Auth Employee A', role: 'ADMIN' });
  });

  it('does not let ADMIN cross a super-admin boundary or impersonate a customer', async () => {
    const token = await staffToken();
    await request(app.getHttpServer()).get('/probe/super-admin').auth(token, { type: 'bearer' }).expect(403);
    await request(app.getHttpServer()).get('/probe/customer').auth(token, { type: 'bearer' }).expect(403);
    await request(app.getHttpServer()).get('/auth/loyalty-progress').auth(token, { type: 'bearer' }).expect(403);
  });

  it('updates the employee profile without touching the same-ID customer', async () => {
    const token = await staffToken();
    await request(app.getHttpServer()).patch('/auth/me').auth(token, { type: 'bearer' })
      .send({ fullName: 'Demo Employee Updated' }).expect(200);
    const result = await owner.query('SELECT full_name FROM public.customers WHERE id = $1', [id]);
    expect(result.rows[0].full_name).toBe('Demo Auth Customer A');
    await request(app.getHttpServer()).patch('/auth/me').auth(token, { type: 'bearer' })
      .send({ role: 'SUPER_ADMIN' }).expect(400);
  });

  it('changes passwords on the correct account type only', async () => {
    const token = await staffToken();
    await request(app.getHttpServer()).patch('/auth/me/change-password').auth(token, { type: 'bearer' })
      .send({ currentPassword: password, newPassword: 'ChangedAuthTest2026!' }).expect(200);
    const result = await owner.query('SELECT password_hash FROM public.customers WHERE id = $1', [id]);
    expect(await bcrypt.compare(password, result.rows[0].password_hash)).toBe(true);
    await request(app.getHttpServer()).post('/admin/auth/login').send({ email: 'auth-staff@example.test', password }).expect(401);
    await owner.query('UPDATE public.employees SET password_hash = $1 WHERE id = $2', [hash, id]);
  });

  it('rejects an unexpired token after a customer is locked', async () => {
    const token = await customerToken();
    try {
      await owner.query("UPDATE public.customers SET status = 'INACTIVE' WHERE id = $1", [id]);
      await request(app.getHttpServer()).get('/auth/me').auth(token, { type: 'bearer' }).expect(401);
    } finally {
      await owner.query("UPDATE public.customers SET status = 'ACTIVE' WHERE id = $1", [id]);
    }
  });

  it('keeps concurrent customer requests isolated', async () => {
    const a = await customerToken();
    const login = await request(app.getHttpServer()).post('/auth/login')
      .send({ identifier: '0977770002', password }).expect(200);
    const tokens = [a, login.body.data.accessToken];
    await Promise.all(Array.from({ length: 6 }, async (_, index) => {
      const result = await request(app.getHttpServer()).get('/auth/me')
        .auth(tokens[index % 2], { type: 'bearer' }).expect(200);
      expect(result.body.data.id).toBe(index % 2 === 0 ? id : otherId);
    }));
  });

  it('rejects stale employee claims and permits warehouse login with a canonical role', async () => {
    const token = await staffToken();
    try {
      await owner.query("UPDATE public.employees SET role = 'WAREHOUSE_MANAGER', facility_id = 2001 WHERE id = $1", [id]);
      await request(app.getHttpServer()).get('/auth/me').auth(token, { type: 'bearer' }).expect(401);
      const login = await request(app.getHttpServer()).post('/warehouse/auth/login')
        .send({ email: 'auth-staff@example.test', password }).expect(200);
      expect(login.body.data.user.role).toBe('WAREHOUSE_MANAGER');
    } finally {
      await owner.query("UPDATE public.employees SET role = 'ADMIN', facility_id = 1 WHERE id = $1", [id]);
    }
  });

  it('rejects tokens without an account type and disables public admin setup', async () => {
    const token = app.get(JwtService).sign({ id, sub: id, role: 'CUSTOMER' });
    await request(app.getHttpServer()).get('/auth/me').auth(token, { type: 'bearer' }).expect(401);
    await request(app.getHttpServer()).post('/admin/auth/setup')
      .send({ fullName: 'Demo Intruder', email: 'intruder@example.test', password, facilityId: 1 }).expect(410);
  });

  it('updates and clears the customer delivery address in the profile', async () => {
    const token = await customerToken();
    await request(app.getHttpServer()).patch('/auth/me').auth(token, { type: 'bearer' }).send({ defaultAddress: 'Test delivery address' }).expect(200);
    const updated = await request(app.getHttpServer()).patch('/auth/me').auth(token, { type: 'bearer' }).send({ defaultAddress: '' }).expect(200);
    expect(updated.body.data.defaultAddress).toBeNull();
  });

  it('enforces row and column restrictions against direct Prisma queries', async () => {
    const actor = { id, role: 'CUSTOMER', type: 'customer' as const };
    expect(await prisma.withAuth((tx) => tx.customers.findMany(), { actor })).toHaveLength(1);
    expect(await prisma.withAuth((tx) => tx.employees.findMany(), { actor })).toHaveLength(0);
    expect((await prisma.withAuth((tx) => tx.customers.updateMany({ where: { id: otherId }, data: { full_name: 'Denied' } }), { actor })).count).toBe(0);
    await expect(prisma.withAuth((tx) => tx.customers.update({ where: { id }, data: { reward_points: 999999 } }), { actor })).rejects.toThrow();
    await expect(prisma.withAuth((tx) => tx.employees.updateMany({ data: { role: 'SUPER_ADMIN' } }),
      { actor: { id, role: 'ADMIN', type: 'employee', facilityId: 1 } })).rejects.toThrow();
  });

  it('scopes credential lookup and clears role/context after success and rollback', async () => {
    expect(await prisma.withAuth((tx) => tx.customers.findMany(),
      { operation: 'customer_login', identifier: '0977770001' })).toHaveLength(1);
    await expect(prisma.withAuth(() => Promise.reject(new Error('intentional rollback')),
      { actor: { id, role: 'CUSTOMER', type: 'customer' } })).rejects.toThrow('intentional rollback');
    expect(await prisma.withAuth((tx) => tx.customers.findMany())).toHaveLength(0);
    expect(await prisma.withAuth((tx) => tx.employees.findMany())).toHaveLength(0);
    const rows = await prisma.$queryRaw<{ role: string }[]>`SELECT current_user AS role`;
    expect(rows[0].role).toBe('app_user');
  });

  it('fails closed when the flag is enabled but account RLS is incomplete', async () => {
    try {
      await owner.query('ALTER TABLE public.customers NO FORCE ROW LEVEL SECURITY');
      await request(app.getHttpServer()).post('/auth/login').send({ identifier: '0977770001', password }).expect(503);
    } finally {
      await owner.query('ALTER TABLE public.customers FORCE ROW LEVEL SECURITY');
    }
  });
});
