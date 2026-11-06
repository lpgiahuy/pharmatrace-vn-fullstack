import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { WishlistModule } from '../src/modules/wishlist/wishlist.module';
import { PrismaService } from '../src/prisma/prisma.service';

const integration = process.env.WISHLIST_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Wishlist HTTP + Prisma + PostgreSQL RLS', () => {
  const a = 900001;
  const b = 900002;
  const password = 'WishlistTestOnly2026!';
  let app: INestApplication;
  let owner: Pool;
  let prisma: PrismaService;
  let baseUrl: string;
  let medicines: { id: number; medicine_name: string }[];
  let tokens: { a: string; b: string; employee: string };
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };

  async function api(method: string, path: string, status: number, token?: string, body?: unknown) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(status);
    return await response.json();
  }

  async function cleanup() {
    await owner.query("DELETE FROM public.employees WHERE id = $1 AND email = 'wishlist-staff@example.test'", [a]);
    await owner.query("DELETE FROM public.customers WHERE id = ANY($1::int[]) AND email IN ('wishlist-a@example.test', 'wishlist-b@example.test')", [[a, b]]);
  }

  beforeAll(async () => {
    const runtimeUrl = process.env.WISHLIST_RLS_TEST_DATABASE_URL!;
    const ownerUrl = process.env.WISHLIST_RLS_TEST_ADMIN_URL!;
    for (const value of [runtimeUrl, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_wishlist_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('Wishlist tests require the disposable localhost pharmatrace_wishlist_rls_test database');
      }
    }
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AUTH_RLS_ENABLED = process.env.WISHLIST_RLS_TEST_AUTH_ENABLED === 'true' ? 'true' : 'false';
    process.env.JWT_SECRET = 'isolated-wishlist-test-secret-not-for-deployment';
    owner = new Pool({ connectionString: ownerUrl });
    await cleanup();
    const hash = await bcrypt.hash(password, 10);
    await owner.query(`INSERT INTO public.customers (id, full_name, email, phone_number, password_hash, status)
      VALUES ($1, 'Demo Wishlist A', 'wishlist-a@example.test', '0988880001', $3, 'ACTIVE'),
             ($2, 'Demo Wishlist B', 'wishlist-b@example.test', '0988880002', $3, 'ACTIVE')`, [a, b, hash]);
    await owner.query(`INSERT INTO public.employees (id, full_name, email, password_hash, role, status, facility_id)
      VALUES ($1, 'Demo Wishlist Employee', 'wishlist-staff@example.test', $2, 'PHARMACIST', 'ACTIVE', 1)`, [a, hash]);
    medicines = (await owner.query(`SELECT m.id, m.medicine_name FROM public.medicines m
      WHERE m.status = 'ACTIVE' AND EXISTS (SELECT FROM public.packaging_variants v WHERE v.medicine_id = m.id)
      ORDER BY m.id LIMIT 2`)).rows;
    expect(medicines).toHaveLength(2);
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule, WishlistModule],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    tokens = {
      a: (await api('POST', '/auth/login', 200, undefined, { identifier: '0988880001', password })).data.accessToken,
      b: (await api('POST', '/auth/login', 200, undefined, { identifier: '0988880002', password })).data.accessToken,
      employee: (await api('POST', '/admin/auth/login', 200, undefined, { email: 'wishlist-staff@example.test', password })).data.accessToken,
    };
  }, 30000);

  beforeEach(async () => {
    await owner.query('DELETE FROM public.customer_wishlists WHERE customer_id = ANY($1::int[])', [[a, b]]);
  });

  afterAll(async () => {
    if (app) await app.close();
    if (owner) { await cleanup(); await owner.end(); }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('rejects anonymous and same-ID employee requests on all wishlist operations', async () => {
    await api('GET', '/customer/wishlist', 401);
    for (const [method, path, body] of [
      ['GET', '/customer/wishlist', undefined],
      ['GET', `/customer/wishlist/check/${medicines[0].id}`, undefined],
      ['POST', '/customer/wishlist/check-batch', { productIds: [medicines[0].id] }],
      ['POST', `/customer/wishlist/${medicines[0].id}`, undefined],
      ['DELETE', `/customer/wishlist/${medicines[0].id}`, undefined],
    ] as const) await api(method, path, 403, tokens.employee, body);
  });

  it('lists only the customer wishlist and retains medicine/packaging relations', async () => {
    await api('POST', `/customer/wishlist/${medicines[0].id}`, 201, tokens.a);
    await api('POST', `/customer/wishlist/${medicines[1].id}`, 201, tokens.b);
    const result = await api('GET', '/customer/wishlist', 200, tokens.a);
    expect(result.pagination.total).toBe(1);
    expect(result.data.map((item: any) => item.id)).toEqual([medicines[0].id]);
    expect(result.data[0].medicineName).toBe(medicines[0].medicine_name);
    expect(result.data[0].packagingOptions.length).toBeGreaterThan(0);
    expect(result.data[0].variantId).not.toBeNull();
  });

  it('keeps pagination and search counts within the customer scope', async () => {
    for (const medicine of medicines) await api('POST', `/customer/wishlist/${medicine.id}`, 201, tokens.a);
    const page = await api('GET', '/customer/wishlist?limit=1&page=1&sort=price_asc', 200, tokens.a);
    expect(page.pagination).toMatchObject({ total: 2, totalPages: 2 });
    expect(page.data).toHaveLength(1);
    const empty = await api('GET', '/customer/wishlist?search=wishlist-no-matching-product', 200, tokens.a);
    expect(empty.pagination.total).toBe(0);
    expect((await api('GET', '/customer/wishlist', 200, tokens.b)).pagination.total).toBe(0);
  });

  it('scopes single/batch checks and deduplicates requested product IDs', async () => {
    await api('POST', `/customer/wishlist/${medicines[0].id}`, 201, tokens.a);
    await api('POST', `/customer/wishlist/${medicines[1].id}`, 201, tokens.b);
    expect((await api('GET', `/customer/wishlist/check/${medicines[1].id}`, 200, tokens.a)).data.isWishlisted).toBe(false);
    const batch = await api('POST', '/customer/wishlist/check-batch', 200, tokens.a,
      { productIds: [medicines[0].id, medicines[0].id, medicines[1].id, 2147483647] });
    expect(batch.data.wishlistedProductIds).toEqual([medicines[0].id]);
  });

  it('allows concurrent duplicate adds without UPDATE privileges', async () => {
    await Promise.all([1, 2, 3].map(() => api('POST', `/customer/wishlist/${medicines[0].id}`, 201, tokens.a)));
    expect((await api('GET', '/customer/wishlist', 200, tokens.a)).pagination.total).toBe(1);
  });

  it('deletes only own rows and remains idempotent for absent rows', async () => {
    for (const token of [tokens.a, tokens.b]) await api('POST', `/customer/wishlist/${medicines[0].id}`, 201, token);
    await api('DELETE', `/customer/wishlist/${medicines[0].id}`, 200, tokens.a);
    await api('DELETE', `/customer/wishlist/${medicines[0].id}`, 200, tokens.a);
    expect((await api('GET', `/customer/wishlist/check/${medicines[0].id}`, 200, tokens.a)).data.isWishlisted).toBe(false);
    expect((await api('GET', `/customer/wishlist/check/${medicines[0].id}`, 200, tokens.b)).data.isWishlisted).toBe(true);
  });

  it('returns 404 for nonexistent medicine and does not create a row', async () => {
    await api('POST', '/customer/wishlist/2147483647', 404, tokens.a);
    expect((await api('GET', '/customer/wishlist', 200, tokens.a)).pagination.total).toBe(0);
  });

  it('enforces row and write restrictions even without application WHERE filters', async () => {
    await api('POST', `/customer/wishlist/${medicines[0].id}`, 201, tokens.a);
    await api('POST', `/customer/wishlist/${medicines[1].id}`, 201, tokens.b);
    const actor = { id: a, type: 'customer' as const, role: 'CUSTOMER' };
    const rows = await prisma.withActor(actor, (tx) => tx.customer_wishlists.findMany());
    expect(rows.map((row) => row.customer_id)).toEqual([a]);
    expect((await prisma.withActor(actor, (tx) => tx.customer_wishlists.deleteMany({ where: { customer_id: b } }))).count).toBe(0);
    await expect(prisma.withActor(actor, (tx) => tx.customer_wishlists.create({ data: { customer_id: b, medicine_id: medicines[0].id } }))).rejects.toThrow();
    await expect(prisma.withActor(actor, (tx) => tx.customer_wishlists.updateMany({ data: { customer_id: b } }))).rejects.toThrow();
    await expect(prisma.withActor(actor, (tx) => tx.$executeRaw`TRUNCATE public.customer_wishlists`)).rejects.toThrow();
    expect(await prisma.customer_wishlists.findMany()).toHaveLength(0);
  });

  it('does not carry an actor into the next transaction after rollback', async () => {
    await api('POST', `/customer/wishlist/${medicines[0].id}`, 201, tokens.a);
    await expect(prisma.withActor({ id: a, type: 'customer', role: 'CUSTOMER' }, () => Promise.reject(new Error('intentional wishlist rollback')))).rejects.toThrow('intentional wishlist rollback');
    expect(await prisma.customer_wishlists.count()).toBe(0);
    expect(await prisma.withActor({ id: b, type: 'customer', role: 'CUSTOMER' }, (tx) => tx.customer_wishlists.count())).toBe(0);
  });
});
