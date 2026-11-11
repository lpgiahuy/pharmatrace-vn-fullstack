import { Pool } from 'pg';
import { PrismaService } from '../../prisma/prisma.service';
import { LogisticsService } from './shipment/logistics.service';
import { InternalTransferService } from './internal-transfer/internal-transfer.service';
import { OrderService } from '../order/order.service';
import { AdminOrderService } from '../order/admin-order.service';

// Opt in against a disposable database initialized by 00_master_init.sql.
const integration = process.env.LOGISTICS_TEST_DATABASE_URL ? describe : describe.skip;
integration('Logistics database integrity under app_user', () => {
  let admin: Pool;
  let prisma: PrismaService;
  let logistics: LogisticsService;
  let transfers: InternalTransferService;
  let source: number, destination: number, employee: number, accountant: number, financeManager: number, medicine: number, variant: number;
  const id = async (sql: string, values: unknown[] = []) => (await admin.query(sql, values)).rows[0].id as number;
  const actor = () => ({ id: employee, role: 'STORE_MANAGER', type: 'employee' as const, facilityId: destination });
  beforeAll(async () => {
    const url = new URL(process.env.LOGISTICS_TEST_DATABASE_URL!);
    if (!['/codex_logistics_integrity_test', '/codex_logistics_cleanup_fresh_20261110', '/codex_logistics_cleanup_legacy_20261110'].includes(url.pathname)) throw new Error('Use the dedicated disposable logistics test database.');
    admin = new Pool({ connectionString: url.toString() });
    url.searchParams.set('options', '-c role=app_user');
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url.toString();
    prisma = new PrismaService();
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
    await prisma.onModuleInit();
    logistics = new LogisticsService(prisma);
    transfers = new InternalTransferService(prisma);
    source = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Concurrent source','PHARMACY') RETURNING id");
    destination = await id("INSERT INTO facilities(facility_name,facility_type) VALUES ('Concurrent destination','PHARMACY') RETURNING id");
    employee = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Concurrent manager','STORE_MANAGER',$1) RETURNING id", [destination]);
    accountant = await id("INSERT INTO employees(full_name,role) VALUES ('Payment accountant','ACCOUNTANT') RETURNING id");
    financeManager = await id("INSERT INTO employees(full_name,role) VALUES ('Finance approver','FINANCE_MANAGER') RETURNING id");
    medicine = await id("INSERT INTO medicines(medicine_name) VALUES ('Concurrent medicine') RETURNING id");
    variant = await id("INSERT INTO packaging_variants(medicine_id,unit_name) VALUES ($1,'Box') RETURNING id", [medicine]);
  });
  afterAll(async () => { await prisma?.onModuleDestroy(); await admin?.end(); });

  async function shipment(status: string, orderStatus: string, paymentStatus = 'UNPAID') {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status,total_amount,payment_method,payment_status) VALUES (gen_random_uuid()::text,$1,$2,100,'COD',$3) RETURNING id", [destination, orderStatus, paymentStatus]);
    const ship = await id("INSERT INTO shipments(order_id,tracking_number,shipping_status,cod_amount,return_qa_status) VALUES ($1,gen_random_uuid()::text,$2,100,'PENDING_INSPECTION') RETURNING id", [order, status]);
    return { order, ship };
  }
  // Receipt tests start after handoff: goods are in custody, outside source on-hand/reserved stock.
  async function stageCustody(transfer: number, variantId: number, quantity: number, boxUids: string[] = []) {
    await admin.query('INSERT INTO transfer_custody(transfer_id,variant_id,quantity,outstanding,box_uids) VALUES ($1,$2,$3,$3,$4)', [transfer, variantId, quantity, boxUids]);
    await admin.query('UPDATE inventories SET stock_quantity=stock_quantity-$3,reserved_quantity=reserved_quantity-$3 WHERE facility_id=$1 AND variant_id=$2', [source, variantId, quantity]);
    await admin.query("UPDATE medicine_boxes SET status='IN_TRANSIT',current_facility_id=NULL WHERE uid=ANY($1::uuid[])", [boxUids]);
  }
  it('records the customer cancellation reason with the cancellation', async () => {
    const customer = await id("INSERT INTO customers(full_name) VALUES ('Cancellation customer') RETURNING id");
    const voucher = await id("INSERT INTO vouchers(voucher_code,discount_type,discount_value,used_quantity,start_date,end_date) VALUES (gen_random_uuid()::text,'FIXED',10,1,now()-interval '1 day',now()+interval '1 day') RETURNING id");
    const order = await id("INSERT INTO orders(order_code,customer_id,export_facility_id,order_status,voucher_id) VALUES (gen_random_uuid()::text,$1,$2,'PENDING',$3) RETURNING id", [customer, destination, voucher]);
    const service = new OrderService(prisma);
    await service.cancelMyOrder(customer, order, { reasonCode: 'OTHER', reasonDetails: 'Changed delivery plans' });
    const result = await admin.query('SELECT o.order_status, r.reason_code, r.reason_details FROM orders o JOIN order_cancellation_reasons r ON r.order_id = o.id WHERE o.id = $1', [order]);
    expect(result.rows[0]).toEqual({ order_status: 'CANCELLED', reason_code: 'OTHER', reason_details: 'Changed delivery plans' });
    expect((await admin.query('SELECT used_quantity FROM vouchers WHERE id=$1', [voucher])).rows[0].used_quantity).toBe(0);
  });
  it('blocks dispatch for unpaid online orders', async () => {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,total_amount) VALUES (gen_random_uuid()::text,$1,'PENDING','E_WALLET','UNPAID',100) RETURNING id", [destination]);
    const transfer = await id("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES (gen_random_uuid()::text,$1,$2,$3,'REQUESTED','[]') RETURNING id", [order, source, destination]);
    await expect(admin.query("UPDATE internal_transfers SET status='DISPATCHED' WHERE id=$1", [transfer])).rejects.toThrow(/payment/i);
    await expect(admin.query("UPDATE orders SET order_status='PENDING_PICKUP' WHERE id=$1", [order])).rejects.toThrow(/payment/i);
    const finance = new AdminOrderService(prisma);
    const receipt = await finance.submitOnlinePayment(order, { amount: 100, paymentMethod: 'E_WALLET', paymentReference: `GATE-${order}` }, { type: 'employee', id: accountant, role: 'ACCOUNTANT' });
    await finance.approveOnlinePayment(order, receipt.id, { type: 'employee', id: financeManager, role: 'FINANCE_MANAGER' });
    await expect(admin.query("UPDATE internal_transfers SET status='DISPATCHED' WHERE id=$1", [transfer])).rejects.toThrow(/manifest/i);
  });
  it('requires a source scan matching the reserved UID before dispatch', async () => {
    const sourceEmployee = await id("INSERT INTO employees(full_name,role,facility_id) VALUES ('Source dispatcher','WAREHOUSE_STAFF',$1) RETURNING id", [source]);
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method) VALUES (gen_random_uuid()::text,$1,'WAITING_INTERNAL_TRANSFER','COD') RETURNING id", [destination]);
    const box = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'RESERVED') RETURNING uid", [source])).rows[0].uid as string;
    const other = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'RESERVED') RETURNING uid", [source])).rows[0].uid as string;
    await admin.query("INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved,assigned_uids,unit_name) VALUES ($1,$2,$3,1,$4,true,$5,'Box')", [order, medicine, variant, source, [box]]);
    const transfer = await id("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES (gen_random_uuid()::text,$1,$2,$3,'REQUESTED',$4) RETURNING id", [order, source, destination, JSON.stringify([{ variantId: variant, medicineId: medicine, quantity: 1 }])]);
    await admin.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,1,1)', [source, variant]);
    const sourceActor = { id: sourceEmployee, type: 'employee' as const, role: 'WAREHOUSE_STAFF', facilityId: source };
    const payload = { transportMode: 'INTERNAL' as const, transportEmployeeId: sourceEmployee, manifest: [{ variantId: variant, quantity: 1, boxUids: [other] }] };
    await expect(transfers.adminDispatchInternalTransfer(transfer, payload, sourceActor)).rejects.toThrow(/UID/i);
    await transfers.adminDispatchInternalTransfer(transfer, { ...payload, manifest: [{ variantId: variant, quantity: 1, boxUids: [box] }] }, sourceActor);
    expect((await admin.query('SELECT lines FROM transfer_manifests WHERE transfer_id=$1', [transfer])).rows[0].lines[0].boxUids).toEqual([box]);
  });
  it('expires unpaid online reservations while retaining COD and transfers already waiting', async () => {
    const customer = await id("INSERT INTO customers(full_name,reward_points) VALUES ('Timeout customer',0) RETURNING id");
    const prescription = await id("INSERT INTO prescriptions(customer_id,status) VALUES ($1,'APPROVED') RETURNING id", [customer]);
    const voucher = await id("INSERT INTO vouchers(voucher_code,discount_type,discount_value,used_quantity,start_date,end_date) VALUES (gen_random_uuid()::text,'FIXED',10,1,now()-interval '1 day',now()+interval '1 day') RETURNING id");
    const expiryVariant = await id("INSERT INTO packaging_variants(medicine_id,unit_name) VALUES ($1,'Expiry box') RETURNING id", [medicine]);
    const box = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'RESERVED') RETURNING uid", [source])).rows[0].uid;
    await admin.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,1,1)', [source, expiryVariant]);
    const order = await id("INSERT INTO orders(order_code,customer_id,export_facility_id,order_status,payment_method,payment_status,used_points,prescription_id,prescription_review_status,voucher_id,created_at) VALUES (gen_random_uuid()::text,$1,$2,'PENDING','E_WALLET','UNPAID',20,$3,'APPROVED',$4,now()-interval '16 minutes') RETURNING id", [customer, destination, prescription, voucher]);
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved,assigned_uids) VALUES ($1,$2,$3,1,$4,true,$5)', [order, medicine, expiryVariant, source, [box]]);
    const transfer = await id("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES (gen_random_uuid()::text,$1,$2,$3,'REQUESTED','[]') RETURNING id", [order, source, destination]);
    const cod = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,created_at) VALUES (gen_random_uuid()::text,$1,'PENDING','COD','UNPAID',now()-interval '2 hours') RETURNING id", [destination]);
    const waiting = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,created_at) VALUES (gen_random_uuid()::text,$1,'WAITING_INTERNAL_TRANSFER','E_WALLET','UNPAID',now()-interval '2 hours') RETURNING id", [destination]);
    const bankExpired = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,created_at) VALUES (gen_random_uuid()::text,$1,'PENDING','BANK_TRANSFER','UNPAID',now()-interval '31 minutes') RETURNING id", [destination]);
    const bankFresh = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,created_at) VALUES (gen_random_uuid()::text,$1,'PENDING','BANK_TRANSFER','UNPAID',now()-interval '29 minutes') RETURNING id", [destination]);
    const walletFresh = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,created_at) VALUES (gen_random_uuid()::text,$1,'PENDING','E_WALLET','UNPAID',now()-interval '14 minutes') RETURNING id", [destination]);
    await prisma.withOrder('loyalty', tx => tx.$queryRaw`SELECT public.expire_unpaid_orders()`);
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('CANCELLED');
    expect((await admin.query('SELECT reserved_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [source, expiryVariant])).rows[0].reserved_quantity).toBe(0);
    expect((await admin.query('SELECT status FROM medicine_boxes WHERE uid=$1', [box])).rows[0].status).toBe('IN_STOCK');
    expect((await admin.query('SELECT status FROM internal_transfers WHERE id=$1', [transfer])).rows[0].status).toBe('CANCELLED');
    expect((await admin.query('SELECT reward_points FROM customers WHERE id=$1', [customer])).rows[0].reward_points).toBe(20);
    expect((await admin.query('SELECT used_quantity FROM vouchers WHERE id=$1', [voucher])).rows[0].used_quantity).toBe(0);
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [cod])).rows[0].order_status).toBe('PENDING');
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [waiting])).rows[0].order_status).toBe('WAITING_INTERNAL_TRANSFER');
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [bankExpired])).rows[0].order_status).toBe('CANCELLED');
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [bankFresh])).rows[0].order_status).toBe('PENDING');
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [walletFresh])).rows[0].order_status).toBe('PENDING');
  });
  it('starts pending consolidation when online payment is recorded', async () => {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,total_amount) VALUES (gen_random_uuid()::text,$1,'PENDING','E_WALLET','UNPAID',100) RETURNING id", [destination]);
    await admin.query("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES (gen_random_uuid()::text,$1,$2,$3,'REQUESTED','[]')", [order, source, destination]);
    const finance = new AdminOrderService(prisma);
    await expect(admin.query("UPDATE orders SET payment_status='PAID' WHERE id=$1", [order])).rejects.toThrow(/evidence/i);
    const receipt = await finance.submitOnlinePayment(order, { amount: 100, paymentMethod: 'E_WALLET', paymentReference: `PAY-${order}` }, { type: 'employee', id: accountant, role: 'ACCOUNTANT' });
    await expect(finance.approveOnlinePayment(order, receipt.id, { type: 'employee', id: accountant, role: 'ACCOUNTANT' })).rejects.toThrow(/authorized/i);
    expect((await admin.query('SELECT payment_status FROM orders WHERE id=$1', [order])).rows[0].payment_status).toBe('UNPAID');
    await finance.approveOnlinePayment(order, receipt.id, { type: 'employee', id: financeManager, role: 'FINANCE_MANAGER' });
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('WAITING_INTERNAL_TRANSFER');
    expect((await admin.query("SELECT amount::float AS amount,payment_method,created_by_user_id FROM cashbook_logs WHERE order_id=$1 AND category='ONLINE_PAYMENT'", [order])).rows[0]).toEqual({ amount: 100, payment_method: 'E_WALLET', created_by_user_id: accountant });
  });
  it('does not let financial readers mutate orders through their read context', async () => {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status) VALUES (gen_random_uuid()::text,$1,'PENDING') RETURNING id", [destination]);
    const financialActor = { type: 'employee' as const, id: accountant, role: 'ACCOUNTANT' };
    await expect(prisma.withOrder('read', tx => tx.orders.updateMany({ where: { id: order }, data: { order_status: 'CANCELLED' } }), financialActor)).rejects.toThrow();
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('PENDING');
  });
  it('keeps rejected payment evidence auditable and allows a corrected submission', async () => {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,total_amount) VALUES (gen_random_uuid()::text,$1,'PENDING','BANK_TRANSFER','UNPAID',100) RETURNING id", [destination]);
    const finance = new AdminOrderService(prisma);
    const recorder = { type: 'employee' as const, id: accountant, role: 'ACCOUNTANT' };
    const approver = { type: 'employee' as const, id: financeManager, role: 'FINANCE_MANAGER' };
    const receipt = await finance.submitOnlinePayment(order, { amount: 100, paymentMethod: 'BANK_TRANSFER', paymentReference: `BAD-${order}` }, recorder);
    await finance.rejectOnlinePayment(order, receipt.id, 'Statement does not match', approver);
    await finance.submitOnlinePayment(order, { amount: 100, paymentMethod: 'BANK_TRANSFER', paymentReference: `CORRECT-${order}` }, recorder);
    const entries = await finance.getOnlinePayments(order, recorder);
    expect(entries.map(entry => entry.status)).toEqual(['PENDING', 'REJECTED']);
    expect(entries[1]).toMatchObject({ rejection_reason: 'Statement does not match', rejected_by: financeManager });
    expect((await admin.query('SELECT payment_status FROM orders WHERE id=$1', [order])).rows[0].payment_status).toBe('UNPAID');
  });
  it('serializes online payment against expiration', async () => {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status,payment_method,payment_status,total_amount,created_at) VALUES (gen_random_uuid()::text,$1,'PENDING','E_WALLET','UNPAID',100,now()-interval '20 minutes') RETURNING id", [destination]);
    const service = new AdminOrderService(prisma);
    const receipt = await id("INSERT INTO online_payment_receipts(order_id,amount,payment_method,payment_reference,recorded_by) VALUES ($1,100,'E_WALLET',gen_random_uuid()::text,$2) RETURNING id", [order, accountant]);
    await Promise.allSettled([
      prisma.withOrder('loyalty', tx => tx.$queryRaw`SELECT public.expire_unpaid_orders()`),
      service.approveOnlinePayment(order, receipt, { type: 'employee', id: financeManager, role: 'FINANCE_MANAGER' }),
    ]);
    const state = (await admin.query('SELECT order_status,payment_status FROM orders WHERE id=$1', [order])).rows[0];
    expect([{ order_status: 'CANCELLED', payment_status: 'UNPAID' }, { order_status: 'PENDING', payment_status: 'PAID' }]).toContainEqual(state);
  });
  it('serializes concurrent COD reconciliation without duplicate cash or fee', async () => {
    const { order, ship } = await shipment('DELIVERED', 'COMPLETED');
    await expect(admin.query("UPDATE orders SET payment_status='PAID' WHERE id=$1", [order])).rejects.toThrow(/reconciliation evidence/i);
    const dto = { grossAmount: 100, courierFee: 10, netAmount: 90, statementReference: 'CONCURRENT' };
    const adminId = await id("INSERT INTO employees(full_name,role) VALUES ('COD admin','SUPER_ADMIN') RETURNING id");
    const codAdmin = { type: 'employee' as const, id: adminId, role: 'SUPER_ADMIN' };
    const review = await logistics.reconcileCod(ship, dto, codAdmin);
    const results = await Promise.all([logistics.approveCodStatement(ship, Number(review.id), codAdmin), logistics.approveCodStatement(ship, Number(review.id), codAdmin)]);
    expect(results[0].cashbookId).toEqual(results[1].cashbookId);
    await expect(logistics.collect(ship, actor())).rejects.toThrow(/statement/i);
    const { rows } = await admin.query("SELECT count(*)::int AS entries,sum(CASE WHEN transaction_type='INCOME' THEN amount ELSE -amount END)::float AS net FROM cashbook_logs WHERE order_id=$1", [order]);
    expect(rows[0]).toEqual({ entries: 1, net: 90 });
    expect((await admin.query('SELECT amount::float AS amount FROM courier_service_fees WHERE shipment_id=$1', [ship])).rows[0].amount).toBe(10);
    expect((await admin.query('SELECT amount_due::float AS due,collected_amount::float AS collected,status FROM courier_receivables WHERE shipment_id=$1', [ship])).rows[0]).toEqual({ due: 100, collected: 100, status: 'SETTLED' });
    await expect(logistics.reconcileCod(ship, { ...dto, grossAmount: 0 }, codAdmin)).rejects.toThrow();
    expect((await admin.query('SELECT cod_settlement_status FROM shipments WHERE id=$1', [ship])).rows[0].cod_settlement_status).toBe('SETTLED');
  });
  it('lets finance staff view, submit and approve COD statements according to role', async () => {
    const { ship } = await shipment('DELIVERED', 'COMPLETED');
    const recorder = { type: 'employee' as const, id: accountant, role: 'ACCOUNTANT' };
    const approver = { type: 'employee' as const, id: financeManager, role: 'FINANCE_MANAGER' };
    const statement = await logistics.reconcileCod(ship, { grossAmount: 100, courierFee: 10, netAmount: 90, statementReference: 'FINANCE-REVIEW' }, recorder);
    expect(statement.status).toBe('PENDING');
    expect((await logistics.shipment(ship, recorder, true)).statementReviews).toEqual(expect.arrayContaining([expect.objectContaining({ id: statement.id, status: 'PENDING' })]));
    await expect(logistics.approveCodStatement(ship, Number(statement.id), recorder)).rejects.toThrow(/authorized/i);
    expect((await logistics.approveCodStatement(ship, Number(statement.id), approver)).status).toBe('SETTLED');
    expect((await logistics.shipment(ship, approver, true)).statementReviews).toEqual(expect.arrayContaining([expect.objectContaining({ id: statement.id, status: 'APPROVED' })]));
  });
  it('blocks legacy collection before and after COD settlement', async () => {
    const { order, ship } = await shipment('DELIVERED', 'COMPLETED');
    await expect(logistics.collect(ship, actor())).rejects.toThrow(/statement/i);
    const adminId = await id("INSERT INTO employees(full_name,role) VALUES ('COD admin','SUPER_ADMIN') RETURNING id");
    const codAdmin = { type: 'employee' as const, id: adminId, role: 'SUPER_ADMIN' };
    const review = await logistics.reconcileCod(ship, { grossAmount: 100, courierFee: 0, netAmount: 100, statementReference: 'MIXED' }, codAdmin);
    const result = await logistics.approveCodStatement(ship, Number(review.id), codAdmin);
    await expect(logistics.collect(ship, actor())).rejects.toThrow(/statement/i);
    expect(result.cashbookId).toBeTruthy();
    expect((await admin.query('SELECT count(*)::int AS count FROM cashbook_logs WHERE order_id=$1', [order])).rows[0].count).toBe(1);
  });
  it('records delivery evidence and accepts a dispute only from the order customer', async () => {
    const { order, ship } = await shipment('IN_TRANSIT', 'SHIPPING');
    const customer = await id("INSERT INTO customers(full_name) VALUES ('Evidence customer') RETURNING id");
    await admin.query('UPDATE orders SET customer_id=$1 WHERE id=$2', [customer, order]);
    await logistics.confirmDeliveryWithProof(ship, { proofType: 'DELIVERY_PHOTO', proofReference: 'photo/reference', deliveredToName: 'Recipient' }, actor());
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('COMPLETED');
    await expect(logistics.disputeDelivery(ship, customer, 'Package was not received')).resolves.toMatchObject({ success: true });
    await expect(logistics.disputeDelivery(ship, customer + 1, 'Other customer')).rejects.toThrow(/not found/i);
  });
  it('receives into quarantine and completes QA after a failed delivery', async () => {
    const { order, ship } = await shipment('RETURN_IN_TRANSIT', 'SHIPPING');
    const failedVariant = await id("INSERT INTO packaging_variants(medicine_id,unit_name) VALUES ($1,'Failed box') RETURNING id", [medicine]);
    const box = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'SOLD') RETURNING uid", [destination])).rows[0].uid;
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,assigned_uids) VALUES ($1,$2,$3,1,$4)', [order, medicine, failedVariant, [box]]);
    await logistics.receiveReturn(ship, { notes: 'Physical intake', receivedLines: [{ variantId: failedVariant, quantity: 1, boxUids: [box] }] }, { ...actor(), role: 'WAREHOUSE_STAFF' });
    expect((await admin.query('SELECT status FROM medicine_boxes WHERE uid=$1', [box])).rows[0].status).toBe('QUARANTINED');
    await logistics.dispositionReturn(ship, { decision: 'SCRAP', qaNotes: 'Damaged', lines: [{ variantId: failedVariant, passQuantity: 0, failQuantity: 1, scrapBoxUids: [box] }] }, actor());
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('RETURNED');
    expect((await admin.query('SELECT quantity FROM quarantine_balances WHERE facility_id=$1 AND variant_id=$2', [destination, failedVariant])).rows[0].quantity).toBe(1);
    expect((await admin.query("SELECT quantity_changed,previous_quantity,new_quantity FROM inventory_logs WHERE variant_id=$1 AND transaction_type='QUARANTINE_FAILED_QA'", [failedVariant])).rows[0]).toEqual({ quantity_changed: 0, previous_quantity: 1, new_quantity: 1 });
  });
  it('records only physically returned boxes and preserves the other sold units', async () => {
    const { order, ship } = await shipment('RETURN_IN_TRANSIT', 'COMPLETED');
    const returnVariant = await id("INSERT INTO packaging_variants(medicine_id,unit_name) VALUES ($1,'Partial box') RETURNING id", [medicine]);
    const boxes = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'SOLD'),($1,'SOLD') RETURNING uid", [destination])).rows.map(row => row.uid as string);
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,assigned_uids) VALUES ($1,$2,$3,2,$4)', [order, medicine, returnVariant, boxes]);
    await logistics.receiveReturn(ship, { receivedLines: [{ variantId: returnVariant, quantity: 1, boxUids: [boxes[0]] }] }, { ...actor(), role: 'WAREHOUSE_STAFF' });
    await logistics.dispositionReturn(ship, { decision: 'RESTOCK', qaNotes: 'Inspected', lines: [{ variantId: returnVariant, passQuantity: 1, failQuantity: 0, restockBoxUids: [boxes[0]] }] }, actor());
    const states = await admin.query('SELECT uid, status FROM medicine_boxes WHERE uid = ANY($1::uuid[])', [boxes]);
    expect(states.rows.find(row => row.uid === boxes[0]).status).toBe('IN_STOCK');
    expect(states.rows.find(row => row.uid === boxes[1]).status).toBe('SOLD');
    expect((await admin.query('SELECT order_status FROM orders WHERE id=$1', [order])).rows[0].order_status).toBe('PARTIALLY_RETURNED');
    const movements = (await admin.query("SELECT transaction_type,quantity_changed,previous_quantity,new_quantity FROM inventory_logs WHERE variant_id=$1 AND stock_bucket='QUARANTINE' ORDER BY id", [returnVariant])).rows;
    expect(movements).toEqual([
      { transaction_type: 'QUARANTINE_IN', quantity_changed: 1, previous_quantity: 0, new_quantity: 1 },
      { transaction_type: 'QUARANTINE_TO_STOCK', quantity_changed: -1, previous_quantity: 1, new_quantity: 0 },
    ]);
  });
  it('limits post-delivery return intake to approved quantities', async () => {
    const { order, ship } = await shipment('DELIVERED', 'COMPLETED');
    const boxes = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'SOLD'),($1,'SOLD') RETURNING uid", [destination])).rows.map(row => row.uid as string);
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,assigned_uids) VALUES ($1,$2,$3,2,$4)', [order, medicine, variant, boxes]);
    await logistics.requestPostDeliveryReturn(ship, { reason: 'One unit damaged', lines: [{ variantId: variant, quantity: 1 }] }, actor());
    await expect(logistics.receiveReturn(ship, { receivedLines: [{ variantId: variant, quantity: 2, boxUids: boxes }] }, { ...actor(), role: 'WAREHOUSE_STAFF' })).rejects.toThrow(/approved/i);
    await logistics.receiveReturn(ship, { receivedLines: [{ variantId: variant, quantity: 1, boxUids: [boxes[0]] }] }, { ...actor(), role: 'WAREHOUSE_STAFF' });
    expect((await admin.query('SELECT quantity,approved_by FROM shipment_return_authorizations WHERE shipment_id=$1', [ship])).rows[0]).toEqual({ quantity: 1, approved_by: employee });
  });
  it('records one approved refund only after physical receipt and inspection', async () => {
    const { order, ship } = await shipment('RETURN_IN_TRANSIT', 'COMPLETED', 'PAID');
    const customer = await id("INSERT INTO customers(full_name,reward_points) VALUES ('Refund customer',10) RETURNING id");
    await admin.query('UPDATE orders SET customer_id=$1 WHERE id=$2', [customer, order]);
    await admin.query("INSERT INTO loyalty_point_logs(customer_id,order_id,transaction_type,points) VALUES ($1,$2,'EARN',10)", [customer, order]);
    const box = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'SOLD') RETURNING uid", [destination])).rows[0].uid as string;
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,unit_price,assigned_uids) VALUES ($1,$2,$3,1,100,$4)', [order, medicine, variant, [box]]);
    const refund = { goodsValue: 100, customerFee: 10, paymentMethod: 'BANK_TRANSFER', reason: 'Return fee charged' };
    await expect(logistics.approveReturnRefund(ship, refund, actor())).rejects.toThrow(/inspection/i);
    await expect(logistics.recordRefundPayment(ship, { paymentReference: `REF-${ship}` }, actor())).rejects.toThrow(/approved/i);
    await logistics.receiveReturn(ship, { receivedLines: [{ variantId: variant, quantity: 1, boxUids: [box] }] }, { ...actor(), role: 'WAREHOUSE_STAFF' });
    await logistics.dispositionReturn(ship, { decision: 'SCRAP', qaNotes: 'Inspected', lines: [{ variantId: variant, passQuantity: 0, failQuantity: 1, scrapBoxUids: [box] }] }, actor());
    await expect(logistics.approveReturnRefund(ship, { ...refund, goodsValue: 101 }, actor())).rejects.toThrow(/exceeds/i);
    await logistics.approveReturnRefund(ship, refund, actor());
    expect((await admin.query("SELECT count(*)::int AS n FROM cashbook_logs WHERE order_id=$1 AND category='CUSTOMER_REFUND'", [order])).rows[0].n).toBe(0);
    const attempts = await Promise.allSettled([logistics.recordRefundPayment(ship, { paymentReference: `REF-${ship}` }, actor()), logistics.recordRefundPayment(ship, { paymentReference: `REF-${ship}` }, actor())]);
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await admin.query("SELECT count(*)::int AS n, sum(amount)::int AS amount FROM cashbook_logs WHERE order_id=$1 AND category='CUSTOMER_REFUND'", [order])).rows[0]).toEqual({ n: 1, amount: 90 });
    expect((await admin.query('SELECT reward_points FROM customers WHERE id=$1', [customer])).rows[0].reward_points).toBe(0);
  });
  it('runs only one QA disposition when two requests inspect the same return', async () => {
    const { order, ship } = await shipment('RETURNED_TO_WAREHOUSE', 'COMPLETED');
    const boxes = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'QUARANTINED'),($1,'QUARANTINED') RETURNING uid", [destination])).rows.map(row => row.uid as string);
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,assigned_uids) VALUES ($1,$2,$3,2,$4)', [order, medicine, variant, boxes]);
    await admin.query('INSERT INTO shipment_return_items(shipment_id,variant_id,quantity,box_uids,received_by) VALUES ($1,$2,2,$3,$4)', [ship, variant, boxes, employee]);
    await admin.query('INSERT INTO quarantine_balances(facility_id,variant_id,quantity) VALUES ($1,$2,2) ON CONFLICT (facility_id,variant_id) DO UPDATE SET quantity=quarantine_balances.quantity+2', [destination, variant]);
    const dto = { decision: 'PARTIAL_RESTOCK', qaNotes: 'Physical QA', lines: [{ variantId: variant, passQuantity: 1, failQuantity: 1, restockBoxUids: [boxes[1]], scrapBoxUids: [boxes[0]] }] };
    const result = await Promise.allSettled([logistics.dispositionReturn(ship, dto, actor()), logistics.dispositionReturn(ship, dto, actor())]);
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect((await admin.query('SELECT stock_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [destination, variant])).rows[0].stock_quantity).toBe(1);
    expect((await admin.query('SELECT status FROM medicine_boxes WHERE uid=$1', [boxes[0]])).rows[0].status).toBe('DAMAGED');
  });
  it('uses actual receipt UIDs, clears partial reservations and logs source loss once', async () => {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status) VALUES (gen_random_uuid()::text,$1,'WAITING_INTERNAL_TRANSFER') RETURNING id", [destination]);
    const boxes = (await admin.query("INSERT INTO medicine_boxes(current_facility_id,status) VALUES ($1,'RESERVED'),($1,'RESERVED'),($1,'RESERVED') RETURNING uid", [source])).rows.map(row => row.uid as string);
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved,assigned_uids,unit_name) VALUES ($1,$2,$3,3,$4,true,$5,\'Box\')', [order, medicine, variant, source, boxes]);
    await admin.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,3,3) ON CONFLICT (facility_id,variant_id) DO UPDATE SET stock_quantity=3,reserved_quantity=3', [source, variant]);
    const transfer = await id("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES (gen_random_uuid()::text,$1,$2,$3,'DISPATCHED',$4) RETURNING id", [order, source, destination, JSON.stringify([{ variantId: variant, medicineId: medicine, quantity: 3 }])]);
    await stageCustody(transfer, variant, 3, boxes);
    await transfers.adminReceiveInternalTransfer(transfer, actor(), { lines: [{ variantId: variant, receivedQuantity: 1, damagedQuantity: 1, missingQuantity: 1, goodUids: [boxes[2]], damagedUids: [boxes[0]] }] });
    expect((await admin.query('SELECT status FROM medicine_boxes WHERE uid=$1', [boxes[1]])).rows[0].status).toBe('LOST');
    expect((await admin.query('SELECT inventory_reserved,assigned_uids FROM order_items WHERE order_id=$1', [order])).rows[0]).toEqual({ inventory_reserved: false, assigned_uids: [] });
    const logs = (await admin.query("SELECT sum(quantity_changed)::int AS delta FROM inventory_logs WHERE facility_id=$1 AND reference_code=(SELECT transfer_code FROM internal_transfers WHERE id=$2)", [source, transfer])).rows[0];
    expect(logs.delta).toBe(-3);
    const inventory = (await admin.query('SELECT stock_quantity,reserved_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [destination, variant])).rows[0];
    expect(inventory).toEqual({ stock_quantity: 2, reserved_quantity: 0 });
  });
  it('receives a source return through real source-facility policies exactly once', async () => {
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status) VALUES (gen_random_uuid()::text,$1,'CANCELLED') RETURNING id", [destination]);
    await admin.query('UPDATE inventories SET stock_quantity=2,reserved_quantity=2 WHERE facility_id=$1 AND variant_id=$2', [source, variant]);
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved) VALUES ($1,$2,$3,2,$4,true)', [order, medicine, variant, source]);
    const transfer = await id("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES (gen_random_uuid()::text,$1,$2,$3,'RETURN_REQUESTED',$4) RETURNING id", [order, source, destination, JSON.stringify([{ variantId: variant, medicineId: medicine, quantity: 2 }])]);
    await stageCustody(transfer, variant, 2);
    const sourceActor = { ...actor(), facilityId: source, role: 'WAREHOUSE_STAFF' };
    const inspection = { lines: [{ variantId: variant, goodQuantity: 2 }] };
    const result = await Promise.allSettled([transfers.adminReceiveTransferReturn(transfer, inspection, sourceActor), transfers.adminReceiveTransferReturn(transfer, inspection, sourceActor)]);
    if (result.every(row => row.status === 'rejected')) throw (result[0] as PromiseRejectedResult).reason;
    expect(result.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect((await admin.query('SELECT reserved_quantity FROM inventories WHERE facility_id=$1 AND variant_id=$2', [source, variant])).rows[0].reserved_quantity).toBe(0);
    expect((await admin.query("SELECT stock_bucket,quantity_changed,previous_quantity,new_quantity FROM inventory_logs WHERE facility_id=$1 AND variant_id=$2 AND transaction_type='TRANSFER_RETURN_RESTOCK'", [source, variant])).rows).toEqual([
      { stock_bucket: 'AVAILABLE', quantity_changed: 2, previous_quantity: 0, new_quantity: 2 },
    ]);
  });
  it('records damaged source-return stock in quarantine with actual balances', async () => {
    const returnVariant = await id("INSERT INTO packaging_variants(medicine_id,unit_name) VALUES ($1,'Return bulk') RETURNING id", [medicine]);
    const order = await id("INSERT INTO orders(order_code,export_facility_id,order_status) VALUES (gen_random_uuid()::text,$1,'CANCELLED') RETURNING id", [destination]);
    await admin.query('INSERT INTO inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES ($1,$2,2,2)', [source, returnVariant]);
    await admin.query('INSERT INTO order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved) VALUES ($1,$2,$3,2,$4,true)', [order, medicine, returnVariant, source]);
    const transfer = await id("INSERT INTO internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES (gen_random_uuid()::text,$1,$2,$3,'RETURN_REQUESTED',$4) RETURNING id", [order, source, destination, JSON.stringify([{ variantId: returnVariant, medicineId: medicine, quantity: 2 }])]);
    await stageCustody(transfer, returnVariant, 2);
    await transfers.adminReceiveTransferReturn(transfer, { lines: [{ variantId: returnVariant, goodQuantity: 1, damagedQuantity: 1 }] }, { ...actor(), facilityId: source, role: 'WAREHOUSE_STAFF' });
    expect((await admin.query('SELECT quantity FROM quarantine_balances WHERE facility_id=$1 AND variant_id=$2', [source, returnVariant])).rows[0].quantity).toBe(1);
    expect((await admin.query("SELECT previous_quantity,new_quantity,quantity_changed FROM inventory_logs WHERE variant_id=$1 AND stock_bucket='QUARANTINE'", [returnVariant])).rows[0]).toEqual({ previous_quantity: 0, new_quantity: 1, quantity_changed: 1 });
  });
});
