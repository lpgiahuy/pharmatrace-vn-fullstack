import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { AuthModule } from '../src/modules/auth/auth.module';
import { LogisticsModule } from '../src/modules/logistics/logistics.module';
import { OrderModule } from '../src/modules/order/order.module';

const integration = process.env.LOGISTICS_RLS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Logistics HTTP + real runtime RLS', () => {
  let app: INestApplication, owner: Pool, baseUrl: string;
  let source: number, destination: number, employee: number, receiver: number, medicine: number, variant: number, batch: number, customer: number, otherCustomer: number;
  const orders: number[] = [], transfers: number[] = [];
  let shipment: number;
  let sourceToken: string, destinationToken: string, customerToken: string, otherCustomerToken: string;
  const previous = { DATABASE_URL: process.env.DATABASE_URL, JWT_SECRET: process.env.JWT_SECRET, AUTH_RLS_ENABLED: process.env.AUTH_RLS_ENABLED };

  async function api(method: string, path: string, token: string, body?: unknown) {
    const response = await fetch(baseUrl + '/admin/logistics' + path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  beforeAll(async () => {
    const runtimeUrl = process.env.LOGISTICS_RLS_TEST_DATABASE_URL!;
    const ownerUrl = process.env.LOGISTICS_RLS_TEST_ADMIN_URL!;
    for (const value of [runtimeUrl, ownerUrl]) {
      const url = new URL(value);
      if (url.pathname !== '/pharmatrace_logistics_test' || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Use the isolated localhost pharmatrace_logistics_test database');
    }
    process.env.DATABASE_URL = runtimeUrl;
    process.env.JWT_SECRET = 'isolated-logistics-test-secret';
    process.env.AUTH_RLS_ENABLED = 'true';
    owner = new Pool({ connectionString: ownerUrl });
    customer = (await owner.query("INSERT INTO customers(full_name,status) VALUES ('Logistics E2E customer','ACTIVE') RETURNING id")).rows[0].id;
    otherCustomer = (await owner.query("INSERT INTO customers(full_name,status) VALUES ('Logistics E2E other customer','ACTIVE') RETURNING id")).rows[0].id;
    source = (await owner.query("INSERT INTO facilities(facility_name,facility_type) VALUES ('Logistics E2E source','PHARMACY') RETURNING id")).rows[0].id;
    destination = (await owner.query("INSERT INTO facilities(facility_name,facility_type) VALUES ('Logistics E2E destination','PHARMACY') RETURNING id")).rows[0].id;
    employee = (await owner.query("INSERT INTO employees(full_name,role,status,facility_id) VALUES ('Logistics E2E transporter','WAREHOUSE_STAFF','ACTIVE',$1) RETURNING id", [source])).rows[0].id;
    receiver = (await owner.query("INSERT INTO employees(full_name,role,status,facility_id) VALUES ('Logistics E2E receiver','STORE_MANAGER','ACTIVE',$1) RETURNING id", [destination])).rows[0].id;
    medicine = (await owner.query("INSERT INTO medicines(medicine_name) VALUES ('Logistics E2E medicine') RETURNING id")).rows[0].id;
    variant = (await owner.query("INSERT INTO packaging_variants(medicine_id,unit_name) VALUES ($1,'Box') RETURNING id", [medicine])).rows[0].id;
    batch = (await owner.query("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,initial_quantity,remaining_quantity) VALUES ($1,$2,CURRENT_DATE-1,CURRENT_DATE+365,4,4) RETURNING id", ['LOG-E2E-' + Date.now(), medicine])).rows[0].id;
    await owner.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$3,4,4),($2,$3,0,0)', [source, destination, variant]);
    for (let index = 0; index < 2; index++) {
      const id = (await owner.query("INSERT INTO orders(order_code,export_facility_id,order_status,prescription_review_status) VALUES ($1,$2,'WAITING_INTERNAL_TRANSFER','APPROVED') RETURNING id", ['LOG-E2E-' + Date.now() + '-' + index, destination])).rows[0].id;
      orders.push(id);
      const boxes = await owner.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) VALUES ($1,$2,'RESERVED'),($1,$2,'RESERVED') RETURNING uid", [batch, source]);
      await owner.query("INSERT INTO order_items(order_id,medicine_id,variant_id,unit_name,quantity,source_facility_id,inventory_reserved,assigned_uids) VALUES ($1,$2,$3,'Box',2,$4,true,$5::uuid[])", [id, medicine, variant, source, boxes.rows.map((box: { uid: string }) => box.uid)]);
      transfers.push((await owner.query("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,items) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id", ['LOG-E2E-' + id, id, source, destination, JSON.stringify([{ variantId: variant, medicineId: medicine, quantity: 2 }])])).rows[0].id);
    }
    const shippingOrder = (await owner.query("INSERT INTO orders(order_code,export_facility_id,customer_id,order_status,payment_method,total_amount) VALUES ($1,$2,$3,'SHIPPING','COD',100) RETURNING id", ['LOG-E2E-SHIP-' + Date.now(), destination, customer])).rows[0].id;
    orders.push(shippingOrder);
    shipment = (await owner.query("INSERT INTO shipments(order_id,tracking_number,cod_amount) VALUES ($1,$2,100) RETURNING id", [shippingOrder, 'TEMP-' + shippingOrder])).rows[0].id;
    const module = await Test.createTestingModule({ imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule, LogisticsModule, OrderModule] }).compile();
    app = module.createNestApplication({ logger: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const jwt = new JwtService({ secret: process.env.JWT_SECRET });
    sourceToken = jwt.sign({ id: employee, type: 'employee', role: 'WAREHOUSE_STAFF', facilityId: source });
    destinationToken = jwt.sign({ id: receiver, type: 'employee', role: 'STORE_MANAGER', facilityId: destination });
    customerToken = jwt.sign({ id: customer, type: 'customer', role: 'CUSTOMER' });
    otherCustomerToken = jwt.sign({ id: otherCustomer, type: 'customer', role: 'CUSTOMER' });
  }, 30000);

  afterAll(async () => {
    if (owner && orders.length) {
      await owner.query('DELETE FROM logistics_cod_settlements WHERE shipment_id IN (SELECT id FROM shipments WHERE order_id=ANY($1::int[]))', [orders]);
      await owner.query('DELETE FROM cashbook_logs WHERE order_id=ANY($1::int[])', [orders]);
      await owner.query('DELETE FROM logistics_events WHERE transfer_id=ANY($1::int[]) OR shipment_id=$2', [transfers, shipment || 0]);
      await owner.query('DELETE FROM orders WHERE id=ANY($1::int[])', [orders]);
      await owner.query('DELETE FROM inventory_logs WHERE medicine_id=$1', [medicine]);
      await owner.query('DELETE FROM medicine_boxes WHERE batch_id=$1', [batch]);
      await owner.query('DELETE FROM inventories WHERE variant_id=$1', [variant]);
      await owner.query('DELETE FROM batches WHERE id=$1', [batch]);
      await owner.query('DELETE FROM packaging_variants WHERE id=$1', [variant]);
      await owner.query('DELETE FROM medicines WHERE id=$1', [medicine]);
      await owner.query('DELETE FROM employees WHERE id=ANY($1::int[])', [[employee, receiver]]);
      await owner.query('DELETE FROM facilities WHERE id=ANY($1::int[])', [[source, destination]]);
      await owner.query('DELETE FROM customers WHERE id=ANY($1::int[])', [[customer, otherCustomer]]);
    }
    if (app) await app.close();
    if (owner) await owner.end();
    for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  });

  it('validates transport methods and restricts employee selection to the source', async () => {
    const staff = await api('GET', `/transfers/${transfers[0]}/transport-staff`, sourceToken);
    expect(staff.status).toBe(200);
    expect(staff.body.data).toEqual([{ id: employee, full_name: 'Logistics E2E transporter' }]);
    expect((await api('GET', `/transfers/${transfers[0]}/transport-staff`, destinationToken)).status).toBe(404);
    expect((await api('PATCH', `/transfers/${transfers[0]}/dispatch`, sourceToken, {})).status).toBe(400);
    expect((await api('PATCH', `/transfers/${transfers[0]}/dispatch`, sourceToken, { transportMode: 'INTERNAL', transportEmployeeId: receiver })).status).toBe(400);
    expect((await api('PATCH', `/transfers/${transfers[0]}/dispatch`, sourceToken, { transportMode: 'INTERNAL', transportEmployeeId: employee })).status).toBe(200);
  });

  it('receives internal transport only at the destination, exactly once with physical UIDs', async () => {
    expect((await api('PATCH', `/transfers/${transfers[0]}/receive`, sourceToken, {})).status).toBe(403);
    const received = await Promise.all([api('PATCH', `/transfers/${transfers[0]}/receive`, destinationToken, {}), api('PATCH', `/transfers/${transfers[0]}/receive`, destinationToken, {})]);
    expect(received.map(result => result.status)).toEqual([200, 200]);
    const inventory = (await owner.query('SELECT stock_quantity,reserved_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [destination, variant])).rows[0];
    expect(inventory).toEqual({ stock_quantity: 2, reserved_quantity: 2 });
    expect((await owner.query('SELECT count(*)::int AS n FROM medicine_boxes WHERE batch_id=$1 AND current_facility_id=$2', [batch, destination])).rows[0].n).toBe(2);
  });

  it('receives third-party transport through the same destination checks', async () => {
    expect((await api('PATCH', `/transfers/${transfers[1]}/dispatch`, sourceToken, { transportMode: 'THIRD_PARTY', courierName: 'GHN' })).status).toBe(400);
    const result = await api('PATCH', `/transfers/${transfers[1]}/dispatch`, sourceToken, { transportMode: 'THIRD_PARTY', courierName: 'GHN', trackingCode: 'CARRIER-' + transfers[1] });
    expect(result.status).toBe(200);
    expect(result.body.data.transport_employee_id).toBeNull();
    expect((await api('PATCH', `/transfers/${transfers[1]}/receive`, destinationToken, {})).status).toBe(200);
    expect((await owner.query('SELECT stock_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [destination, variant])).rows[0].stock_quantity).toBe(4);
    expect((await owner.query('SELECT order_status FROM orders WHERE id=ANY($1::int[])', [orders.slice(0, 2)])).rows.every(row => row.order_status === 'PROCESSING')).toBe(true);
  });

  it('lets only the customer confirm delivery and collects COD once', async () => {
    const receipt = async (token: string) => {
      const response = await fetch(baseUrl + `/orders/${orders[2]}/confirm-receipt`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}` } });
      return { status: response.status, body: await response.json() };
    };
    expect((await receipt(otherCustomerToken)).status).toBe(404);
    expect((await receipt(customerToken)).status).toBe(400);
    expect((await api('PATCH', `/shipments/${shipment}/status`, destinationToken, { status: 'PICKED_UP' })).status).toBe(400);
    expect((await api('PATCH', `/shipments/${shipment}/carrier`, destinationToken, { courierName: 'GHN', trackingNumber: 'REAL-' + shipment })).status).toBe(200);
    for (const status of ['PICKED_UP', 'IN_TRANSIT']) expect((await api('PATCH', `/shipments/${shipment}/status`, destinationToken, { status })).status).toBe(200);
    expect((await api('PATCH', `/shipments/${shipment}/status`, destinationToken, { status: 'DELIVERED' })).status).toBe(400);
    const receipts = await Promise.all([receipt(customerToken), receipt(customerToken)]);
    expect(receipts.map(value => value.status)).toEqual([200, 200]);
    expect(receipts[0].body.data.orderStatus).toBe('COMPLETED');
    expect((await api('PATCH', `/shipments/${shipment}/carrier`, destinationToken, { courierName: 'GHTK', trackingNumber: 'REPLACED' })).status).toBe(400);
    expect((await api('POST', `/shipments/${shipment}/return`, destinationToken, { reason: 'Customer wants to return' })).status).toBe(400);
    const results = await Promise.all([api('PATCH', `/${shipment}/collect`, destinationToken, {}), api('PATCH', `/${shipment}/collect`, destinationToken, {})]);
    expect(results.map(result => result.status)).toEqual([200, 200]);
    expect(results[0].body.data.cashbookId).toBe(results[1].body.data.cashbookId);
    expect((await owner.query('SELECT count(*)::int AS n FROM cashbook_logs WHERE order_id=$1', [orders[2]])).rows[0].n).toBe(1);
    const detail = await api('GET', `/shipments/${shipment}`, destinationToken);
    expect(detail.body.data.history.some((event: { reason: string | null }) => event.reason?.includes('Carrier updated'))).toBe(true);
    expect(detail.body.data.history.some((event: { new_status: string; actor_type: string; actor_name: string | null }) => event.new_status === 'DELIVERED' && event.actor_type === 'customer' && event.actor_name === null)).toBe(true);
    expect(detail.body.data.history.some((event: { actor_type: string; actor_name: string | null }) => event.actor_type === 'employee' && event.actor_name === 'Logistics E2E receiver')).toBe(true);
  });
});
