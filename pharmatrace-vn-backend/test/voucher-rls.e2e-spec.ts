import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { OrderModule } from '../src/modules/order/order.module';
import { VoucherModule } from '../src/modules/voucher/voucher.module';
import { PrismaService } from '../src/prisma/prisma.service';

const integration = process.env.VOUCHER_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Voucher HTTP + Prisma + PostgreSQL RLS', () => {
  const a = 950001, b = 950002, manager = 950003, pharmacist = 950004, superAdmin = 950005, admin = 950006;
  const code = 'TEST-VOUCHER-RLS', other = 'TEST-VOUCHER-OTHER';
  let app: INestApplication, owner: Pool, prisma: PrismaService, baseUrl: string;
  let facility: number, medicine: number, variant: number, voucher: number;
  let tokens: Record<string, string>;
  const managerActor = () => ({ id: manager, type: 'employee' as const, role: 'STORE_MANAGER', facilityId: facility });
  const superActor = () => ({ id: superAdmin, type: 'employee' as const, role: 'SUPER_ADMIN' });
  const customer = { id: a, type: 'customer' as const, role: 'CUSTOMER' };
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(baseUrl + path, { method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, result: await response.json() as any };
  }
  async function api(method: string, path: string, status: number, token?: string, body?: unknown) {
    const response = await request(method, path, token, body);
    expect({ status: response.status, ...(response.status === status ? {} : { result: response.result }) }).toEqual({ status });
    return response.result;
  }
  const orderBody = () => ({ items: [{ variantId: variant, quantity: 2 }], shippingAddress: 'Demo voucher address',
    recipientName: 'Demo Voucher Customer', recipientPhone: '0933330001', latitude: 10.123456, longitude: 106.876543,
    voucherCode: code });
  async function used() { return (await owner.query('SELECT used_quantity FROM vouchers WHERE id = $1', [voucher])).rows[0].used_quantity; }
  async function clearFixtures() {
    await owner.query('DELETE FROM loyalty_point_logs WHERE customer_id = ANY($1::int[])', [[a, b]]);
    await owner.query('DELETE FROM orders WHERE customer_id = ANY($1::int[])', [[a, b]]);
    await owner.query('DELETE FROM cart_items WHERE customer_id = ANY($1::int[])', [[a, b]]);
    await owner.query("DELETE FROM vouchers WHERE voucher_code LIKE 'TEST-VOUCHER-%'");
  }
  beforeAll(async () => {
    const runtimeUrl = process.env.VOUCHER_RLS_TEST_DATABASE_URL!;
    const ownerUrl = process.env.VOUCHER_RLS_TEST_ADMIN_URL!;
    for (const value of [runtimeUrl, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_voucher_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('Voucher tests require the disposable localhost pharmatrace_voucher_rls_test database');
      }
    }
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AUTH_RLS_ENABLED = process.env.VOUCHER_RLS_TEST_AUTH_ENABLED === 'true' ? 'true' : 'false';
    process.env.JWT_SECRET = 'isolated-voucher-test-secret-not-for-deployment';
    owner = new Pool({ connectionString: ownerUrl });
    const hash = await bcrypt.hash('VoucherTestOnly2026!', 10);
    await owner.query(`INSERT INTO customers (id, full_name, email, phone_number, password_hash, status, reward_points)
      VALUES ($1, 'Demo Voucher A', 'voucher-a@example.test', '0933330001', $3, 'ACTIVE', 5000),
             ($2, 'Demo Voucher B', 'voucher-b@example.test', '0933330002', $3, 'ACTIVE', 5000)`, [a, b, hash]);
    facility = (await owner.query(`INSERT INTO facilities (facility_name, facility_type, latitude, longitude)
      VALUES ('Demo Voucher Facility', 'PHARMACY', 10.123456, 106.876543) RETURNING id`)).rows[0].id;
    for (const [id, name, role] of [[manager, 'manager', 'STORE_MANAGER'], [pharmacist, 'pharmacist', 'PHARMACIST'],
      [superAdmin, 'super', 'SUPER_ADMIN'], [admin, 'admin', 'ADMIN'], [a, 'same-id', 'WAREHOUSE_STAFF']] as const) {
      await owner.query(`INSERT INTO employees (id, full_name, email, password_hash, role, status, facility_id)
        VALUES ($1, 'Demo Voucher Employee', $2, $3, $4, 'ACTIVE', $5)`, [id, `voucher-${name}@example.test`, hash, role, facility]);
    }
    medicine = (await owner.query(`INSERT INTO medicines (medicine_name, unit_price, status, is_prescription)
      VALUES ('Demo Voucher Medicine', 10000, 'ACTIVE', false) RETURNING id`)).rows[0].id;
    variant = (await owner.query(`INSERT INTO packaging_variants (medicine_id, unit_name, price, is_base_unit)
      VALUES ($1, 'Unit', 10000, true) RETURNING id`, [medicine])).rows[0].id;
    await owner.query('INSERT INTO inventories (facility_id, medicine_id, variant_id, stock_quantity, reserved_quantity) VALUES ($1, $2, $3, 50, 0)', [facility, medicine, variant]);
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule, OrderModule, VoucherModule],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    tokens = {};
    for (const [name, phone] of [['a', '0933330001'], ['b', '0933330002']]) {
      tokens[name] = (await api('POST', '/auth/login', 200, undefined, { identifier: phone, password: 'VoucherTestOnly2026!' })).data.accessToken;
    }
    for (const name of ['manager', 'pharmacist', 'super', 'admin', 'same-id']) {
      tokens[name] = (await api('POST', '/admin/auth/login', 200, undefined, { email: `voucher-${name}@example.test`, password: 'VoucherTestOnly2026!' })).data.accessToken;
    }
  }, 30000);
  beforeEach(async () => {
    await clearFixtures();
    await owner.query('UPDATE inventories SET stock_quantity = 50, reserved_quantity = 0 WHERE medicine_id = $1', [medicine]);
    await owner.query('UPDATE customers SET reward_points = 5000 WHERE id = ANY($1::int[])', [[a, b]]);
    for (const value of [code, other]) {
      const id = (await owner.query(`INSERT INTO vouchers (voucher_code, discount_type, discount_value, total_quantity, used_quantity, status, start_date, end_date)
        VALUES ($1, 'FIXED', 1000, 2, 0, 'ACTIVE', now() - interval '30 days', now() + interval '30 days') RETURNING id`, [value])).rows[0].id;
      if (value === code) voucher = id;
    }
  });
  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      await clearFixtures();
      if (medicine) await owner.query('DELETE FROM medicines WHERE id = $1', [medicine]);
      await owner.query('DELETE FROM employees WHERE id = ANY($1::int[])', [[a, manager, pharmacist, superAdmin, admin]]);
      if (facility) await owner.query('DELETE FROM facilities WHERE id = $1', [facility]);
      await owner.query('DELETE FROM customers WHERE id = ANY($1::int[])', [[a, b]]);
      await owner.end();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it('previews only the exact normalized code without consuming capacity', async () => {
    const preview = (await api('POST', '/vouchers/validate', 200, undefined, { voucherCode: ' test-voucher-rls ', orderSubtotal: 20000 })).data;
    expect(preview).toMatchObject({ voucherCode: code, discountAmount: 1000, finalTotal: 19000 });
    expect(preview).not.toHaveProperty('usedQuantity');
    await expect(used()).resolves.toBe(0);
    expect(await prisma.vouchers.count()).toBe(0);
    const visible = await prisma.withVoucher('validate', tx => tx.vouchers.findMany(), { code });
    expect(visible.map(v => v.id)).toEqual([voucher]);
    await api('POST', '/vouchers/validate', 404, undefined, { voucherCode: 'TEST-VOUCHER-MISSING', orderSubtotal: 20000 });
  });
  it('retires standalone consumption for anonymous and authenticated callers', async () => {
    for (const token of [undefined, tokens.a, tokens.manager]) {
      await api('POST', '/vouchers/apply', 410, token, { voucherCode: code, orderSubtotal: 20000 });
    }
    expect(await used()).toBe(0);
  });
  it('enforces admin role lists and read-only pharmacist access', async () => {
    await api('GET', '/admin/vouchers', 401);
    for (const token of [tokens.a, tokens.admin, tokens['same-id']]) await api('GET', '/admin/vouchers', 403, token);
    await api('GET', `/admin/vouchers/${voucher}`, 200, tokens.pharmacist);
    await api('GET', '/admin/vouchers', 200, tokens.manager);
    await api('GET', `/admin/vouchers/${voucher}`, 200, tokens.manager);
    await api('POST', '/admin/vouchers', 403, tokens.manager, {});
    await api('PATCH', `/admin/vouchers/${voucher}`, 403, tokens.manager, { status: 'INACTIVE' });
    await api('DELETE', `/admin/vouchers/${voucher}`, 403, tokens.manager);
    await expect(prisma.withVoucher('manage', async () => true, { actor: managerActor() })).rejects.toThrow();
    await api('GET', '/admin/vouchers?search=TEST-VOUCHER&limit=1', 200, tokens.super);
    await api('PATCH', `/admin/vouchers/${voucher}`, 403, tokens.pharmacist, { status: 'INACTIVE' });
    await api('DELETE', `/admin/vouchers/${voucher}`, 403, tokens.pharmacist);
    await expect(prisma.withVoucher('read', tx => tx.vouchers.update({ where: { id: voucher }, data: { status: 'INACTIVE' } }),
      { actor: { id: pharmacist, type: 'employee', role: 'PHARMACIST' } })).rejects.toThrow();
  });
  it('supports management while protecting counters and normalized code uniqueness', async () => {
    const body = { voucherCode: ' test-voucher-created ', discountType: 'PERCENT', discountValue: 10, totalQuantity: 5, maxDiscountAmount: 5000, startDate: '2020-01-01T00:00:00Z', endDate: '2099-01-01T00:00:00Z' };
    const created = (await api('POST', '/admin/vouchers', 201, tokens.super, body)).data;
    expect(created).toMatchObject({ voucherCode: 'TEST-VOUCHER-CREATED', usedQuantity: 0 });
    await api('POST', '/admin/vouchers', 409, tokens.super, body);
    await api('PATCH', `/admin/vouchers/${created.id}`, 200, tokens.super, { status: 'INACTIVE' });
    await api('PATCH', `/admin/vouchers/${created.id}`, 400, tokens.super, { usedQuantity: 0 });
    await expect(prisma.withVoucher('manage', tx => tx.vouchers.update({ where: { id: voucher }, data: { used_quantity: 1 } }), { actor: superActor() })).rejects.toThrow();
    await api('DELETE', `/admin/vouchers/${created.id}`, 200, tokens.super);
  });
  it('rejects invalid terms and malformed public requests', async () => {
    const body = { voucherCode: 'TEST-VOUCHER-INVALID', discountType: 'PERCENT', discountValue: 101, totalQuantity: 5, maxDiscountAmount: 5000, startDate: '2020-01-01T00:00:00Z', endDate: '2099-01-01T00:00:00Z' };
    await api('POST', '/admin/vouchers', 400, tokens.super, body);
    await api('POST', '/admin/vouchers', 400, tokens.super, { ...body, discountValue: 10, startDate: '2027-01-02T00:00:00Z', endDate: '2027-01-01T00:00:00Z' });
    await api('POST', '/admin/vouchers', 400, tokens.super, { ...body, voucherCode: '   ' });
    for (const invalid of [{ startDate: null }, { endDate: null }, { maxDiscountAmount: null }, { maxDiscountAmount: 0 }]) {
      await api('POST', '/admin/vouchers', 400, tokens.super, { ...body, discountValue: 10, ...invalid });
    }
    await api('PATCH', `/admin/vouchers/${voucher}`, 400, tokens.super, { startDate: null });
    await api('PATCH', `/admin/vouchers/${voucher}`, 400, tokens.super, { discountType: 'PERCENT', discountValue: 10 });
    await expect(owner.query('UPDATE vouchers SET end_date = NULL WHERE id = $1', [voucher])).rejects.toThrow();
    await expect(owner.query("UPDATE vouchers SET discount_type = 'PERCENT', max_discount_amount = NULL WHERE id = $1", [voucher])).rejects.toThrow();
    await api('POST', '/vouchers/validate', 400, undefined, { voucherCode: code, orderSubtotal: -1 });
    await api('POST', '/vouchers/validate', 400, undefined, { voucherCode: '   ', orderSubtotal: 20000 });
  });
  it('handles simultaneous creation of the same normalized code as a conflict', async () => {
    const body = { voucherCode: 'test-voucher-duplicate', discountType: 'FIXED', discountValue: 1000, totalQuantity: 5, startDate: '2020-01-01T00:00:00Z', endDate: '2099-01-01T00:00:00Z' };
    const responses = await Promise.all([request('POST', '/admin/vouchers', tokens.super, body), request('POST', '/admin/vouchers', tokens.super, body)]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  });
  it('preserves expiry, future-date, inactive, capacity and minimum-subtotal checks', async () => {
    for (const update of ["status = 'INACTIVE'", "end_date = now() - interval '1 day'", "start_date = now() + interval '1 day'", 'used_quantity = total_quantity', 'min_order_value = 30000']) {
      await owner.query("UPDATE vouchers SET status = 'ACTIVE', start_date = now() - interval '30 days', end_date = now() + interval '30 days', used_quantity = 0, min_order_value = 0 WHERE id = $1", [voucher]);
      await owner.query(`UPDATE vouchers SET ${update} WHERE id = $1`, [voucher]);
      await api('POST', '/vouchers/validate', 400, undefined, { voucherCode: code, orderSubtotal: 20000 });
    }
  });
  it('binds successful consumption to the customer order', async () => {
    const order = (await api('POST', '/orders', 201, tokens.a, orderBody())).data;
    expect(order.voucherDiscount).toBe(1000);
    expect((await owner.query('SELECT voucher_id, customer_id FROM orders WHERE id = $1', [order.id])).rows[0]).toEqual({ voucher_id: voucher, customer_id: a });
    expect(await used()).toBe(1);
    await api('POST', '/vouchers/validate', 200, undefined, { voucherCode: code, orderSubtotal: 20000 });
    expect(await used()).toBe(1);
    await api('DELETE', `/admin/vouchers/${voucher}`, 409, tokens.super);
    await api('POST', '/orders', 201, tokens.a, orderBody());
    await api('PATCH', `/admin/vouchers/${voucher}`, 400, tokens.super, { totalQuantity: 1 });
    await api('PATCH', `/admin/vouchers/${voucher}`, 200, tokens.super, { status: 'INACTIVE' });
  });
  it('keeps percentage previews and checkout discounts consistent with the cap', async () => {
    await api('PATCH', `/admin/vouchers/${voucher}`, 200, tokens.super, { discountType: 'PERCENT', discountValue: 20, maxDiscountAmount: 1500, minOrderValue: 10000 });
    expect((await api('POST', '/vouchers/validate', 200, undefined, { voucherCode: code, orderSubtotal: 20000 })).data.discountAmount).toBe(1500);
    expect((await api('POST', '/orders', 201, tokens.a, orderBody())).data.voucherDiscount).toBe(1500);
    expect(await used()).toBe(1);
  });
  it('admits exactly one concurrent checkout for the last remaining use', async () => {
    await owner.query('UPDATE vouchers SET total_quantity = 1 WHERE id = $1', [voucher]);
    const responses = await Promise.all([request('POST', '/orders', tokens.a, orderBody()), request('POST', '/orders', tokens.b, orderBody())]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 400]);
    expect(await used()).toBe(1);
    expect((await owner.query('SELECT count(*)::int AS count FROM orders WHERE voucher_id = $1', [voucher])).rows[0].count).toBe(1);
    expect((await owner.query('SELECT reserved_quantity FROM inventories WHERE facility_id = $1 AND variant_id = $2', [facility, variant])).rows[0].reserved_quantity).toBe(2);
  });
  it('rolls back checkout if voucher terms change after preview', async () => {
    const original = prisma.withOrder.bind(prisma);
    const spy = jest.spyOn(prisma, 'withOrder').mockImplementation((async (operation, run, actor) => {
      if (operation === 'checkout') await owner.query('UPDATE vouchers SET discount_value = 2000 WHERE id = $1', [voucher]);
      return original(operation, run, actor);
    }) as typeof prisma.withOrder);
    try { await api('POST', '/orders', 400, tokens.a, orderBody()); }
    finally { spy.mockRestore(); }
    expect(await used()).toBe(0);
    expect((await owner.query('SELECT count(*)::int AS count FROM orders WHERE customer_id = $1', [a])).rows[0].count).toBe(0);
  });
  it('rolls back consumption and balances if a later checkout write fails', async () => {
    await owner.query('REVOKE INSERT (customer_id, order_id, transaction_type, points, description, created_at) ON loyalty_point_logs FROM app_user');
    try { await api('POST', '/orders', 500, tokens.a, { ...orderBody(), usedPoints: 500 }); }
    finally { await owner.query('GRANT INSERT (customer_id, order_id, transaction_type, points, description, created_at) ON loyalty_point_logs TO app_user'); }
    expect(await used()).toBe(0);
    expect((await owner.query('SELECT reward_points FROM customers WHERE id = $1', [a])).rows[0].reward_points).toBe(5000);
    expect((await owner.query('SELECT count(*)::int AS count FROM orders WHERE customer_id = $1', [a])).rows[0].count).toBe(0);
  });
  it('denies consumption without an eligible bound order and denies destructive privileges', async () => {
    await expect(prisma.withOrder('checkout', async tx => {
      await prisma.prepareVoucher(tx, 'checkout', code, 2147483647);
      await tx.vouchers.update({ where: { id: voucher }, data: { used_quantity: { increment: 1 } } });
    }, customer)).rejects.toThrow();
    for (const sql of ['TRUNCATE vouchers CASCADE', 'UPDATE vouchers SET id = 123', "SELECT setval('vouchers_id_seq', 1)"]) {
      await expect(prisma.withVoucher('manage', tx => tx.$executeRawUnsafe(sql), { actor: superActor() })).rejects.toThrow();
    }
    expect(await used()).toBe(0);
  });
  it('fails closed and clears public/admin context after rollback', async () => {
    await owner.query('ALTER TABLE vouchers NO FORCE ROW LEVEL SECURITY');
    try { await api('POST', '/vouchers/validate', 503, undefined, { voucherCode: code, orderSubtotal: 20000 }); }
    finally { await owner.query('ALTER TABLE vouchers FORCE ROW LEVEL SECURITY'); }
    await expect(prisma.withVoucher('manage', async tx => {
      await tx.vouchers.update({ where: { id: voucher }, data: { status: 'INACTIVE' } });
      throw new Error('rollback voucher');
    }, { actor: superActor() })).rejects.toThrow('rollback voucher');
    expect(await prisma.vouchers.count()).toBe(0);
    await api('POST', '/vouchers/validate', 200, undefined, { voucherCode: code, orderSubtotal: 20000 });
  });
});
