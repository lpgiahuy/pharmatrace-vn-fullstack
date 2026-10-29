import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { EmployeeModule } from '../src/modules/employee/employee.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const integration = process.env.EMPLOYEE_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Employee HTTP and PostgreSQL RLS', () => {
  let app: INestApplication, owner: Pool, prisma: PrismaService, base: string, admin: string, manager: string;
  const ids = [970001, 970002];
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };
  let facilityId: number;
  const payload = { fullName: 'Employee Test', email: 'new-employee@example.test', password: 'EmployeeTest2026!', role: 'PHARMACIST', facilityId: 0 };
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  beforeAll(async () => {
    const runtime = process.env.EMPLOYEE_RLS_TEST_DATABASE_URL!, ownerUrl = process.env.EMPLOYEE_RLS_TEST_ADMIN_URL!;
    for (const value of [runtime, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_employee_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Tests require the disposable employee test database');
    }
    process.env.DATABASE_URL = runtime;
    process.env.AUTH_RLS_ENABLED = process.env.EMPLOYEE_RLS_TEST_AUTH_ENABLED === 'true' ? 'true' : 'false';
    process.env.JWT_SECRET = 'employee-test-secret-only';
    owner = new Pool({ connectionString: ownerUrl });
    facilityId = (await owner.query("INSERT INTO facilities (facility_name, facility_type) VALUES ('Employee RLS fixture', 'PHARMACY') RETURNING id")).rows[0].id;
    payload.facilityId = facilityId;
    const hash = await bcrypt.hash('EmployeeTest2026!', 10);
    for (const [id, role, email] of [[ids[0], 'SUPER_ADMIN', 'employee-admin@example.test'], [ids[1], 'STORE_MANAGER', 'employee-manager@example.test']] as const) {
      await owner.query("INSERT INTO employees (id, full_name, email, password_hash, role, status) VALUES ($1, 'Employee Test', $2, $3, $4, 'ACTIVE')", [id, email, hash, role]);
    }
    await owner.query('UPDATE employees SET facility_id=$1 WHERE id=$2', [facilityId, ids[1]]);
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, EmployeeModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    admin = (await request('POST', '/admin/auth/login', undefined, { email: 'employee-admin@example.test', password: 'EmployeeTest2026!' })).data.data.accessToken;
    manager = (await request('POST', '/admin/auth/login', undefined, { email: 'employee-manager@example.test', password: 'EmployeeTest2026!' })).data.data.accessToken;
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
  it('restricts management, preserves login and hides public employee rows', async () => {
    expect((await request('GET', '/admin/employees', manager)).status).toBe(200);
    expect((await request('POST', '/admin/employees', manager, { ...payload, role: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await request('POST', '/admin/employees', manager, { ...payload, facilityId: facilityId + 100000 })).status).toBe(403);
    const created = await request('POST', '/admin/employees', admin, payload);
    expect(created.status).toBe(201);
    const id = created.data.data.id;
    expect(created.data.data).not.toHaveProperty('password_hash');
    expect((await request('GET', '/admin/employees', admin)).status).toBe(200);
    expect(await prisma.employees.count()).toBe(0);
    expect((await request('GET', '/auth/me', manager)).status).toBe(200);
    expect((await request('PATCH', '/auth/me', manager, { fullName: 'Updated profile' })).status).toBe(200);
    await expect(prisma.withAuth(tx => tx.employees.update({ where: { id: ids[1] }, data: { role: 'SUPER_ADMIN' } }), { actor: { id: ids[1], type: 'employee', role: 'STORE_MANAGER' } })).rejects.toThrow();
    expect((await request('PATCH', '/admin/employees/'+id, manager, { fullName: 'Updated' })).status).toBe(200);
    expect((await request('PATCH', '/admin/employees/'+id, manager, { role: 'SUPER_ADMIN' })).status).toBe(403);
    expect((await request('PATCH', '/admin/employees/'+id, manager, { facilityId: facilityId + 100000 })).status).toBe(403);
    expect((await request('DELETE', '/admin/employees/'+id, admin)).status).toBe(200);
  });
  it('fails closed if employee FORCE is disabled', async () => {
    await owner.query('ALTER TABLE employees NO FORCE ROW LEVEL SECURITY');
    try { expect((await request('GET', '/admin/employees', admin)).status).toBe(503); }
    finally { await owner.query('ALTER TABLE employees FORCE ROW LEVEL SECURITY'); }
  });
});
