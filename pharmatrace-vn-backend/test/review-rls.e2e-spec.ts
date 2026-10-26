import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { AuthModule } from '../src/modules/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { ReviewController } from '../src/modules/review/review.controller';
import { AdminReviewController } from '../src/modules/review/admin-review.controller';
import { ReviewService } from '../src/modules/review/review.service';
import { AdminModerationController } from '../src/modules/moderation/admin-moderation.controller';
import { ContentModerationService } from '../src/modules/moderation/content-moderation.service';
import { CloudinaryService } from '../src/modules/cloudinary/cloudinary.service';
import { ProductController } from '../src/modules/product/product.controller';
import { ProductService } from '../src/modules/product/product.service';

const integration = process.env.REVIEW_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Review HTTP + Prisma + PostgreSQL RLS', () => {
  const a = 930001, b = 930002, admin = 930003, warehouse = 930004;
  const customer = { id: a, type: 'customer' as const, role: 'CUSTOMER' };
  const moderator = { id: admin, type: 'employee' as const, role: 'ADMIN' };
  const pharmacist = { id: a, type: 'employee' as const, role: 'PHARMACIST' };
  let app: INestApplication, owner: Pool, prisma: PrismaService, baseUrl: string, medicine: number;
  let ids: number[], tokens: Record<string, string>;
  const previous = { DATABASE_URL: process.env.DATABASE_URL, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED, JWT_SECRET: process.env.JWT_SECRET };

  async function api(method: string, path: string, status: number, token?: string, body?: unknown) {
    const response = await fetch(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as any;
    expect({ status: response.status, ...(response.status === status ? {} : { result }) }).toEqual({ status });
    return result;
  }
  async function clearReviews() {
    await owner.query('DELETE FROM moderation_audit_logs WHERE performed_by_customer_id = ANY($1::int[]) OR performed_by_employee_id = ANY($2::int[])', [[a, b], [a, admin, warehouse]]);
    await owner.query('DELETE FROM reviews WHERE medicine_id = $1', [medicine]);
  }
  beforeAll(async () => {
    const runtimeUrl = process.env.REVIEW_RLS_TEST_DATABASE_URL!;
    const ownerUrl = process.env.REVIEW_RLS_TEST_ADMIN_URL!;
    for (const value of [runtimeUrl, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_review_rls_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
        throw new Error('Review tests require the disposable localhost pharmatrace_review_rls_test database');
      }
    }
    process.env.DATABASE_URL = runtimeUrl;
    process.env.AUTH_RLS_ENABLED = 'false';
    process.env.JWT_SECRET = 'isolated-review-test-secret-not-for-deployment';
    owner = new Pool({ connectionString: ownerUrl });
    const hash = await bcrypt.hash('ReviewTestOnly2026!', 10);
    await owner.query(`INSERT INTO customers (id, full_name, email, phone_number, password_hash, status)
      VALUES ($1, 'Demo Review A', 'review-a@example.test', '0955550001', $3, 'ACTIVE'),
             ($2, 'Demo Review B', 'review-b@example.test', '0955550002', $3, 'ACTIVE')`, [a, b, hash]);
    for (const [id, role] of [[a, 'PHARMACIST'], [admin, 'ADMIN'], [warehouse, 'WAREHOUSE_STAFF']] as const) {
      await owner.query(`INSERT INTO employees (id, full_name, email, password_hash, role, status)
        VALUES ($1, 'Demo Review Employee', $2, $3, $4, 'ACTIVE')`, [id, `review-${role.toLowerCase()}@example.test`, hash, role]);
    }
    medicine = (await owner.query(`INSERT INTO medicines (medicine_name, unit_price, status, is_prescription)
      VALUES ('Demo Review Medicine', 10, 'ACTIVE', false) RETURNING id`)).rows[0].id;
    const order = (await owner.query(`INSERT INTO orders (order_code, customer_id, order_status)
      VALUES ('DEMO-REVIEW-RLS', $1, 'COMPLETED') RETURNING id`, [a])).rows[0].id;
    await owner.query('INSERT INTO order_items (order_id, medicine_id) VALUES ($1, $2)', [order, medicine]);
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), AuthModule, PrismaModule],
      controllers: [ReviewController, AdminReviewController, AdminModerationController, ProductController],
      providers: [ReviewService, ContentModerationService, ProductService, { provide: CloudinaryService, useValue: {} }],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    tokens = {};
    for (const [name, phone] of [['a', '0955550001'], ['b', '0955550002']]) {
      tokens[name] = (await api('POST', '/auth/login', 200, undefined, { identifier: phone, password: 'ReviewTestOnly2026!' })).data.accessToken;
    }
    for (const role of ['PHARMACIST', 'ADMIN', 'WAREHOUSE_STAFF']) {
      tokens[role] = (await api('POST', '/admin/auth/login', 200, undefined, { email: `review-${role.toLowerCase()}@example.test`, password: 'ReviewTestOnly2026!' })).data.accessToken;
    }
  }, 30000);
  beforeEach(async () => {
    await clearReviews();
    ids = [];
    for (const [author, status] of [[a, 'APPROVED'], [a, 'HIDDEN'], [b, 'HIDDEN'], [b, 'APPROVED']] as const) {
      ids.push((await owner.query(`INSERT INTO reviews (customer_id, medicine_id, rating_stars, comment, status, is_verified_purchase, helpful_count)
        VALUES ($1, $2, 5, 'Carefully packaged product', $3, true, 0) RETURNING id`, [author, medicine, status])).rows[0].id);
    }
  });
  afterAll(async () => {
    if (app) await app.close();
    if (owner) {
      if (medicine) await clearReviews();
      await owner.query('DELETE FROM orders WHERE customer_id = ANY($1::int[])', [[a, b]]);
      if (medicine) await owner.query('DELETE FROM medicines WHERE id = $1', [medicine]);
      await owner.query('DELETE FROM employees WHERE id = ANY($1::int[])', [[a, admin, warehouse]]);
      await owner.query('DELETE FROM customers WHERE id = ANY($1::int[])', [[a, b]]);
      await owner.end();
    }
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it('shows only approved reviews publicly, including product relations and counts', async () => {
    const result = await api('GET', `/products/${medicine}/reviews`, 200);
    expect(result.data.map((r: any) => r.id).sort((x: number, y: number) => x - y)).toEqual([ids[0], ids[3]]);
    expect(result.stats.totalReviews).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/review-[ab]@|095555000/);
    const product = await api('GET', `/products/${medicine}`, 200);
    expect(product.data.reviewsList.map((r: any) => r.id).sort((x: number, y: number) => x - y)).toEqual([ids[0], ids[3]]);
    expect(await prisma.reviews.count({ where: { medicine_id: medicine } })).toBe(2);
  });
  it('isolates customer history and rejects foreign changes and same-ID employees', async () => {
    const mine = await api('GET', '/customer/my-reviews', 200, tokens.a);
    expect(mine.data.map((r: any) => r.id).sort((x: number, y: number) => x - y)).toEqual([ids[0], ids[1]]);
    await api('PATCH', `/customer/reviews/${ids[2]}`, 404, tokens.a, { comment: 'A different comment' });
    await api('DELETE', `/customer/reviews/${ids[3]}`, 403, tokens.a);
    await api('GET', '/customer/my-reviews', 403, tokens.PHARMACIST);
    await api('GET', '/customer/my-reviews', 401);
    const visible = await prisma.withReview('customer', tx => tx.reviews.findMany({ where: { medicine_id: medicine } }), customer);
    expect(visible.map(r => r.id)).not.toContain(ids[2]);
  });
  it('requires a delivered purchase and records successful submissions atomically', async () => {
    expect((await api('GET', `/products/${medicine}/reviews/can-review`, 200, tokens.b)).data.canReview).toBe(false);
    await api('POST', `/products/${medicine}/reviews`, 403, tokens.b, { ratingStars: 5, comment: 'Carefully packaged product' });
    await api('POST', `/products/${medicine}/reviews`, 400, tokens.a, { ratingStars: 5, comment: 'Carefully packaged product', customerId: b });
    const created = await api('POST', `/products/${medicine}/reviews`, 201, tokens.a, { ratingStars: 5, comment: 'Carefully packaged product' });
    expect(created.data.status).toBe('APPROVED');
    expect((await owner.query('SELECT action FROM moderation_audit_logs WHERE review_id = $1', [created.data.id])).rows).toEqual([{ action: 'AUTO_APPROVE' }]);
    await expect(prisma.withReview('customer', tx => tx.reviews.create({ data: {
      customer_id: b, medicine_id: medicine, rating_stars: 5, status: 'APPROVED', is_verified_purchase: true, helpful_count: 0,
    } }), { id: b, type: 'customer', role: 'CUSTOMER' })).rejects.toThrow();
  });
  it('keeps moderated reviews pending even after repeated safe edits', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const edited = await api('PATCH', `/customer/reviews/${ids[1]}`, 200, tokens.a, { comment: 'Carefully packaged product' });
      expect(edited.data.status).toBe('PENDING');
    }
    await expect(prisma.withReview('customer', tx => tx.reviews.update({ where: { id: ids[1] }, data: { status: 'APPROVED' } }), customer)).rejects.toThrow();
  });
  it('allows staff replies but reserves moderation, reports and audit for administrators', async () => {
    const listed = await api('GET', '/admin/reviews', 200, tokens.PHARMACIST);
    expect(JSON.stringify(listed)).not.toMatch(/review-[ab]@|095555000/);
    await api('POST', `/admin/reviews/${ids[1]}/reply`, 201, tokens.PHARMACIST, { reply: 'Thank you for your feedback' });
    await api('PATCH', `/admin/reviews/${ids[1]}/status`, 403, tokens.PHARMACIST, { status: 'APPROVED' });
    await api('DELETE', `/admin/reviews/${ids[1]}`, 403, tokens.PHARMACIST);
    await api('GET', '/admin/moderation/reports', 403, tokens.PHARMACIST);
    await api('GET', '/admin/moderation/audit-logs', 403, tokens.PHARMACIST);
    await api('GET', '/admin/reviews', 403, tokens.WAREHOUSE_STAFF);
    await api('GET', '/admin/reviews', 403, tokens.a);
    await expect(prisma.withReview('staff', tx => tx.reviews.update({ where: { id: ids[1] }, data: { status: 'APPROVED' } }), pharmacist)).rejects.toThrow();
    await api('PATCH', `/admin/reviews/${ids[1]}/status`, 200, tokens.ADMIN, { status: 'APPROVED' });
  });
  it('limits anonymous helpful votes to approved counters and validates the boolean DTO', async () => {
    expect((await api('POST', `/reviews/${ids[0]}/helpful`, 200, undefined, { isUnvote: true })).data.helpfulCount).toBe(0);
    for (let attempt = 0; attempt < 2; attempt++) {
      expect((await api('POST', `/reviews/${ids[0]}/helpful`, 200, undefined, {})).data.helpfulCount).toBe(1);
    }
    expect((await api('POST', `/reviews/${ids[0]}/helpful`, 200, undefined, { isUnvote: true })).data.helpfulCount).toBe(0);
    await api('POST', `/reviews/${ids[1]}/helpful`, 404, undefined, {});
    await api('POST', `/reviews/${ids[0]}/helpful`, 400, undefined, { isUnvote: 'true' });
    await expect(prisma.withReview('helpful', tx => tx.reviews.update({ where: { id: ids[0] }, data: { comment: 'Forged helpful update' } }))).rejects.toThrow();
  });
  it('isolates reports and resolves APPROVE to the valid APPROVED status', async () => {
    const report = await api('POST', `/reviews/${ids[3]}/report`, 201, tokens.a, { reason: 'SPAM' });
    await api('POST', `/reviews/${ids[3]}/report`, 400, tokens.a, { reason: 'SPAM' });
    await api('POST', `/reviews/${ids[2]}/report`, 400, tokens.a, { reason: 'SPAM' });
    await api('POST', `/reviews/${ids[3]}/report`, 403, tokens.PHARMACIST, { reason: 'SPAM' });
    expect(await prisma.withReview('customer', tx => tx.moderation_reports.count(), { id: b, type: 'customer', role: 'CUSTOMER' })).toBe(0);
    await owner.query("UPDATE reviews SET status = 'HIDDEN' WHERE id = $1", [ids[3]]);
    await api('GET', '/admin/moderation/reports', 200, tokens.ADMIN);
    await api('PATCH', `/admin/moderation/reports/${report.data.id}/resolve`, 200, tokens.ADMIN, { actionOnReview: 'APPROVE', note: 'Checked report' });
    expect((await owner.query('SELECT status FROM reviews WHERE id = $1', [ids[3]])).rows[0].status).toBe('APPROVED');
  });
  it('preserves audit records when authors or moderators delete reviews', async () => {
    await api('DELETE', `/customer/reviews/${ids[1]}`, 200, tokens.a);
    await api('DELETE', `/admin/reviews/${ids[2]}`, 200, tokens.ADMIN);
    const logs = (await api('GET', '/admin/moderation/audit-logs', 200, tokens.ADMIN)).data;
    for (const [id, action] of [[ids[1], 'CUSTOMER_DELETE'], [ids[2], 'ADMIN_DELETE']]) {
      expect(logs).toEqual(expect.arrayContaining([expect.objectContaining({ review_id: null, action, meta: expect.objectContaining({ reviewId: id }) })]));
    }
    expect(await prisma.withReview('customer', tx => tx.moderation_audit_logs.count(), customer)).toBe(0);
    for (const sql of ['DELETE FROM moderation_audit_logs', "UPDATE moderation_audit_logs SET reason = 'tampered'", 'TRUNCATE moderation_audit_logs']) {
      await expect(prisma.withReview('moderator', tx => tx.$executeRawUnsafe(sql), moderator)).rejects.toThrow();
    }
  });
  it('rolls back review and audit together and clears pooled transaction context', async () => {
    const moderation = app.get(ContentModerationService);
    await expect(prisma.withReview('moderator', async tx => {
      await tx.reviews.update({ where: { id: ids[1] }, data: { status: 'APPROVED' } });
      await moderation.logAudit({ reviewId: ids[1], action: 'ADMIN_STATUS_APPROVED', employeeId: admin, role: 'ADMIN' }, tx);
      throw new Error('simulated failure');
    }, moderator)).rejects.toThrow('simulated failure');
    expect((await owner.query('SELECT status FROM reviews WHERE id = $1', [ids[1]])).rows[0].status).toBe('HIDDEN');
    expect((await owner.query('SELECT count(*)::int AS count FROM moderation_audit_logs WHERE review_id = $1', [ids[1]])).rows[0].count).toBe(0);
    expect(await prisma.reviews.count({ where: { id: ids[1] } })).toBe(0);
    await expect(prisma.withReview('moderator', async () => true, pharmacist)).rejects.toThrow('Invalid review access scope');
  });
  it('aborts a service mutation when its audit write fails', async () => {
    const audit = jest.spyOn(app.get(ContentModerationService), 'logAudit').mockRejectedValueOnce(new Error('audit unavailable'));
    try {
      await expect(app.get(ReviewService).updateReviewStatus(ids[1], 'APPROVED', admin, 'ADMIN')).rejects.toThrow('audit unavailable');
      expect((await owner.query('SELECT status FROM reviews WHERE id = $1', [ids[1]])).rows[0].status).toBe('HIDDEN');
    } finally {
      audit.mockRestore();
    }
  });
  it('refuses review traffic when database protection is incomplete', async () => {
    await owner.query('ALTER TABLE reviews NO FORCE ROW LEVEL SECURITY');
    try {
      await api('GET', `/products/${medicine}/reviews`, 503);
      await api('PATCH', `/admin/reviews/${ids[1]}/status`, 503, tokens.ADMIN, { status: 'APPROVED' });
    } finally {
      await owner.query('ALTER TABLE reviews FORCE ROW LEVEL SECURITY');
    }
  });
});
