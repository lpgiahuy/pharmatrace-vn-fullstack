import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { CustomerModule } from '../src/modules/customer/customer.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const integration = process.env.CUSTOMER_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Employee HTTP and PostgreSQL RLS', () => {
  let app: INestApplication, owner: Pool, prisma: PrismaService, base: string, admin: string, manager: string, pharmacist: string;
  const ids = [970001, 970002, 970003];
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };
  let facilityId: number;
  const payload = { fullName: 'Employee Test', email: 'new-employee@example.test', password: 'EmployeeTest2026!', role: 'PHARMACIST', facilityId: 0 };
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  beforeAll(async () => {
    const runtime = process.env.CUSTOMER_RLS_TEST_DATABASE_URL!, ownerUrl = process.env.CUSTOMER_RLS_TEST_ADMIN_URL!;
    for (const value of [runtime, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_customer_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Tests require the disposable employee test database');
    }
    process.env.DATABASE_URL = runtime;
    process.env.AUTH_RLS_ENABLED = process.env.CUSTOMER_RLS_TEST_AUTH_ENABLED === 'true' ? 'true' : 'false';
    process.env.JWT_SECRET = 'employee-test-secret-only';
    owner = new Pool({ connectionString: ownerUrl });
    facilityId = (await owner.query("INSERT INTO facilities (facility_name, facility_type) VALUES ('Employee RLS fixture', 'PHARMACY') RETURNING id")).rows[0].id;
    payload.facilityId = facilityId;
    const hash = await bcrypt.hash('EmployeeTest2026!', 10);
    for (const [id, role, email] of [[ids[0], 'SUPER_ADMIN', 'employee-admin@example.test'], [ids[1], 'STORE_MANAGER', 'employee-manager@example.test']] as const) {
      await owner.query("INSERT INTO employees (id, full_name, email, password_hash, role, status) VALUES ($1, 'Employee Test', $2, $3, $4, 'ACTIVE')", [id, email, hash, role]);
    }
    await owner.query("INSERT INTO employees (id, full_name, email, password_hash, role, status, facility_id) VALUES ($1,'Test Pharmacist','customer-pharmacist@example.test',$2,'PHARMACIST','ACTIVE',$3)", [ids[2], hash, facilityId]);
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, CustomerModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    admin = (await request('POST', '/admin/auth/login', undefined, { email: 'employee-admin@example.test', password: 'EmployeeTest2026!' })).data.data.accessToken;
    manager = (await request('POST', '/admin/auth/login', undefined, { email: 'employee-manager@example.test', password: 'EmployeeTest2026!' })).data.data.accessToken;
    pharmacist = (await request('POST', '/admin/auth/login', undefined, { email: 'customer-pharmacist@example.test', password: 'EmployeeTest2026!' })).data.data.accessToken;
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      await owner.query("DELETE FROM employees WHERE email = 'new-employee@example.test'");
      await owner.query('DELETE FROM employees WHERE id = ANY($1::int[])', [ids]);
      await owner.query('DELETE FROM facilities WHERE id = $1', [facilityId]);
      await owner.end();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it('limits facility staff to related customers and permits global administration', async () => {
    const customer = (await owner.query("INSERT INTO customers (full_name,phone_number,status) VALUES ('Test Customer','0999700011','ACTIVE') RETURNING id")).rows[0].id;
    try {
      expect(await request('GET', '/admin/customers/'+customer, manager)).toMatchObject({ status: 404 });
      expect((await request('GET', '/admin/customers/'+customer, admin)).status).toBe(200);
      await owner.query("INSERT INTO orders (order_code,customer_id,export_facility_id) VALUES ('CUSTOMER-SCOPE-TEST',$1,$2)", [customer, facilityId]);
      expect((await request('GET', '/admin/customers/'+customer, pharmacist)).status).toBe(200);
      expect((await request('PATCH', '/admin/customers/'+customer+'/status', pharmacist, { status: 'INACTIVE' })).status).toBe(403);
      const denied = await prisma.withCustomerManagement({ id: ids[2], type: 'employee', role: 'PHARMACIST', facilityId }, tx => tx.customers.updateMany({ where: { id: customer }, data: { status: 'INACTIVE' } }));
      expect(denied.count).toBe(0);
      expect((await request('PATCH', '/admin/customers/'+customer+'/status', admin, { status: 'BANNED' })).status).toBe(200);
      expect(await prisma.customers.count()).toBe(0);
      await expect(prisma.withAuth(tx => tx.customers.update({ where: { id: customer }, data: { reward_points: 999 } }), { actor: { id: customer, type: 'customer', role: 'CUSTOMER' } })).rejects.toThrow();
      await prisma.withAuth(tx => tx.customers.update({ where: { id: customer }, data: { full_name: 'Updated Customer' } }), { actor: { id: customer, type: 'customer', role: 'CUSTOMER' } });
    } finally { await owner.query("DELETE FROM orders WHERE order_code='CUSTOMER-SCOPE-TEST'"); await owner.query('DELETE FROM customers WHERE id=$1', [customer]); }
  });
});
