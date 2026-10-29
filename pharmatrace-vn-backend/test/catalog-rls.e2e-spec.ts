import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { ProductController } from '../src/modules/product/product.controller';
import { ProductService } from '../src/modules/product/product.service';
import { CategoryModule } from '../src/modules/category/category.module';
import { CloudinaryService } from '../src/modules/cloudinary/cloudinary.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

const integration = process.env.CATALOG_RLS_TEST_DATABASE_URL ? describe : describe.skip;
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
    const runtime = process.env.CATALOG_RLS_TEST_DATABASE_URL!, ownerUrl = process.env.CATALOG_RLS_TEST_ADMIN_URL!;
    for (const value of [runtime, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_catalog_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Tests require the disposable employee test database');
    }
    process.env.DATABASE_URL = runtime;
    process.env.AUTH_RLS_ENABLED = process.env.CATALOG_RLS_TEST_AUTH_ENABLED === 'true' ? 'true' : 'false';
    process.env.JWT_SECRET = 'employee-test-secret-only';
    owner = new Pool({ connectionString: ownerUrl });
    facilityId = (await owner.query("INSERT INTO facilities (facility_name, facility_type) VALUES ('Employee RLS fixture', 'PHARMACY') RETURNING id")).rows[0].id;
    payload.facilityId = facilityId;
    const hash = await bcrypt.hash('EmployeeTest2026!', 10);
    for (const [id, role, email] of [[ids[0], 'SUPER_ADMIN', 'employee-admin@example.test'], [ids[1], 'STORE_MANAGER', 'employee-manager@example.test']] as const) {
      await owner.query("INSERT INTO employees (id, full_name, email, password_hash, role, status) VALUES ($1, 'Employee Test', $2, $3, $4, 'ACTIVE')", [id, email, hash, role]);
    }
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PrismaModule, AuthModule, CategoryModule], controllers: [ProductController], providers: [ProductService, { provide: CloudinaryService, useValue: {} }] }).compile();
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
  it('preserves public reads and restricts catalog writes to managers', async () => {
    expect((await request('GET', '/categories')).status).toBe(200);
    expect((await request('GET', '/products')).status).toBe(200);
    expect((await request('POST', '/admin/categories', undefined, { categoryName: 'Catalog RLS test' })).status).toBe(401);
    const category = await request('POST', '/admin/categories', manager, { categoryName: 'Catalog RLS test' });
    expect(category.status).toBe(201);
    const categoryId = category.data.data.id;
    const product = await request('POST', '/admin/products', admin, { medicineName: 'Catalog RLS product', unitPrice: 10000, categoryIds: [categoryId] });
    expect(product.status).toBe(201);
    const productId = product.data.data.id;
    expect((await request('PUT', '/admin/products/'+productId, admin, { medicineName: 'Catalog RLS updated' })).status).toBe(200);
    const invalid = await request('PUT', '/admin/products/'+productId, admin, { categoryIds: [], packagingVariants: [{ unitName: 'X'.repeat(100), price: 100 }] });
    expect(invalid.status).toBeGreaterThanOrEqual(400);
    const relations = await owner.query('SELECT count(*)::int AS count FROM medicine_categories WHERE medicine_id=$1 AND category_id=$2', [productId, categoryId]);
    expect(relations.rows[0].count).toBe(1);
    await expect(prisma.withCatalogManagement({ id: ids[0], type: 'employee', role: 'SUPER_ADMIN' }, async tx => {
      await tx.medicine_categories.deleteMany({ where: { medicine_id: productId } });
      await tx.categories.create({ data: { category_name: 'Rollback check', slug: 'duplicate-rollback' } });
      await tx.categories.create({ data: { category_name: 'Rollback check 2', slug: 'duplicate-rollback' } });
    })).rejects.toThrow();
    expect((await owner.query('SELECT count(*)::int AS count FROM medicine_categories WHERE medicine_id=$1 AND category_id=$2', [productId, categoryId])).rows[0].count).toBe(1);
    expect((await request('DELETE', '/admin/categories/'+categoryId, admin)).status).toBe(400);
    expect((await request('DELETE', '/admin/products/'+productId, admin)).status).toBe(200);
    expect((await request('DELETE', '/admin/categories/'+categoryId, admin)).status).toBe(200);
    await expect(prisma.categories.create({ data: { category_name: 'Unauthorized' } })).rejects.toThrow();
  });
});
