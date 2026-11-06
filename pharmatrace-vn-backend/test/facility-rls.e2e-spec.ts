import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { FacilityModule } from '../src/modules/facility/facility.module';
import { PrismaService } from '../src/prisma/prisma.service';

const integration = process.env.FACILITY_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Facility HTTP and PostgreSQL RLS', () => {
  let app: INestApplication, owner: Pool, prisma: PrismaService, base: string, admin: string, manager: string;
  const ids = [970001, 970002];
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };
  const payload = { name: 'Test RLS facility', type: 'PHARMACY', latitude: 10, longitude: 106 };
  async function request(method: string, path: string, token?: string, body?: unknown) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }
  beforeAll(async () => {
    const runtime = process.env.FACILITY_RLS_TEST_DATABASE_URL!, ownerUrl = process.env.FACILITY_RLS_TEST_ADMIN_URL!;
    for (const value of [runtime, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_facility_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Tests require the disposable facility test database');
    }
    process.env.DATABASE_URL = runtime;
    process.env.AUTH_RLS_ENABLED = process.env.FACILITY_RLS_TEST_AUTH_ENABLED === 'true' ? 'true' : 'false';
    process.env.JWT_SECRET = 'facility-test-secret-only';
    owner = new Pool({ connectionString: ownerUrl });
    const hash = await bcrypt.hash('FacilityTest2026!', 10);
    for (const [id, role, email] of [[ids[0], 'SUPER_ADMIN', 'facility-admin@example.test'], [ids[1], 'STORE_MANAGER', 'facility-manager@example.test']] as const) {
      await owner.query("INSERT INTO employees (id, full_name, email, password_hash, role, status) VALUES ($1, 'Facility Test', $2, $3, $4, 'ACTIVE')", [id, email, hash, role]);
    }
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule, FacilityModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    admin = (await request('POST', '/admin/auth/login', undefined, { email: 'facility-admin@example.test', password: 'FacilityTest2026!' })).data.data.accessToken;
    manager = (await request('POST', '/admin/auth/login', undefined, { email: 'facility-manager@example.test', password: 'FacilityTest2026!' })).data.data.accessToken;
  }, 30000);
  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      await owner.query("DELETE FROM facilities WHERE facility_name LIKE 'Test RLS facility%'");
      await owner.query('DELETE FROM employees WHERE id = ANY($1::int[])', [ids]);
      await owner.end();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  it('preserves public reads and permits only super admins to manage facilities', async () => {
    expect((await request('GET', '/facilities')).status).toBe(200);
    expect((await request('POST', '/facilities', undefined, payload)).status).toBe(401);
    expect((await request('POST', '/facilities', manager, payload)).status).toBe(403);
    const created = await request('POST', '/facilities', admin, payload);
    expect(created.status).toBe(201);
    const id = created.data.data.id;
    expect((await request('PATCH', `/facilities/${id}`, admin, { name: 'Test RLS facility updated' })).status).toBe(200);
    expect((await request('DELETE', `/facilities/${id}`, manager)).status).toBe(403);
    expect((await request('DELETE', `/facilities/${id}`, admin)).status).toBe(200);
  });
  it('rejects unscoped database writes and fails closed if FORCE is disabled', async () => {
    await expect(prisma.facilities.create({ data: { facility_name: 'Denied facility', facility_type: 'PHARMACY' } })).rejects.toThrow();
    await owner.query('ALTER TABLE facilities NO FORCE ROW LEVEL SECURITY');
    try { expect((await request('POST', '/facilities', admin, payload)).status).toBe(503); }
    finally { await owner.query('ALTER TABLE facilities FORCE ROW LEVEL SECURITY'); }
  });
});

