import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { OrderModule } from '../src/modules/order/order.module';
import { LogisticsModule } from '../src/modules/logistics/logistics.module';
import { OrderCronService } from '../src/modules/order/order-cron.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrescriptionService } from '../src/modules/prescription/prescription.service';
import { PrescriptionController } from '../src/modules/prescription/prescription.controller';
import { CloudinaryService } from '../src/modules/cloudinary/cloudinary.service';
import { CustomerService } from '../src/modules/customer/customer.service';
import { CustomerController } from '../src/modules/customer/customer.controller';
import { ProductService } from '../src/modules/product/product.service';

const integration = process.env.ORDER_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Order HTTP + Prisma + PostgreSQL RLS', () => {
  const a = 940001, b = 940002, manager = 940003, source = 940004, pharmacist = 940005, superAdmin = 940006, sourcePharmacist = 940007;
  const customer = { id: a, type: 'customer' as const, role: 'CUSTOMER' };
  let app: INestApplication, owner: Pool, prisma: PrismaService, baseUrl: string;
  let primary: number, secondary: number, outside: number, medicine: number, variant: number, voucher: number;
  let tokens: Record<string, string>;
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };
  const managerActor = () => ({ id: manager, type: 'employee' as const, role: 'STORE_MANAGER', facilityId: primary });
  const sourceActor = () => ({ id: source, type: 'employee' as const, role: 'WAREHOUSE_STAFF', facilityId: secondary });
  const superActor = () => ({ id: superAdmin, type: 'employee' as const, role: 'SUPER_ADMIN' });
  async function api(method: string, path: string, status: number, token?: string, body?: unknown) {
    const response = await fetch(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json();
    expect({ status: response.status, ...(response.status === status ? {} : { result }) }).toEqual({ status });
    return result;
  }
  const orderBody = () => ({ items: [{ variantId: variant, quantity: 2 }], shippingAddress: 'Demo order address',
    recipientName: 'Demo Recipient', recipientPhone: '0944440001', latitude: 10.7654321, longitude: 106.654321 });
  async function place(token = tokens.a, extras = {}) {
    return (await api('POST', '/orders', 201, token, { ...orderBody(), ...extras })).data;
  }
  async function clearOrders() {
    await owner.query('DELETE FROM loyalty_point_logs WHERE customer_id = ANY($1::int[])', [[a, b]]);
    await owner.query(`DELETE FROM logistics_events WHERE transfer_id IN
      (SELECT t.id FROM internal_transfers t JOIN orders o ON o.id = t.order_id WHERE o.customer_id = ANY($1::int[]))
      OR shipment_id IN (SELECT s.id FROM shipments s JOIN orders o ON o.id = s.order_id WHERE o.customer_id = ANY($1::int[]))`, [[a, b]]);
    await owner.query('DELETE FROM orders WHERE customer_id = ANY($1::int[])', [[a, b]]);
    await owner.query('DELETE FROM prescriptions WHERE customer_id = ANY($1::int[])', [[a, b]]);
    await owner.query('DELETE FROM cart_items WHERE customer_id = ANY($1::int[])', [[a, b]]);
    if (medicine) await owner.query('DELETE FROM inventory_logs WHERE medicine_id = $1', [medicine]);
  }
  beforeAll(async () => {
    const runtimeUrl = process.env.ORDER_RLS_TEST_DATABASE_URL!;
    const ownerUrl = process.env.ORDER_RLS_TEST_ADMIN_URL!;
    for (const value of [runtimeUrl, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_order_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('Order tests require the disposable localhost pharmatrace_order_rls_test database');
      }
    }
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AUTH_RLS_ENABLED = process.env.ORDER_RLS_TEST_AUTH_ENABLED === 'true' ? 'true' : 'false';
    process.env.JWT_SECRET = 'isolated-order-test-secret-not-for-deployment';
    owner = new Pool({ connectionString: ownerUrl });
    const hash = await bcrypt.hash('OrderTestOnly2026!', 10);
    await owner.query(`INSERT INTO customers (id, full_name, email, phone_number, password_hash, status, reward_points)
      VALUES ($1, 'Demo Order A', 'order-a@example.test', '0944440001', $3, 'ACTIVE', 5000),
             ($2, 'Demo Order B', 'order-b@example.test', '0944440002', $3, 'ACTIVE', 5000)`, [a, b, hash]);
    const facilities: number[] = [];
    for (const [name, latitude] of [['Primary', 10.7654321], ['Source', 10.7754321], ['Outside', 20.7654321]]) {
      facilities.push((await owner.query(`INSERT INTO facilities (facility_name, facility_type, latitude, longitude)
        VALUES ($1, 'PHARMACY', $2, 106.654321) RETURNING id`, [`Demo Order ${name}`, latitude])).rows[0].id);
    }
    [primary, secondary, outside] = facilities;
    for (const [id, name, role, unit] of [[manager, 'manager', 'STORE_MANAGER', primary], [source, 'source', 'WAREHOUSE_STAFF', secondary],
      [pharmacist, 'pharmacist', 'PHARMACIST', primary], [sourcePharmacist, 'source-pharmacist', 'PHARMACIST', secondary], [superAdmin, 'super', 'SUPER_ADMIN', null],
      [a, 'same-id', 'WAREHOUSE_STAFF', outside]] as const) {
      await owner.query(`INSERT INTO employees (id, full_name, email, password_hash, role, status, facility_id)
        VALUES ($1, 'Demo Order Employee', $2, $3, $4, 'ACTIVE', $5)`, [id, `order-${name}@example.test`, hash, role, unit]);
    }
    medicine = (await owner.query(`INSERT INTO medicines (medicine_name, unit_price, status, is_prescription)
      VALUES ('Demo Order Medicine', 10000, 'ACTIVE', false) RETURNING id`)).rows[0].id;
    variant = (await owner.query(`INSERT INTO packaging_variants (medicine_id, unit_name, price, is_base_unit)
      VALUES ($1, 'Unit', 10000, true) RETURNING id`, [medicine])).rows[0].id;
    for (const unit of [primary, secondary]) await owner.query(`INSERT INTO inventories (facility_id, medicine_id, variant_id, stock_quantity, reserved_quantity)
      VALUES ($1, $2, $3, 50, 0)`, [unit, medicine, variant]);
    voucher = (await owner.query(`INSERT INTO vouchers (voucher_code, discount_type, discount_value, total_quantity, used_quantity, status, start_date, end_date)
      VALUES ('DEMO-ORDER-RLS', 'FIXED', 1000, 20, 0, 'ACTIVE', now() - interval '30 days', now() + interval '30 days') RETURNING id`)).rows[0].id;
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule, OrderModule, LogisticsModule],
      controllers: [PrescriptionController, CustomerController],
      providers: [PrescriptionService, CustomerService, ProductService, { provide: CloudinaryService, useValue: {} }],
    }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    tokens = {};
    for (const [name, phone] of [['a', '0944440001'], ['b', '0944440002']]) {
      tokens[name] = (await api('POST', '/auth/login', 200, undefined, { identifier: phone, password: 'OrderTestOnly2026!' })).data.accessToken;
    }
    for (const name of ['manager', 'source', 'pharmacist', 'source-pharmacist', 'super', 'same-id']) {
      tokens[name] = (await api('POST', '/admin/auth/login', 200, undefined, { email: `order-${name}@example.test`, password: 'OrderTestOnly2026!' })).data.accessToken;
    }
  }, 30000);
  beforeEach(async () => {
    await clearOrders();
    await owner.query('UPDATE customers SET reward_points = 5000 WHERE id = ANY($1::int[])', [[a, b]]);
    await owner.query('UPDATE medicines SET is_prescription = false, status = $2 WHERE id = $1', [medicine, 'ACTIVE']);
    await owner.query('UPDATE inventories SET stock_quantity = 50, reserved_quantity = 0 WHERE medicine_id = $1', [medicine]);
    await owner.query('UPDATE vouchers SET used_quantity = 0 WHERE id = $1', [voucher]);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      await clearOrders();
      if (medicine) await owner.query('DELETE FROM medicines WHERE id = $1', [medicine]);
      if (voucher) await owner.query('DELETE FROM vouchers WHERE id = $1', [voucher]);
      await owner.query('DELETE FROM employees WHERE id = ANY($1::int[])', [[a, manager, source, pharmacist, sourcePharmacist, superAdmin]]);
      await owner.query('DELETE FROM facilities WHERE id = ANY($1::int[])', [[primary, secondary, outside].filter(Boolean)]);
      await owner.query('DELETE FROM customers WHERE id = ANY($1::int[])', [[a, b]]);
      await owner.end();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it('isolates customer orders and denies anonymous or same-ID employees', async () => {
    const own = await place();
    const foreign = await place(tokens.b);
    expect((await api('GET', '/orders/me', 200, tokens.a)).data.map((o: any) => o.id)).toEqual([own.id]);
    await api('GET', `/orders/${foreign.id}`, 404, tokens.a);
    await api('PATCH', `/orders/${foreign.id}/cancel`, 404, tokens.a);
    await api('GET', '/orders/me', 401);
    await api('POST', '/orders', 403, tokens['same-id'], orderBody());
    expect(await prisma.orders.count()).toBe(0);
    expect(await prisma.withOrder('read', tx => tx.orders.count(), customer)).toBe(1);
    await expect(prisma.withOrder('read', tx => tx.orders.count(), { id: a, role: 'WAREHOUSE_STAFF', type: 'employee' })).rejects.toThrow('assigned to a facility');
  });
  it('applies points/voucher/cart cleanup and cancels only once', async () => {
    await owner.query('INSERT INTO cart_items (customer_id, variant_id, quantity) VALUES ($1, $2, 2), ($3, $2, 1)', [a, variant, b]);
    const order = await place(tokens.a, { usedPoints: 500, voucherCode: 'DEMO-ORDER-RLS' });
    expect(order).toMatchObject({ usedPoints: 500, voucherDiscount: 1000, exportFacilityId: primary });
    expect((await owner.query('SELECT reward_points FROM customers WHERE id = $1', [a])).rows[0].reward_points).toBe(4500);
    expect((await owner.query('SELECT customer_id FROM cart_items WHERE variant_id = $1', [variant])).rows).toEqual([{ customer_id: b }]);
    await api('PATCH', `/orders/${order.id}/cancel`, 200, tokens.a);
    await api('PATCH', `/orders/${order.id}/cancel`, 400, tokens.a);
    expect((await owner.query('SELECT reward_points FROM customers WHERE id = $1', [a])).rows[0].reward_points).toBe(5000);
    expect((await owner.query('SELECT reserved_quantity FROM inventories WHERE facility_id = $1 AND variant_id = $2', [primary, variant])).rows[0].reserved_quantity).toBe(0);
    expect(await prisma.withOrder('read', tx => tx.loyalty_point_logs.count({ where: { order_id: order.id } }), customer)).toBe(2);
  });
  it('rejects forged ownership, totals and staff-only writes', async () => {
    await api('POST', '/orders', 400, tokens.a, { ...orderBody(), customerId: b, totalAmount: 1 });
    const order = await place();
    await expect(prisma.withOrder('cancel', tx => tx.orders.update({ where: { id: order.id }, data: { payment_status: 'PAID' } }), customer)).rejects.toThrow();
    await expect(prisma.withOrder('cancel', tx => tx.order_items.updateMany({ where: { order_id: order.id }, data: { source_facility_id: outside } }), customer)).rejects.toThrow();
    await expect(prisma.withOrder('status', () => Promise.resolve(true), { id: pharmacist, role: 'WAREHOUSE_STAFF', type: 'employee', facilityId: primary })).rejects.toThrow();
    for (const sql of ['DELETE FROM orders', 'TRUNCATE orders', 'DELETE FROM loyalty_point_logs', "UPDATE loyalty_point_logs SET points = 99999"]) {
      await expect(prisma.withOrder('status', tx => tx.$executeRawUnsafe(sql), superActor())).rejects.toThrow();
    }
  });
  it('scopes staff lists, customer-management joins and order details to export facility', async () => {
    const order = await place();
    expect((await api('GET', '/admin/orders', 200, tokens.source)).data).toHaveLength(0);
    await api('GET', `/admin/orders/${order.id}`, 404, tokens.source);
    expect((await api('GET', '/admin/orders', 200, tokens.manager)).data.map((o: any) => o.id)).toContain(order.id);
    expect((await api('GET', '/admin/orders', 200, tokens.super)).data.map((o: any) => o.id)).toContain(order.id);
    expect((await api('GET', `/admin/customers/${a}/orders`, 200, tokens.manager)).data).toHaveLength(1);
    expect((await api('GET', `/admin/customers/${a}`, 200, tokens.manager)).data.orderStats.totalOrders).toBe(1);
    expect((await api('GET', `/admin/customers/${a}/orders`, 200, tokens.pharmacist)).data).toHaveLength(1);
    const outsideStaff = { ...managerActor(), facilityId: outside };
    await expect(app.get(CustomerService).getCustomerOrders(a, {}, outsideStaff)).rejects.toThrow('Customer with ID');
  });
  it('packs and completes orders while rejecting wrong-facility writes', async () => {
    const order = await place();
    await api('POST', `/admin/orders/${order.id}/pack`, 404, tokens.source, {});
    await api('POST', `/admin/orders/${order.id}/pack`, 200, tokens.pharmacist, {});
    await api('POST', `/admin/orders/${order.id}/pack`, 400, tokens.manager, {});
    await api('PATCH', `/admin/orders/${order.id}/status`, 200, tokens.pharmacist, { orderStatus: 'COMPLETED' });
    expect((await owner.query('SELECT shipping_status FROM shipments WHERE order_id = $1', [order.id])).rows[0].shipping_status).toBe('DELIVERED');
  });
  it('gives source warehouses transfer state without exposing customer orders or prescriptions', async () => {
    await owner.query('UPDATE inventories SET stock_quantity = 0 WHERE facility_id = $1 AND variant_id = $2', [primary, variant]);
    const order = await place();
    const transfer = order.internalTransfers[0];
    expect(order.orderStatus).toBe('WAITING_INTERNAL_TRANSFER');
    const listed = (await api('GET', '/admin/logistics/transfers', 200, tokens.source)).data;
    expect(listed.map((t: any) => t.id)).toContain(transfer.id);
    expect(JSON.stringify(listed)).not.toMatch(/recipient_name|shipping_address|order-a@example|prescription_image/);
    await api('GET', `/admin/orders/${order.id}`, 404, tokens.source);
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/dispatch`, 404, tokens.manager, {});
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/dispatch`, 200, tokens.source, {});
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/receive`, 404, tokens.source, {});
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/receive`, 200, tokens.manager, {});
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/receive`, 200, tokens.manager, {});
    expect((await owner.query('SELECT stock_quantity, reserved_quantity FROM inventories WHERE facility_id = $1 AND variant_id = $2', [primary, variant])).rows[0]).toEqual({ stock_quantity: 2, reserved_quantity: 2 });
  });
  it('accepts canonical status updates for legacy English aliases', async () => {
    const order = await place();
    await owner.query("UPDATE orders SET order_status = 'DELIVERED' WHERE id = $1", [order.id]);
    await api('PATCH', `/admin/orders/${order.id}/status`, 200, tokens.manager, { paymentStatus: 'PAID' });
    expect((await api('GET', `/orders/${order.id}`, 200, tokens.a)).data).toMatchObject({ orderStatus: 'COMPLETED', paymentStatus: 'PAID' });
  });
  it('rolls back order, stock and voucher if the point ledger insert fails', async () => {
    await owner.query('REVOKE INSERT (customer_id, order_id, transaction_type, points, description) ON loyalty_point_logs FROM app_user');
    try {
      await api('POST', '/orders', 500, tokens.a, { ...orderBody(), usedPoints: 500, voucherCode: 'DEMO-ORDER-RLS' });
    } finally {
      await owner.query('GRANT INSERT (customer_id, order_id, transaction_type, points, description) ON loyalty_point_logs TO app_user');
    }
    expect((await owner.query('SELECT count(*)::int AS count FROM orders WHERE customer_id = $1', [a])).rows[0].count).toBe(0);
    expect((await owner.query('SELECT reward_points FROM customers WHERE id = $1', [a])).rows[0].reward_points).toBe(5000);
    expect((await owner.query('SELECT used_quantity FROM vouchers WHERE id = $1', [voucher])).rows[0].used_quantity).toBe(0);
    expect((await owner.query('SELECT reserved_quantity FROM inventories WHERE facility_id = $1 AND variant_id = $2', [primary, variant])).rows[0].reserved_quantity).toBe(0);
  });
  it('replaces damaged transfers at the destination without widening source order access', async () => {
    await owner.query('UPDATE inventories SET stock_quantity = 0 WHERE facility_id = $1 AND variant_id = $2', [primary, variant]);
    const order = await place();
    const transfer = order.internalTransfers[0];
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/dispatch`, 200, tokens.source, {});
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/reject-damaged`, 404, tokens.source, {});
    const replacement = (await api('PATCH', `/admin/logistics/transfers/${transfer.id}/reject-damaged`, 200, tokens.manager, {})).data;
    expect(replacement).toMatchObject({ status: 'REQUESTED', order_id: order.id });
    expect((await owner.query('SELECT status FROM internal_transfers WHERE id = $1', [transfer.id])).rows[0].status).toBe('REPLACED');
    await api('PATCH', `/admin/logistics/transfers/${replacement.id}/dispatch`, 200, tokens.source, {});
    await api('PATCH', `/admin/logistics/transfers/${replacement.id}/receive`, 200, tokens.manager, {});
    expect((await api('GET', `/orders/${order.id}`, 200, tokens.a)).data.orderStatus).toBe('PROCESSING');
  });
  it('preserves pharmacist approval/rejection, inventory release and point refund', async () => {
    await owner.query('UPDATE medicines SET is_prescription = true WHERE id = $1', [medicine]);
    const prescription = (await owner.query('INSERT INTO prescriptions (customer_id, prescription_image_url) VALUES ($1, $2) RETURNING id', [a, 'https://example.invalid/demo-prescriptions/order.png'])).rows[0].id;
    const order = await place(tokens.a, { prescriptionId: prescription, usedPoints: 500, voucherCode: 'DEMO-ORDER-RLS' });
    const review = order.prescriptionReview.id;
    await owner.query("UPDATE orders SET payment_status = 'PAID' WHERE id = $1", [order.id]);
    await api('POST', `/admin/orders/${order.id}/pack`, 400, tokens.manager, {});
    await api('PATCH', `/admin/prescriptions/${review}/reject`, 200, tokens.pharmacist, { note: 'Demo rejection' });
    expect((await owner.query('SELECT used_quantity FROM vouchers WHERE id = $1', [voucher])).rows[0].used_quantity).toBe(0);
    expect((await api('GET', `/orders/${order.id}`, 200, tokens.a)).data.orderStatus).toBe('CANCELLED');
    expect((await api('GET', `/orders/${order.id}`, 200, tokens.a)).data.paymentStatus).toBe('PAID');
    expect((await owner.query('SELECT reward_points FROM customers WHERE id = $1', [a])).rows[0].reward_points).toBe(5000);
    expect((await owner.query('SELECT reserved_quantity FROM inventories WHERE facility_id = $1 AND variant_id = $2', [primary, variant])).rows[0].reserved_quantity).toBe(0);
    await api('PATCH', `/admin/prescriptions/${review}/reject`, 409, tokens.pharmacist, { note: 'Duplicate rejection' });
    expect((await owner.query('SELECT used_quantity FROM vouchers WHERE id = $1', [voucher])).rows[0].used_quantity).toBe(0);
    expect((await owner.query("SELECT count(*)::int AS count FROM loyalty_point_logs WHERE order_id = $1 AND transaction_type = 'REDEEM_REVERSAL'", [order.id])).rows[0].count).toBe(1);
    await api('PATCH', `/admin/orders/${order.id}/status`, 200, tokens.manager, { paymentStatus: 'REFUNDED' });
    expect((await api('GET', `/orders/${order.id}`, 200, tokens.a)).data.paymentStatus).toBe('REFUNDED');
  });
  it('assigns prescription approval to the preparing facility, not the supplying facility', async () => {
    await owner.query('UPDATE medicines SET is_prescription = true WHERE id = $1', [medicine]);
    await owner.query('UPDATE inventories SET stock_quantity = 0 WHERE facility_id = $1 AND variant_id = $2', [primary, variant]);
    const prescription = (await owner.query('INSERT INTO prescriptions (customer_id, prescription_image_url) VALUES ($1, $2) RETURNING id', [a, 'https://example.invalid/demo-prescriptions/order.png'])).rows[0].id;
    const order = await place(tokens.a, { prescriptionId: prescription });
    const review = order.prescriptionReview.id;
    const transfer = order.internalTransfers[0];
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/dispatch`, 400, tokens.source, {});
    await api('PATCH', `/admin/prescriptions/${review}/approve`, 404, tokens['source-pharmacist'], {});
    await api('GET', `/admin/prescriptions/${review}/image`, 404, tokens['source-pharmacist']);
    await api('PATCH', `/admin/prescriptions/${review}/approve`, 200, tokens.pharmacist, {});
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/dispatch`, 200, tokens.source, {});
    await api('PATCH', `/admin/logistics/transfers/${transfer.id}/receive`, 200, tokens.manager, {});
  });
  it('rolls back prescription rejection when voucher usage is inconsistent', async () => {
    await owner.query('UPDATE medicines SET is_prescription = true WHERE id = $1', [medicine]);
    const prescription = (await owner.query('INSERT INTO prescriptions (customer_id, prescription_image_url) VALUES ($1, $2) RETURNING id', [a, 'https://example.invalid/demo-prescriptions/order.png'])).rows[0].id;
    const order = await place(tokens.a, { prescriptionId: prescription, usedPoints: 500, voucherCode: 'DEMO-ORDER-RLS' });
    await owner.query('UPDATE vouchers SET used_quantity = 0 WHERE id = $1', [voucher]);
    await api('PATCH', `/admin/prescriptions/${order.prescriptionReview.id}/reject`, 500, tokens.pharmacist, { note: 'Demo rejection' });
    expect((await owner.query('SELECT order_status, prescription_review_status FROM orders WHERE id = $1', [order.id])).rows[0]).toEqual({ order_status: 'PENDING', prescription_review_status: 'PENDING_APPROVAL' });
    expect((await owner.query('SELECT reward_points FROM customers WHERE id = $1', [a])).rows[0].reward_points).toBe(4500);
    expect((await owner.query('SELECT reserved_quantity FROM inventories WHERE facility_id = $1 AND variant_id = $2', [primary, variant])).rows[0].reserved_quantity).toBe(2);
  });
  it('awards loyalty once under concurrent jobs and reverses earned points on return', async () => {
    const order = await place();
    await owner.query("UPDATE orders SET order_status = 'COMPLETED', created_at = now() - interval '1001 days' WHERE id = $1", [order.id]);
    const cron = app.get(OrderCronService);
    await Promise.all([cron.awardPointsForCompletedOrders(1000), cron.awardPointsForCompletedOrders(1000)]);
    const logs = (await owner.query("SELECT points FROM loyalty_point_logs WHERE order_id = $1 AND transaction_type = 'EARN'", [order.id])).rows;
    expect(logs).toEqual([{ points: Math.floor(order.totalAmount / 100) }]);
    await api('PATCH', `/admin/orders/${order.id}/status`, 200, tokens.manager, { orderStatus: 'RETURNED' });
    expect((await owner.query("SELECT count(*)::int AS count FROM loyalty_point_logs WHERE order_id = $1 AND transaction_type = 'EARN_REVERSAL'", [order.id])).rows[0].count).toBe(1);
    await api('POST', '/admin/orders/trigger-point-award?days=-1', 400, tokens.super, {});
    await api('POST', '/admin/orders/trigger-point-award', 403, tokens.manager, {});
  });
  it('preserves product history checks across facility boundaries without exposing orders', async () => {
    const order = await place();
    expect(order.id).toBeGreaterThan(0);
    const product = await app.get(ProductService).delete(medicine, { ...managerActor(), facilityId: outside });
    expect(product.isSoftDeleted).toBe(true);
    expect((await owner.query('SELECT status FROM medicines WHERE id = $1', [medicine])).rows[0].status).toBe('INACTIVE');
    expect((await owner.query('SELECT medicine_id FROM order_items WHERE order_id = $1', [order.id])).rows[0].medicine_id).toBe(medicine);
  });
  it('fails closed for missing FORCE RLS and clears context after rollback', async () => {
    await owner.query('ALTER TABLE orders NO FORCE ROW LEVEL SECURITY');
    try { await api('GET', '/orders/me', 503, tokens.a); }
    finally { await owner.query('ALTER TABLE orders FORCE ROW LEVEL SECURITY'); }
    const order = await place();
    await expect(prisma.withOrder('cancel', async tx => {
      await tx.orders.update({ where: { id: order.id }, data: { order_status: 'CANCELLED' } });
      throw new Error('rollback scope');
    }, customer)).rejects.toThrow('rollback scope');
    expect(await prisma.orders.count()).toBe(0);
    expect((await api('GET', `/orders/${order.id}`, 200, tokens.a)).data.orderStatus).toBe('PENDING');
    expect(await prisma.withOrder('read', tx => tx.orders.count(), sourceActor())).toBe(0);
  });
});
