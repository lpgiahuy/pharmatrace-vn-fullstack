import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { InternalTransferService } from './internal-transfer/internal-transfer.service';
import { AdminOrderService } from '../order/admin-order.service';
import { OrderService } from '../order/order.service';
import { OrderCronService } from '../order/order-cron.service';
import { LogisticsService } from './shipment/logistics.service';

const integration = process.env.WORKFLOW_TEST_DATABASE_URL ? describe : describe.skip;
integration('Logistics workflow gaps using the restricted application role', () => {
  let db: Pool, prisma: PrismaService, transfers: InternalTransferService, finance: AdminOrderService, orders: OrderService;
  let source: number, destination: number, alternate: number, manager: number, driver: number, customer: number;
  const id = async (sql: string, args: unknown[] = []) => Number((await db.query(sql, args)).rows[0].id);
  const actor = () => ({ id: manager, role: 'SUPER_ADMIN', type: 'employee' as const, facilityId: destination });
  const warehouse = () => ({ id: driver, role: 'WAREHOUSE_STAFF', type: 'employee' as const, facilityId: source });
  beforeAll(async () => {
    const url = new URL(process.env.WORKFLOW_TEST_DATABASE_URL!);
    if (!['/codex_logistics_workflows_20261109', '/codex_logistics_workflows_20261110', '/codex_logistics_cleanup_fresh_20261110', '/codex_logistics_cleanup_legacy_20261110', '/codex_selling_links_test_20261110'].includes(url.pathname)) throw new Error('Use a dedicated workflow test database');
    db = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString(); prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    transfers = new InternalTransferService(prisma); finance = new AdminOrderService(prisma); orders = new OrderService(prisma);
    source = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Workflow source','PHARMACY',10.77,106.7) RETURNING id");
    destination = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Workflow destination','PHARMACY',10.77,106.7) RETURNING id");
    alternate = await id("INSERT INTO facilities(facility_name,facility_type,latitude,longitude) VALUES ('Workflow alternate','PHARMACY',10.77,106.7) RETURNING id");
    manager = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Workflow admin','SUPER_ADMIN',$1) RETURNING id", [destination]);
    driver = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Workflow driver','WAREHOUSE_STAFF',$1) RETURNING id", [source]);
    customer = await id("INSERT INTO customers(full_name) VALUES ('Workflow customer') RETURNING id");
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await db?.end(); });

  async function fixture(quantity = 10) {
    const medicine = await id("INSERT INTO medicines(medicine_name,status) VALUES ('Workflow medicine','ACTIVE') RETURNING id");
    const variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name,price) VALUES ($1,'Box',100) RETURNING id", [medicine]);
    const batch = await id("INSERT INTO batches(batch_number,medicine_id,production_date,expiry_date,status) VALUES ($1,$2,current_date-1,current_date+365,'ACTIVE') RETURNING id", [randomUUID(), medicine]);
    const order = await id("INSERT INTO orders(order_code,customer_id,export_facility_id,order_status,payment_method,payment_status,subtotal_amount,total_amount) VALUES ($1,$2,$3,'WAITING_INTERNAL_TRANSFER','COD','UNPAID',$4,$4) RETURNING id", [randomUUID(), customer, destination, quantity * 100]);
    const uids = Array.from({ length: quantity }, () => randomUUID());
    await db.query("INSERT INTO medicine_boxes(uid,batch_id,current_facility_id,status) SELECT unnest($1::uuid[]),$2,$3,'RESERVED'", [uids, batch, source]);
    await db.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,$3,$3)', [source, variant, quantity]);
    await db.query("INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,unit_price,total_price,unit_name,source_facility_id,assigned_uids,inventory_reserved) VALUES ($1,$2,$3,$4,100,$4*100,'Box',$5,$6,true)", [order, medicine, variant, quantity, source, uids]);
    const transfer = await id("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES ($1,$2,$3,$4,'REQUESTED',$5) RETURNING id", [randomUUID(), order, source, destination, JSON.stringify([{ variantId: variant, medicineId: medicine, quantity, unitName: 'Box' }])]);
    const dispatch = () => transfers.adminDispatchInternalTransfer(transfer, { transportMode: 'INTERNAL', transportEmployeeId: driver, manifest: [{ variantId: variant, quantity, boxUids: uids }] }, warehouse());
    const inspect = (good = quantity, damaged = 0) => transfers.adminReceiveInternalTransfer(transfer, actor(), { lines: [{ variantId: variant, receivedQuantity: good, damagedQuantity: damaged, missingQuantity: quantity - good - damaged, goodUids: uids.slice(0, good), damagedUids: uids.slice(good, good + damaged) }] });
    return { medicine, variant, batch, order, uids, transfer, dispatch, inspect };
  }
  const inventory = async (facility: number, variant: number) => (await db.query('SELECT stock_quantity,reserved_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [facility, variant])).rows[0];

  it('blocks standalone transfer cancellation and reroute without changing stock or accepted routing', async () => {
    const f = await fixture(2);
    await expect(transfers.cancelTransfer(f.transfer, warehouse())).rejects.toThrow(/entire order/i);
    await f.dispatch();
    await expect(transfers.adminRerouteTransfer(f.transfer, { newToFacilityId: alternate, reason: 'Different destination' }, actor())).rejects.toThrow(/accepted delivery plan/i);
    expect(await inventory(source, f.variant)).toEqual({ stock_quantity: 0, reserved_quantity: 0 });
    expect((await db.query('SELECT export_facility_id FROM orders WHERE id=$1', [f.order])).rows[0].export_facility_id).toBe(destination);
  });

  async function paidCancellation() {
    const f = await fixture(2);
    await db.query("UPDATE orders SET order_status='PENDING',payment_method='BANK_TRANSFER' WHERE id=$1", [f.order]);
    const receipt = await finance.submitOnlinePayment(f.order, { amount: 200, paymentMethod: 'BANK_TRANSFER', paymentReference: randomUUID() }, actor());
    await finance.approveOnlinePayment(f.order, receipt.id, actor());
    await finance.adminUpdateOrderStatus(f.order, { orderStatus: 'CANCELLED', note: 'Customer requested cancellation' }, actor());
    return f;
  }

  it('audits staff cancellation and records a full refund only after approval and actual evidence, once', async () => {
    const f = await paidCancellation();
    const state = await finance.getOrderResolution(f.order, actor());
    expect(state.cancellations).toEqual([expect.objectContaining({ cancelled_by: manager, reason: 'Customer requested cancellation', cancelled_at: expect.any(Date) })]);
    expect(await inventory(source, f.variant)).toEqual({ stock_quantity: 2, reserved_quantity: 0 });
    await expect(finance.recordCancellationRefund(f.order, { amount: 200, paymentReference: randomUUID() }, actor())).rejects.toThrow(/approved refund/i);
    await expect(finance.approveCancellationRefund(f.order, { amount: 201, paymentMethod: 'BANK_TRANSFER', reason: 'Test' }, actor())).rejects.toThrow(/full refund/i);
    await expect(finance.approveCancellationRefund(f.order, { amount: 200, paymentMethod: 'BANK_TRANSFER', reason: 'Cancelled' }, warehouse())).rejects.toThrow(/role|authorized/i);
    await finance.approveCancellationRefund(f.order, { amount: 200, paymentMethod: 'BANK_TRANSFER', reason: 'Cancelled' }, actor());
    expect((await db.query('SELECT payment_status FROM orders WHERE id=$1', [f.order])).rows[0].payment_status).toBe('PAID');
    await expect(finance.recordCancellationRefund(f.order, { amount: 199, paymentReference: randomUUID() }, actor())).rejects.toThrow(/approved refund/i);
    const evidence = { amount: 200, paymentReference: randomUUID() };
    await Promise.all([finance.recordCancellationRefund(f.order, evidence, actor()), finance.recordCancellationRefund(f.order, evidence, actor())]);
    expect((await db.query("SELECT count(*)::int AS n FROM cashbook_logs WHERE order_id=$1 AND category='CUSTOMER_REFUND'", [f.order])).rows[0].n).toBe(1);
    expect((await db.query('SELECT payment_status FROM orders WHERE id=$1', [f.order])).rows[0].payment_status).toBe('REFUNDED');
    const second = await paidCancellation();
    await finance.approveCancellationRefund(second.order, { amount: 200, paymentMethod: 'BANK_TRANSFER', reason: 'Cancelled' }, actor());
    await expect(finance.recordCancellationRefund(second.order, evidence, actor())).rejects.toThrow(/reference|unique/i);
    expect((await db.query('SELECT payment_status FROM orders WHERE id=$1', [second.order])).rows[0].payment_status).toBe('PAID');
  });

  it.each(['DELIVERED','NOT_DELIVERED'])('closes a delivery dispute with %s and applies loyalty eligibility', async outcome => {
    const f = await fixture(2);
    const receipt = new LogisticsService(prisma);
    await db.query("UPDATE orders SET order_status='COMPLETED',payment_method='CASH',payment_status='PAID' WHERE id=$1", [f.order]);
    const ship = await id("INSERT INTO shipments(order_id,tracking_number,shipping_status,actual_delivery_at,proof_type,proof_reference,delivered_to_name) VALUES ($1,gen_random_uuid()::text,'DELIVERED',now()-interval '8 days','PHOTO','proof','Buyer') RETURNING id", [f.order]);
    await receipt.disputeDelivery(ship, customer, 'Package was not received');
    const cron = new OrderCronService(prisma);
    await cron.awardPointsForCompletedOrders();
    expect((await db.query("SELECT count(*)::int AS n FROM loyalty_point_logs WHERE order_id=$1 AND transaction_type='EARN'", [f.order])).rows[0].n).toBe(0);
    await expect(finance.resolveDeliveryDispute(f.order, { outcome, reason: 'Investigation' }, warehouse())).rejects.toThrow(/role|authorized/i);
    await finance.resolveDeliveryDispute(f.order, { outcome, reason: 'Investigation completed' }, actor());
    await expect(finance.resolveDeliveryDispute(f.order, { outcome, reason: 'Second decision' }, actor())).rejects.toThrow(/open dispute/i);
    await cron.awardPointsForCompletedOrders();
    expect((await db.query("SELECT count(*)::int AS n FROM loyalty_point_logs WHERE order_id=$1 AND transaction_type='EARN'", [f.order])).rows[0].n).toBe(outcome === 'DELIVERED' ? 1 : 0);
    expect((await db.query('SELECT * FROM delivery_disputes WHERE order_id=$1', [f.order])).rows[0]).toMatchObject({ outcome, resolved_by: manager, resolution_reason: 'Investigation completed', resolved_at: expect.any(Date) });
  });

  it('refunds allocated exceptional payments through cancellation approval without leaving refundable allocated funds', async () => {
    const f = await fixture(2);
    await db.query("UPDATE orders SET order_status='PENDING',payment_method='BANK_TRANSFER' WHERE id=$1", [f.order]);
    const payment = await finance.recordPaymentException(f.order, { amount: 200, paymentMethod: 'BANK_TRANSFER', paymentReference: randomUUID(), reason: 'Manual received payment' }, actor());
    await finance.resolvePaymentException(f.order, payment.id, { action: 'APPROVE', reference: randomUUID(), reason: 'Verified receipt' }, actor());
    await finance.resolvePaymentException(f.order, payment.id, { action: 'APPLY', amount: 200, reference: randomUUID(), reason: 'Apply full payment' }, actor());
    await finance.adminUpdateOrderStatus(f.order, { orderStatus: 'CANCELLED', note: 'Customer cancellation' }, actor());
    await expect(finance.resolvePaymentException(f.order, payment.id, { action: 'REFUND', amount: 200, reference: randomUUID(), reason: 'Bypass refund approval' }, actor())).rejects.toThrow(/funds/i);
    await finance.approveCancellationRefund(f.order, { amount: 200, paymentMethod: 'BANK_TRANSFER', reason: 'Full cancellation' }, actor());
    await finance.recordCancellationRefund(f.order, { amount: 200, paymentReference: randomUUID() }, actor());
    expect((await db.query('SELECT allocated,refunded FROM payment_exceptions WHERE id=$1', [payment.id])).rows[0]).toEqual({ allocated: '0.00', refunded: '200.00' });
    await expect(finance.resolvePaymentException(f.order, payment.id, { action: 'REFUND', amount: 200, reference: randomUUID(), reason: 'Second refund' }, actor())).rejects.toThrow(/funds/i);
  });

  it('reverses previously earned points when a delivery dispute confirms non-delivery', async () => {
    const f = await fixture(2);
    await db.query("UPDATE orders SET order_status='COMPLETED',payment_method='CASH',payment_status='PAID' WHERE id=$1", [f.order]);
    const ship = await id("INSERT INTO shipments(order_id,tracking_number,shipping_status,actual_delivery_at,proof_type,proof_reference,delivered_to_name) VALUES ($1,gen_random_uuid()::text,'DELIVERED',now()-interval '8 days','PHOTO','proof','Buyer') RETURNING id", [f.order]);
    await new OrderCronService(prisma).awardPointsForCompletedOrders();
    await new LogisticsService(prisma).disputeDelivery(ship, customer, 'Not received');
    await finance.resolveDeliveryDispute(f.order, { outcome: 'NOT_DELIVERED', reason: 'Carrier confirmed wrong address' }, actor());
    expect((await db.query("SELECT sum(points)::int AS points FROM loyalty_point_logs WHERE order_id=$1 AND transaction_type IN ('EARN','EARN_REVERSAL')", [f.order])).rows[0].points).toBe(0);
  });

  it('can conclude delivered after an audited customer receipt and preserves the conclusion on duplicate dispute submission', async () => {
    const f = await fixture(1);
    await db.query("UPDATE orders SET order_status='SHIPPING' WHERE id=$1", [f.order]);
    const ship = await id("INSERT INTO shipments(order_id,tracking_number,shipping_status) VALUES ($1,gen_random_uuid()::text,'IN_TRANSIT') RETURNING id", [f.order]);
    await orders.confirmReceipt(customer, f.order);
    const logistics = new LogisticsService(prisma);
    await logistics.disputeDelivery(ship, customer, 'Delivery concern');
    await finance.resolveDeliveryDispute(f.order, { outcome: 'DELIVERED', reason: 'Customer receipt confirmed in audit history' }, actor());
    await logistics.disputeDelivery(ship, customer, 'Duplicate request');
    expect((await db.query('SELECT reason,outcome FROM delivery_disputes WHERE order_id=$1', [f.order])).rows[0]).toEqual({ reason: 'Delivery concern', outcome: 'DELIVERED' });
  });

  it('rejects a refund reference already used by another financial workflow', async () => {
    const f = await paidCancellation();
    await finance.approveCancellationRefund(f.order, { amount: 200, paymentMethod: 'BANK_TRANSFER', reason: 'Cancelled' }, actor());
    const reference = randomUUID();
    await finance.recordCancellationRefund(f.order, { amount: 200, paymentReference: reference }, actor());
    const order = await paymentOrder('CANCELLED');
    const receipt = await exception(order, 100);
    await decision(order, receipt, 'APPROVE');
    await expect(decision(order, receipt, 'REFUND', 100, reference)).rejects.toThrow(/reference/i);
    expect((await db.query('SELECT refunded FROM payment_exceptions WHERE id=$1', [receipt])).rows[0].refunded).toBe('0.00');
  });

  it('removes source on-hand stock at dispatch, preserves transport custody, and receives only once', async () => {
    const f = await fixture(); await f.dispatch();
    expect(await inventory(source, f.variant)).toEqual({ stock_quantity: 0, reserved_quantity: 0 });
    expect((await db.query('SELECT DISTINCT status,current_facility_id FROM medicine_boxes WHERE uid=ANY($1::uuid[])', [f.uids])).rows).toEqual([{ status: 'IN_TRANSIT', current_facility_id: null }]);
    const results = await Promise.allSettled([f.inspect(), f.inspect()]);
    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    expect(await inventory(destination, f.variant)).toEqual({ stock_quantity: 10, reserved_quantity: 10 });
    expect(await inventory(source, f.variant)).toEqual({ stock_quantity: 0, reserved_quantity: 0 });
    expect((await db.query('SELECT outstanding FROM transfer_custody WHERE transfer_id=$1', [f.transfer])).rows[0].outstanding).toBe(0);
  });

  it('completes transfer, packing, handoff, delivery proof and approved COD without double stock or cash movements', async () => {
    const f = await fixture(2);
    const logistics = new LogisticsService(prisma);
    await f.dispatch();
    await f.inspect();
    await finance.adminPackOrder(f.order, { boxUids: f.uids }, actor());
    const ship = (await db.query('SELECT id FROM shipments WHERE order_id=$1', [f.order])).rows[0].id;
    expect(await inventory(destination, f.variant)).toEqual({ stock_quantity: 0, reserved_quantity: 0 });
    await logistics.updateCarrier(ship, { courierName: 'GHN', trackingNumber: randomUUID() }, actor());
    await logistics.changeStatus(ship, { status: 'PICKED_UP' }, actor());
    await logistics.changeStatus(ship, { status: 'IN_TRANSIT' }, actor());
    await expect(finance.adminUpdateOrderStatus(f.order, { orderStatus: 'COMPLETED' }, actor())).rejects.toThrow(/delivery evidence/i);
    await logistics.confirmDeliveryWithProof(ship, { proofType: 'DELIVERY_PHOTO', proofReference: randomUUID(), deliveredToName: 'Buyer' }, actor());
    const statement = await logistics.reconcileCod(ship, { grossAmount: 200, courierFee: 10, netAmount: 190, statementReference: randomUUID() }, actor());
    expect((await db.query('SELECT payment_status FROM orders WHERE id=$1', [f.order])).rows[0].payment_status).toBe('UNPAID');
    await logistics.approveCodStatement(ship, Number(statement.id), actor());
    await logistics.approveCodStatement(ship, Number(statement.id), actor());
    expect((await db.query('SELECT order_status,payment_status FROM orders WHERE id=$1', [f.order])).rows[0]).toEqual({ order_status: 'COMPLETED', payment_status: 'PAID' });
    expect((await db.query("SELECT count(*)::int AS n,sum(amount) AS amount FROM cashbook_logs WHERE order_id=$1 AND category='COD'", [f.order])).rows[0]).toEqual({ n: 1, amount: '190.00' });
    expect(await inventory(destination, f.variant)).toEqual({ stock_quantity: 0, reserved_quantity: 0 });
  });

  it('assigns deferred package UIDs from source scans at dispatch, before transport custody begins', async () => {
    const f = await fixture(2);
    await db.query("UPDATE order_items SET assigned_uids='{}' WHERE order_id=$1", [f.order]);
    await db.query("UPDATE medicine_boxes SET status='IN_STOCK' WHERE uid=ANY($1::uuid[])", [f.uids]);
    await f.dispatch();
    expect(await inventory(source, f.variant)).toEqual({ stock_quantity: 0, reserved_quantity: 0 });
    expect((await db.query('SELECT assigned_uids FROM order_items WHERE order_id=$1', [f.order])).rows[0].assigned_uids.sort()).toEqual([...f.uids].sort());
    await f.inspect();
    expect(await inventory(destination, f.variant)).toEqual({ stock_quantity: 2, reserved_quantity: 2 });
  });

  it('cancels in transit without releasing stock, then restores only inspected good returns', async () => {
    const f = await fixture(); await f.dispatch();
    await orders.cancelMyOrder(customer, f.order, { reasonCode: 'CHANGED_MIND' });
    expect(await inventory(source, f.variant)).toEqual({ stock_quantity: 0, reserved_quantity: 0 });
    await transfers.adminReceiveTransferReturn(f.transfer, { lines: [{ variantId: f.variant, goodQuantity: 9, damagedQuantity: 1, goodUids: f.uids.slice(0, 9), damagedUids: f.uids.slice(9) }] }, actor());
    expect(await inventory(source, f.variant)).toEqual({ stock_quantity: 9, reserved_quantity: 0 });
    expect((await db.query('SELECT quantity FROM quarantine_balances WHERE facility_id=$1 AND variant_id=$2', [source, f.variant])).rows[0].quantity).toBe(1);
  });

  it('accepts 8 good + 1 damaged + 1 missing, with customer agreement and reduced unpaid totals', async () => {
    const f = await fixture(); await f.dispatch(); await f.inspect(8, 1);
    await transfers.resolveDiscrepancy(f.transfer, { action: 'ACCEPT_SHORTAGE', reason: 'Customer approved reduced delivery', customerAgreement: 'Support ticket 123' }, actor());
    expect(await inventory(destination, f.variant)).toEqual({ stock_quantity: 8, reserved_quantity: 8 });
    expect((await db.query('SELECT total_amount,order_status FROM orders WHERE id=$1', [f.order])).rows[0]).toEqual({ total_amount: '800.00', order_status: 'PROCESSING' });
    expect((await db.query('SELECT quantity FROM order_items WHERE order_id=$1', [f.order])).rows[0].quantity).toBe(8);
  });

  it('blocks shortage acceptance for paid orders and keeps the discrepancy open', async () => {
    const f = await fixture(); await f.dispatch(); await f.inspect(8, 1);
    await db.query("UPDATE orders SET payment_method='CASH',payment_status='PAID' WHERE id=$1", [f.order]);
    await expect(transfers.resolveDiscrepancy(f.transfer, { action: 'ACCEPT_SHORTAGE', reason: 'Test', customerAgreement: 'Ticket' }, actor())).rejects.toThrow(/unpaid/i);
    expect((await db.query('SELECT count(*)::int AS n FROM transfer_resolutions WHERE transfer_id=$1', [f.transfer])).rows[0].n).toBe(0);
  });

  it('requires customer agreement and destination-manager authority for shortage decisions', async () => {
    const f = await fixture(); await f.dispatch(); await f.inspect(8, 1);
    await expect(transfers.resolveDiscrepancy(f.transfer, { action: 'ACCEPT_SHORTAGE', reason: 'Missing agreement' }, actor())).rejects.toThrow(/customer agreement/i);
    await expect(transfers.resolveDiscrepancy(f.transfer, { action: 'RESUPPLY', sourceFacilityId: source, reason: 'Warehouse request' }, warehouse())).rejects.toThrow(/role|manager/i);
    const otherManager = { ...warehouse(), role: 'STORE_MANAGER' };
    await expect(transfers.resolveDiscrepancy(f.transfer, { action: 'RESUPPLY', sourceFacilityId: source, reason: 'Wrong destination manager' }, otherManager)).rejects.toThrow(/role|manager/i);
  });

  it('reallocates affected lines from another source and does not duplicate concurrent replacements', async () => {
    const f = await fixture(); await f.dispatch(); await f.inspect(8, 1);
    await db.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,10,0)', [alternate, f.variant]);
    await db.query("INSERT INTO medicine_boxes(batch_id,current_facility_id,status) SELECT $1,$2,'IN_STOCK' FROM generate_series(1,10)", [f.batch, alternate]);
    const resolve = () => transfers.resolveDiscrepancy(f.transfer, { action: 'RESUPPLY', sourceFacilityId: alternate, reason: 'Alternate source approved' }, actor());
    await Promise.all([resolve(), resolve()]);
    expect(await inventory(alternate, f.variant)).toEqual({ stock_quantity: 10, reserved_quantity: 10 });
    expect(await inventory(destination, f.variant)).toEqual({ stock_quantity: 8, reserved_quantity: 0 });
    expect((await db.query("SELECT count(*)::int AS n FROM internal_transfers WHERE order_id=$1 AND status='REQUESTED'", [f.order])).rows[0].n).toBe(1);
  });

  it('rolls back replacement reservation when replacement packages are insufficient', async () => {
    const f = await fixture(); await f.dispatch(); await f.inspect(8, 1);
    await db.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,10,0)', [alternate, f.variant]);
    await expect(transfers.resolveDiscrepancy(f.transfer, { action: 'RESUPPLY', sourceFacilityId: alternate, reason: 'Try replacement' }, actor())).rejects.toThrow(/package stock/i);
    expect(await inventory(alternate, f.variant)).toEqual({ stock_quantity: 10, reserved_quantity: 0 });
  });

  async function paymentOrder(status = 'PENDING') {
    return id("INSERT INTO orders(order_code,customer_id,export_facility_id,order_status,payment_method,payment_status,total_amount) VALUES ($1,$2,$3,$4,'BANK_TRANSFER','UNPAID',1000) RETURNING id", [randomUUID(), customer, destination, status]);
  }
  async function exception(order: number, amount: number) {
    return (await finance.recordPaymentException(order, { amount, paymentMethod: 'BANK_TRANSFER', paymentReference: randomUUID(), reason: 'Late or unmatched bank transfer' }, actor())).id;
  }
  const decision = (order: number, receipt: number, action: string, amount?: number, reference = randomUUID()) => finance.resolvePaymentException(order, receipt, { action, amount, reference, reason: 'Verified bank statement' }, actor());

  it('accumulates partial payments, retains overpayment on hold, and records receipts once', async () => {
    const order = await paymentOrder(); const first = await exception(order, 400); const second = await exception(order, 700);
    await decision(order, first, 'APPROVE'); await decision(order, second, 'APPROVE');
    await decision(order, first, 'APPLY', 400);
    expect((await db.query('SELECT payment_status FROM orders WHERE id=$1', [order])).rows[0].payment_status).toBe('UNPAID');
    const ref = randomUUID(); await Promise.all([decision(order, second, 'APPLY', 600, ref), decision(order, second, 'APPLY', 600, ref)]);
    expect((await db.query('SELECT payment_status FROM orders WHERE id=$1', [order])).rows[0].payment_status).toBe('PAID');
    expect((await db.query('SELECT amount-allocated-refunded AS held FROM payment_exceptions WHERE id=$1', [second])).rows[0].held).toBe('100.00');
    expect((await db.query("SELECT count(*)::int AS n FROM cashbook_logs WHERE order_id=$1 AND category='UNALLOCATED_PAYMENT'", [order])).rows[0].n).toBe(2);
  });

  it('holds a late cancelled-order payment and records the actual refund once', async () => {
    const order = await paymentOrder('CANCELLED'); const receipt = await exception(order, 1000);
    await decision(order, receipt, 'APPROVE');
    await expect(decision(order, receipt, 'APPLY', 1000)).rejects.toThrow(/cannot apply/i);
    const ref = randomUUID(); await Promise.all([decision(order, receipt, 'REFUND', 1000, ref), decision(order, receipt, 'REFUND', 1000, ref)]);
    expect((await db.query('SELECT order_status,payment_status FROM orders WHERE id=$1', [order])).rows[0]).toEqual({ order_status: 'CANCELLED', payment_status: 'UNPAID' });
    expect((await db.query("SELECT count(*)::int AS n FROM cashbook_logs WHERE order_id=$1 AND category='UNALLOCATED_PAYMENT_REFUND'", [order])).rows[0].n).toBe(1);
  });

  it('rejects refunds beyond available funds and duplicate actual refund references across receipts', async () => {
    const firstOrder = await paymentOrder('CANCELLED'); const secondOrder = await paymentOrder('CANCELLED');
    const first = await exception(firstOrder, 400); const second = await exception(secondOrder, 400);
    await decision(firstOrder, first, 'APPROVE'); await decision(secondOrder, second, 'APPROVE');
    await expect(decision(firstOrder, first, 'REFUND', 401)).rejects.toThrow(/exceeds/i);
    const reference = randomUUID(); await decision(firstOrder, first, 'REFUND', 400, reference);
    await expect(decision(secondOrder, second, 'REFUND', 400, reference)).rejects.toThrow(/already recorded|duplicate/i);
    expect((await db.query('SELECT refunded FROM payment_exceptions WHERE id=$1', [second])).rows[0].refunded).toBe('0.00');
  });

  it('denies warehouse financial approval and duplicate bank references across workflows', async () => {
    const order = await paymentOrder(); const reference = randomUUID();
    await finance.submitOnlinePayment(order, { amount: 1000, paymentMethod: 'BANK_TRANSFER', paymentReference: reference }, actor());
    await expect(finance.recordPaymentException(order, { amount: 1000, paymentMethod: 'BANK_TRANSFER', paymentReference: reference, reason: 'Duplicate' }, actor())).rejects.toThrow(/already recorded/i);
    const receipt = await exception(order, 200);
    await expect(finance.resolvePaymentException(order, receipt, { action: 'APPROVE', reference: 'Test', reason: 'Test' }, warehouse())).rejects.toThrow(/role|approval/i);
  });

  it('allows cancellation of an unpacked PROCESSING order', async () => {
    const order = await paymentOrder('PROCESSING');
    await orders.cancelMyOrder(customer, order, { reasonCode: 'CHANGED_MIND' });
    expect((await db.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('CANCELLED');
  });

  it('denies customer cancellation after packing was committed even with an inconsistent PROCESSING label', async () => {
    const order = await paymentOrder('PROCESSING');
    await db.query("INSERT INTO shipments(order_id,tracking_number,shipping_status) VALUES ($1,$2,'PENDING_PICKUP')", [order, randomUUID()]);
    await expect(orders.cancelMyOrder(customer, order, { reasonCode: 'CHANGED_MIND' })).rejects.toThrow(/packing/i);
  });

  it('serializes packing against customer cancellation without double stock deduction', async () => {
    const f = await fixture(1); await f.dispatch(); await f.inspect();
    const results = await Promise.allSettled([
      orders.cancelMyOrder(customer, f.order, { reasonCode: 'CHANGED_MIND' }),
      finance.adminPackOrder(f.order, { boxUids: f.uids }, actor()),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const state = (await db.query('SELECT order_status FROM orders WHERE id=$1', [f.order])).rows[0].order_status;
    expect(['CANCELLED', 'PENDING_PICKUP']).toContain(state);
    expect(await inventory(destination, f.variant)).toEqual({ stock_quantity: state === 'CANCELLED' ? 1 : 0, reserved_quantity: 0 });
  });

  it('can refund partially allocated funds after the unpaid order is cancelled', async () => {
    const order = await paymentOrder(); const receipt = await exception(order, 400);
    await decision(order, receipt, 'APPROVE'); await decision(order, receipt, 'APPLY', 400);
    await orders.cancelMyOrder(customer, order, { reasonCode: 'CHANGED_MIND' });
    await decision(order, receipt, 'REFUND', 400);
    expect((await db.query('SELECT allocated,refunded FROM payment_exceptions WHERE id=$1', [receipt])).rows[0]).toEqual({ allocated: '0.00', refunded: '400.00' });
  });

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
