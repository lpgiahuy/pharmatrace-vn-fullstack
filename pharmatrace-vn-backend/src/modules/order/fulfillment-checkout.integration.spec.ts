import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOrderService } from './admin-order.service';
import { OrderService } from './order.service';

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('M1 validated fulfillment checkout with the restricted application role', () => {
  let db: Pool, prisma: PrismaService, finance: AdminOrderService, orders: OrderService;
  let source: number, destination: number, alternate: number, manager: number, driver: number, customer: number;
  const id = async (sql: string, args: unknown[] = []) => Number((await db.query(sql, args)).rows[0].id);
  const actor = () => ({ id: manager, role: 'SUPER_ADMIN', type: 'employee' as const, facilityId: destination });
  const warehouse = () => ({ id: driver, role: 'WAREHOUSE_STAFF', type: 'employee' as const, facilityId: source });
  beforeAll(async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL!);
    if (url.pathname !== '/codex_m1_checkout_20261110') throw new Error('Use the dedicated M1 test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    finance = new AdminOrderService(prisma); orders = new OrderService(prisma);
    source = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Workflow source','PHARMACY',10.77,106.7) RETURNING id");
    destination = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Workflow destination','PHARMACY',10.77,106.7) RETURNING id");
    alternate = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Workflow alternate','PHARMACY',10.77,106.7) RETURNING id");
    manager = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Workflow admin','SUPER_ADMIN',$1) RETURNING id", [destination]);
    driver = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Workflow driver','WAREHOUSE_STAFF',$1) RETURNING id", [source]);
    customer = await id("INSERT INTO customers(full_name) VALUES ('Workflow customer') RETURNING id");
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  async function fixture(_quantity = 1) {
    const medicine = await id("INSERT INTO medicines(medicine_name,status) VALUES ('M1 medicine','ACTIVE') RETURNING id");
    const variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
    const batch = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,status) VALUES ($1,$2,current_date-1,current_date+365,'ACTIVE') RETURNING id", [randomUUID(), medicine]);
    return { medicine, variant, batch };
  }
  async function configure(facility: number, capacity = 1000000) {
    await finance.saveFulfillmentPolicy(facility, { sellingFacilityId: facility, enabled: true, opensMinute: 0, closesMinute: 1440, weekdays: [0, 1, 2, 3, 4, 5, 6], dailyCapacity: capacity, radiusKm: 100, transportConditions: ['APPROVED_STANDARD'] }, actor());
  }
  const options = (medicine: number) => prisma.withOrder('read', tx => tx.$queryRaw<Array<{ facility_id: number; revision: string; requirements_revision: string }>>`SELECT * FROM public.fulfillment_options(${[medicine]}::integer[])`, { id: customer, type: 'customer', role: 'CUSTOMER' });

  it('excludes unconfigured facilities and unclassified medicines, and enforces transport capability', async () => {
    const f = await fixture(); expect(await options(f.medicine)).toEqual([]);
    await configure(destination); expect(await options(f.medicine)).toEqual([]);
    await finance.saveTransportRequirement(f.medicine, 'REFRIGERATED', actor()); expect(await options(f.medicine)).toEqual([]);
    await finance.saveTransportRequirement(f.medicine, 'APPROVED_STANDARD', actor());
    expect((await options(f.medicine)).some(row => row.facility_id === destination)).toBe(true);
  });

  it('excludes facilities on closed days and rejects cross-facility policy changes', async () => {
    const f = await fixture(); await finance.saveTransportRequirement(f.medicine, 'APPROVED_STANDARD', actor());
    const today = Number((await db.query("SELECT extract(dow FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS day")).rows[0].day);
    const closed = { sellingFacilityId: destination, enabled: true, opensMinute: 0, closesMinute: 1440, weekdays: [(today + 1) % 7], dailyCapacity: 1000000, radiusKm: 100, transportConditions: ['APPROVED_STANDARD'] };
    await finance.saveFulfillmentPolicy(alternate, { ...closed, sellingFacilityId: alternate }, actor());
    expect((await options(f.medicine)).some(row => row.facility_id === alternate)).toBe(false);
    await expect(finance.saveFulfillmentPolicy(destination, closed, { ...warehouse(), role: 'STORE_MANAGER' })).rejects.toThrow(/role|manager/i);
  });

  it('serializes checkout capacity and rejects a stale policy revision', async () => {
    const facility = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Capacity facility','PHARMACY',10.77,106.7) RETURNING id");
    const f = await fixture(1); await configure(facility, 1); await finance.saveTransportRequirement(f.medicine, 'APPROVED_STANDARD', actor());
    const policy = (await options(f.medicine)).find(row => row.facility_id === facility)!;
    const accept = () => prisma.withOrder('checkout', async tx => {
      const order = await tx.orders.create({ data: { order_code: randomUUID(), customer_id: customer, export_facility_id: facility, order_status: 'PENDING' } });
      await tx.order_items.createMany({ data: [{ order_id: order.id, medicine_id: f.medicine, variant_id: f.variant, quantity: 1, source_facility_id: facility }] });
      await tx.$executeRaw`SELECT public.accept_fulfillment_terms(${order.id}, ${policy.revision}::text, ${policy.requirements_revision}::text, ${1}::numeric, ${[facility]}::integer[], ${[f.medicine]}::integer[])`;
    }, { id: customer, type: 'customer', role: 'CUSTOMER' });
    const results = await Promise.allSettled([accept(), accept()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('SELECT count(*)::int AS n FROM order_fulfillment_terms t JOIN orders o ON o.id=t.order_id WHERE o.export_facility_id=$1', [facility])).rows[0].n).toBe(1);
    await configure(facility, 2);
    await expect(accept()).rejects.toThrow(/policy changed/i);
  });

  it('quotes and creates an order with accepted selling/dispatch terms, and rejects out-of-radius addresses', async () => {
    const f = await fixture(1);
    await configure(destination); await finance.saveTransportRequirement(f.medicine, 'APPROVED_STANDARD', actor());
    await db.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,1,0)', [destination, f.variant]);
    await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) VALUES ($1,$2,'IN_STOCK')", [f.batch, destination]);
    const request = { items: [{ variantId: f.variant, quantity: 1 }], paymentMethod: 'COD' as const, shippingAddress: 'Verified test address', recipientName: 'Test buyer', recipientPhone: '0900000000', latitude: 10.77, longitude: 106.7 };
    const quote = await orders.createOrder(customer, request, true);
    if (!('planHash' in quote)) throw new Error('Expected delivery quote');
    expect(quote).toMatchObject({ facilityId: destination, sellingFacilityId: destination });
    const order = await orders.createOrder(customer, { ...request, expectedPlanHash: quote.planHash });
    if (!('id' in order)) throw new Error('Expected created order');
    expect((await db.query('SELECT selling_facility_id FROM order_fulfillment_terms WHERE order_id=$1', [order.id])).rows[0].selling_facility_id).toBe(destination);
    const otherCustomer = await id("INSERT INTO customers(full_name) VALUES ('Other M1 customer') RETURNING id");
    await expect(orders.getMyOrderById(otherCustomer, order.id)).rejects.toThrow(/not found/i);
    await expect(orders.createOrder(customer, { ...request, latitude: 21, longitude: 105.8 }, true)).rejects.toThrow(/suitable fulfillment/i);
  });

  it('restricts sellers, link administration and stale checkout without rewriting accepted orders', async () => {
    const f = await fixture(1);
    const depot = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Linked warehouse','BRANCH_WAREHOUSE',10.77,106.7) RETURNING id");
    const policy = { sellingFacilityId: destination, enabled: true, opensMinute: 0, closesMinute: 1440, weekdays: [0, 1, 2, 3, 4, 5, 6], dailyCapacity: 1000000, radiusKm: 100, transportConditions: ['APPROVED_STANDARD'] };
    await expect(finance.saveFulfillmentPolicy(source, policy, actor())).rejects.toThrow(/sell for itself/i);
    await expect(finance.saveFulfillmentPolicy(depot, policy, actor())).rejects.toThrow(/linked selling pharmacy/i);
    await expect(finance.setWarehouseSellingPharmacies(depot, [destination], { ...actor(), role: 'STORE_MANAGER' })).rejects.toThrow(/role|facility/i);
    await expect(finance.setWarehouseSellingPharmacies(source, [destination], actor())).rejects.toThrow(/warehouse/i);
    await expect(finance.setWarehouseSellingPharmacies(depot, [depot], actor())).rejects.toThrow(/valid selling pharmacies/i);
    await finance.setWarehouseSellingPharmacies(depot, [destination, alternate], actor());
    await finance.saveFulfillmentPolicy(depot, policy, actor());
    await finance.saveTransportRequirement(f.medicine, 'APPROVED_STANDARD', actor());
    expect(await finance.getFulfillmentPolicies(actor())).toMatchObject({ warehouseLinks: expect.arrayContaining([{ warehouse_id: depot, pharmacy_id: destination }]) });
    const quote = (await options(f.medicine)).find(row => row.facility_id === depot)!;
    const accept = () => prisma.withOrder('checkout', async tx => {
      const order = await tx.orders.create({ data: { order_code: randomUUID(), customer_id: customer, export_facility_id: depot, order_status: 'PENDING' } });
      await tx.order_items.createMany({ data: [{ order_id: order.id, medicine_id: f.medicine, variant_id: f.variant, quantity: 1, source_facility_id: depot }] });
      await tx.$executeRaw`SELECT public.accept_fulfillment_terms(${order.id}, ${quote.revision}::text, ${quote.requirements_revision}::text, ${1}::numeric, ${[depot]}::integer[], ${[f.medicine]}::integer[])`;
      return order.id;
    }, { id: customer, type: 'customer', role: 'CUSTOMER' });
    const accepted = await accept();
    const snapshot = (await db.query('SELECT * FROM order_fulfillment_terms WHERE order_id=$1', [accepted])).rows[0];
    await finance.setWarehouseSellingPharmacies(depot, [alternate], actor());
    expect((await options(f.medicine)).some(row => row.facility_id === depot)).toBe(false);
    await expect(accept()).rejects.toThrow(/policy changed/i);
    await finance.saveFulfillmentPolicy(depot, { ...policy, sellingFacilityId: alternate }, actor());
    expect((await db.query('SELECT * FROM order_fulfillment_terms WHERE order_id=$1', [accepted])).rows[0]).toEqual(snapshot);
    await expect(prisma.withOrder('read', tx => tx.$executeRaw`DELETE FROM public.warehouse_selling_pharmacies WHERE warehouse_id=${depot}`, actor())).rejects.toThrow(/permission denied/i);
  });
});
