import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { CartModule } from '../src/modules/cart/cart.module';
import { OrderService } from '../src/modules/order/order.service';
import { PrismaService } from '../src/prisma/prisma.service';

const integration = process.env.CART_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Cart HTTP + Prisma + PostgreSQL RLS', () => {
  const a = 920001;
  const b = 920002;
  const password = 'CartTestOnly2026!';
  const accountRls = process.env.CART_RLS_TEST_AUTH_ENABLED === 'true';
  let app: INestApplication;
  let owner: Pool;
  let prisma: PrismaService;
  let baseUrl: string;
  let facility: number;
  const medicines: number[] = [];
  const variants: number[] = [];
  let tokens: { a: string; b: string; employee: string };
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };

  async function api(method: string, path: string, status: number, token?: string, body?: unknown) {
    const response = await fetch(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(status);
    return await response.json() as any;
  }
  async function cleanupAccounts() {
    await owner.query('DELETE FROM public.orders WHERE customer_id = ANY($1::int[])', [[a, b]]);
    await owner.query("DELETE FROM public.employees WHERE id = $1 AND email = 'cart-staff@example.test'", [a]);
    await owner.query("DELETE FROM public.customers WHERE id = ANY($1::int[]) AND email IN ('cart-a@example.test', 'cart-b@example.test')", [[a, b]]);
  }
  const actor = (id: number) => ({ id, role: 'CUSTOMER', type: 'customer' as const });

  beforeAll(async () => {
    const runtimeUrl = process.env.CART_RLS_TEST_DATABASE_URL!;
    const ownerUrl = process.env.CART_RLS_TEST_ADMIN_URL!;
    for (const value of [runtimeUrl, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_cart_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('Cart tests require the disposable localhost pharmatrace_cart_rls_test database');
      }
    }
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AUTH_RLS_ENABLED = accountRls ? 'true' : 'false';
    process.env.JWT_SECRET = 'isolated-cart-test-secret-not-for-deployment';
    owner = new Pool({ connectionString: ownerUrl });
    await cleanupAccounts();
    const hash = await bcrypt.hash(password, 10);
    await owner.query(`INSERT INTO public.customers (id, full_name, email, phone_number, password_hash, status)
      VALUES ($1, 'Demo Cart A', 'cart-a@example.test', '0966660001', $3, 'ACTIVE'),
             ($2, 'Demo Cart B', 'cart-b@example.test', '0966660002', $3, 'ACTIVE')`, [a, b, hash]);
    facility = (await owner.query(`INSERT INTO public.facilities (facility_name, facility_type, latitude, longitude)
      VALUES ('Demo Cart Test Facility', 'PHARMACY', 10.77, 106.70) RETURNING id`)).rows[0].id;
    await owner.query(`INSERT INTO public.employees (id, full_name, email, password_hash, role, status, facility_id)
      VALUES ($1, 'Demo Cart Employee', 'cart-staff@example.test', $2, 'PHARMACIST', 'ACTIVE', $3)`, [a, hash, facility]);
    for (const status of ['ACTIVE', 'INACTIVE']) {
      medicines.push((await owner.query(`INSERT INTO public.medicines (medicine_name, unit_price, status, is_prescription)
        VALUES ('Demo Cart Test Medicine', 10, $1, false) RETURNING id`, [status])).rows[0].id);
    }
    for (let index = 0; index < 4; index++) {
      const medicine = index === 3 ? medicines[1] : medicines[0];
      variants.push((await owner.query(`INSERT INTO public.packaging_variants (medicine_id, unit_name, price, is_base_unit)
        VALUES ($1, $2, $3, $4) RETURNING id`, [medicine, `Strip ${index}`, (index + 1) * 10, index === 0])).rows[0].id);
      await owner.query(`INSERT INTO public.inventories (facility_id, medicine_id, variant_id, stock_quantity, reserved_quantity)
        VALUES ($1, $2, $3, $4, $5)`, [facility, medicine, variants[index], index === 2 ? 0 : index === 1 ? 5 : 20, index === 1 ? 2 : 0]);
    }
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule, CartModule],
      providers: [OrderService],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    tokens = {
      a: (await api('POST', '/auth/login', 200, undefined, { identifier: '0966660001', password })).data.accessToken,
      b: (await api('POST', '/auth/login', 200, undefined, { identifier: '0966660002', password })).data.accessToken,
      employee: (await api('POST', '/admin/auth/login', 200, undefined, { email: 'cart-staff@example.test', password })).data.accessToken,
    };
  }, 30000);

  beforeEach(async () => {
    await owner.query('DELETE FROM public.cart_items WHERE customer_id = ANY($1::int[])', [[a, b]]);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      await cleanupAccounts();
      await owner.query('DELETE FROM public.medicines WHERE id = ANY($1::int[])', [medicines]);
      if (facility) await owner.query('DELETE FROM public.facilities WHERE id = $1', [facility]);
      await owner.end();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  const add = (token: string, index: number, quantity: number) => api('POST', '/customer/cart', 201, token, { variantId: variants[index], quantity });

  it('rejects anonymous and same-ID employees on all cart operations', async () => {
    await api('GET', '/customer/cart', 401);
    for (const [method, path, body] of [
      ['GET', '/customer/cart', undefined], ['POST', '/customer/cart', { variantId: variants[0], quantity: 1 }],
      ['POST', '/customer/cart/sync', { items: [] }],
      ['PATCH', '/customer/cart/switch-variant', { oldVariantId: variants[0], newVariantId: variants[1] }],
      ['PATCH', `/customer/cart/${variants[0]}`, { quantity: 2 }],
      ['DELETE', `/customer/cart/${variants[0]}`, undefined], ['DELETE', '/customer/cart', undefined],
    ] as const) await api(method, path, 403, tokens.employee, body);
  });

  it('returns only own cart with prices, totals and packaging relations', async () => {
    await add(tokens.a, 0, 2);
    await add(tokens.b, 0, 7);
    const result = (await api('GET', '/customer/cart', 200, tokens.a)).data;
    expect(result).toMatchObject({ totalItems: 2, subtotal: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ variantId: variants[0], price: 10, quantity: 2 });
    expect(result.items[0].packagingOptions).toHaveLength(3);
  });

  it('increments then updates/removes own quantity without affecting another cart', async () => {
    await add(tokens.a, 0, 2);
    expect((await add(tokens.a, 0, 3)).data.items[0].quantity).toBe(5);
    await add(tokens.b, 0, 7);
    await api('PATCH', `/customer/cart/${variants[0]}`, 200, tokens.a, { quantity: 4 });
    await api('PATCH', `/customer/cart/${variants[0]}`, 200, tokens.a, { quantity: 0 });
    expect((await api('GET', '/customer/cart', 200, tokens.a)).data.items).toEqual([]);
    expect((await api('GET', '/customer/cart', 200, tokens.b)).data.items[0].quantity).toBe(7);
  });

  it('syncs maximum quantities, ignores missing/inactive variants and handles an empty sync', async () => {
    await add(tokens.a, 0, 3);
    await add(tokens.b, 0, 7);
    const result = (await api('POST', '/customer/cart/sync', 200, tokens.a, { items: [
      { variantId: variants[0], quantity: 2 }, { variantId: variants[0], quantity: 5 },
      { variantId: variants[1], quantity: 1 }, { variantId: variants[3], quantity: 1 },
      { variantId: 2147483647, quantity: 1 },
    ] })).data;
    expect(result.totalItems).toBe(6);
    expect(result.items.find((item: any) => item.variantId === variants[0]).quantity).toBe(5);
    expect((await api('POST', '/customer/cart/sync', 200, tokens.a, { items: [] })).data.totalItems).toBe(6);
    expect((await api('GET', '/customer/cart', 200, tokens.b)).data.totalItems).toBe(7);
  });

  it('switches to another packaging variant using live available stock', async () => {
    await add(tokens.a, 0, 8);
    await add(tokens.b, 0, 7);
    const result = (await api('PATCH', '/customer/cart/switch-variant', 200, tokens.a,
      { oldVariantId: variants[0], newVariantId: variants[1] })).data;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ variantId: variants[1], quantity: 3 });
    expect((await api('GET', '/customer/cart', 200, tokens.b)).data.items[0].variantId).toBe(variants[0]);
  });

  it('merges variants within own cart and caps the merged quantity to stock', async () => {
    await add(tokens.a, 0, 8);
    await add(tokens.a, 1, 2);
    const result = (await api('PATCH', '/customer/cart/switch-variant', 200, tokens.a,
      { oldVariantId: variants[0], newVariantId: variants[1] })).data;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ variantId: variants[1], quantity: 3 });
  });

  it('rejects out-of-stock and different-medicine switches without changing the cart', async () => {
    await add(tokens.a, 0, 8);
    for (const next of [variants[2], variants[3]]) {
      await api('PATCH', '/customer/cart/switch-variant', 400, tokens.a, { oldVariantId: variants[0], newVariantId: next });
    }
    expect((await api('GET', '/customer/cart', 200, tokens.a)).data.items[0]).toMatchObject({ variantId: variants[0], quantity: 8 });
  });

  it('removes/clears only own rows and is idempotent', async () => {
    await add(tokens.a, 0, 2); await add(tokens.a, 1, 1); await add(tokens.b, 0, 7);
    await api('DELETE', `/customer/cart/${variants[0]}`, 200, tokens.a);
    await api('DELETE', `/customer/cart/${variants[0]}`, 200, tokens.a);
    expect((await api('DELETE', '/customer/cart', 200, tokens.a)).data).toMatchObject({ items: [], totalItems: 0, subtotal: 0 });
    expect((await api('GET', '/customer/cart', 200, tokens.b)).data.totalItems).toBe(7);
  });

  it('rejects invalid quantities, inactive products, missing variants and cross-customer updates', async () => {
    await add(tokens.b, 0, 1);
    await api('PATCH', `/customer/cart/${variants[0]}`, 404, tokens.a, { quantity: 2 });
    await api('POST', '/customer/cart', 404, tokens.a, { variantId: 2147483647, quantity: 1 });
    await api('POST', '/customer/cart', 400, tokens.a, { variantId: variants[3], quantity: 1 });
    await api('POST', '/customer/cart', 400, tokens.a, { variantId: variants[0], quantity: 1000 });
    await api('POST', '/customer/cart', 400, tokens.a, { variantId: variants[0], quantity: 1, customerId: b });
    expect((await api('GET', '/customer/cart', 200, tokens.a)).data.items).toEqual([]);
  });

  it('enforces ownership and column privileges even without application filters', async () => {
    await add(tokens.a, 0, 1); await add(tokens.b, 0, 7);
    expect((await prisma.withActor(actor(a), tx => tx.cart_items.findMany())).map(row => row.customer_id)).toEqual([a]);
    expect((await prisma.withActor(actor(a), tx => tx.cart_items.updateMany({ where: { customer_id: b }, data: { quantity: 99 } }))).count).toBe(0);
    expect((await prisma.withActor(actor(a), tx => tx.cart_items.deleteMany({ where: { customer_id: b } }))).count).toBe(0);
    await expect(prisma.withActor(actor(a), tx => tx.cart_items.create({ data: { customer_id: b, variant_id: variants[1], quantity: 1 } }))).rejects.toThrow();
    await expect(prisma.withActor(actor(a), tx => tx.cart_items.updateMany({ data: { customer_id: b } }))).rejects.toThrow();
    await expect(prisma.withActor(actor(a), tx => tx.$executeRaw`TRUNCATE public.cart_items`)).rejects.toThrow();
    expect(await prisma.cart_items.findMany()).toEqual([]);
  });

  it('rolls back a cart mutation and clears connection context after errors', async () => {
    await add(tokens.a, 0, 2);
    await expect(prisma.withActor(actor(a), async tx => {
      await tx.cart_items.deleteMany(); throw new Error('intentional cart rollback');
    })).rejects.toThrow('intentional cart rollback');
    expect(await prisma.cart_items.count()).toBe(0);
    expect((await api('GET', '/customer/cart', 200, tokens.a)).data.totalItems).toBe(2);
  });

  it('clears only the purchased customer cart after non-prescription checkout', async () => {
    await add(tokens.a, 0, 1); await add(tokens.b, 0, 7);
    await app.get(OrderService).createOrder(a, {
      items: [{ variantId: variants[0], quantity: 1 }], shippingAddress: 'Demo delivery address',
      recipientName: 'Demo Cart A', recipientPhone: '0966660001', latitude: 10.77, longitude: 106.70,
    });
    expect((await api('GET', '/customer/cart', 200, tokens.a)).data.items).toEqual([]);
    expect((await api('GET', '/customer/cart', 200, tokens.b)).data.totalItems).toBe(7);
  });
});
