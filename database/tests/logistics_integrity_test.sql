\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Integrity source','PHARMACY') RETURNING id AS source \gset t_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Integrity destination','PHARMACY') RETURNING id AS dest \gset t_
INSERT INTO public.employees(full_name,role,facility_id) VALUES ('Integrity manager','STORE_MANAGER',:t_dest) RETURNING id AS actor \gset t_
INSERT INTO public.customers(full_name) VALUES ('Integrity customer') RETURNING id AS customer \gset t_
INSERT INTO public.customers(full_name) VALUES ('Other customer') RETURNING id AS other_customer \gset t_
INSERT INTO public.medicines(medicine_name) VALUES ('Integrity medicine') RETURNING id AS medicine \gset t_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:t_medicine,'tablet') RETURNING id AS variant \gset t_
INSERT INTO public.orders(order_code,customer_id,export_facility_id,order_status,total_amount,payment_method)
 VALUES ('INT-COD-'||txid_current(),:t_customer,:t_dest,'COMPLETED',100,'COD') RETURNING id AS ord \gset t_
INSERT INTO public.shipments(order_id,tracking_number,courier_name,shipping_status,cod_amount)
 VALUES (:t_ord,'INT-TRK-'||txid_current(),'Test carrier','DELIVERED',100) RETURNING id AS ship \gset t_
INSERT INTO public.orders(order_code,export_facility_id,order_status)
 VALUES ('INT-RET-'||txid_current(),:t_dest,'CANCELLED') RETURNING id AS ret_ord \gset t_
INSERT INTO public.order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved)
 VALUES (:t_ret_ord,:t_medicine,:t_variant,2,:t_source,true);
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items)
 VALUES ('INT-T-'||txid_current(),:t_ret_ord,:t_source,:t_dest,'RETURN_REQUESTED',jsonb_build_array(jsonb_build_object('variantId',:t_variant,'quantity',2))) RETURNING id AS transfer \gset t_
SELECT set_config('test.ship',:'t_ship',true),set_config('test.ord',:'t_ord',true),set_config('test.ret_ord',:'t_ret_ord',true),set_config('test.transfer',:'t_transfer',true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id',:'t_actor',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_role','STORE_MANAGER',true),set_config('app.current_unit_id',:'t_source',true),set_config('app.order_operation','status',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.reconcile_shipment_cod(current_setting('test.ship')::integer,100,10,0,90,'UNAUTHORIZED',NULL);
  RAISE EXCEPTION 'Direct reconciliation succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.submit_cod_statement(current_setting('test.ship')::integer,100,10,0,90,'UNAUTHORIZED',NULL);
  RAISE EXCEPTION 'Manager submitted a COD statement';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('app.current_unit_id',:'t_dest',true),set_config('app.current_user_role','SUPER_ADMIN',true),set_config('app.order_operation','read',true);
DO $$ DECLARE result jsonb; review_id integer; BEGIN
 result := public.submit_cod_statement(current_setting('test.ship')::integer,0,0,0,0,'ZERO-COLLECTED',NULL);
 IF result->>'status' <> 'PENDING' THEN RAISE EXCEPTION 'Statement was not pending'; END IF;
 result := public.approve_cod_statement(current_setting('test.ship')::integer,(result->>'id')::integer);
 IF result->>'status' <> 'DISCREPANCY_PENDING' THEN RAISE EXCEPTION 'Zero collection was not recorded'; END IF;
 IF EXISTS (SELECT FROM public.logistics_cod_settlements WHERE shipment_id=current_setting('test.ship')::integer AND cashbook_id IS NOT NULL) THEN RAISE EXCEPTION 'Fake voucher recorded'; END IF;
 result := public.submit_cod_statement(current_setting('test.ship')::integer,100,10,0,89,'WRONG-NET',NULL);
 result := public.approve_cod_statement(current_setting('test.ship')::integer,(result->>'id')::integer);
 IF result->>'discrepancyStatus' <> 'NET_MISMATCH' THEN RAISE EXCEPTION 'Net mismatch misclassified'; END IF;
 result := public.submit_cod_statement(current_setting('test.ship')::integer,100,10,0,90,'CLEAN',NULL);
 review_id := (result->>'id')::integer;
 result := public.approve_cod_statement(current_setting('test.ship')::integer,review_id);
 IF result->>'status' <> 'SETTLED' OR result->>'cashbookId' IS NULL THEN RAISE EXCEPTION 'Clean settlement failed'; END IF;
 IF public.approve_cod_statement(current_setting('test.ship')::integer,review_id) IS DISTINCT FROM result THEN RAISE EXCEPTION 'Approval retry changed outcome'; END IF;
 IF (SELECT payment_status FROM public.orders WHERE id=current_setting('test.ord')::integer) <> 'PAID' THEN RAISE EXCEPTION 'Order payment not updated'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE balance numeric; BEGIN
 SELECT sum(CASE WHEN transaction_type='INCOME' THEN amount ELSE -amount END) INTO balance FROM public.cashbook_logs WHERE order_id=current_setting('test.ord')::integer;
 IF balance <> 90 OR (SELECT count(*) FROM public.cashbook_logs WHERE order_id=current_setting('test.ord')::integer) <> 1
   OR (SELECT amount FROM public.courier_service_fees WHERE shipment_id=current_setting('test.ship')::integer) <> 10 THEN
   RAISE EXCEPTION 'Cash receipt or carrier fee is incorrect: %',balance;
 END IF;
END $$;

-- Source warehouse can read and clear only the returned transfer reservation.
SET LOCAL ROLE app_user;
SELECT set_config('app.current_unit_id',:'t_source',true),set_config('app.current_user_role','WAREHOUSE_STAFF',true),set_config('app.order_operation','receive',true);
DO $$ DECLARE affected integer; BEGIN
 IF NOT EXISTS (SELECT FROM public.orders WHERE id=current_setting('test.ret_ord')::integer) THEN RAISE EXCEPTION 'Return source cannot read order'; END IF;
 UPDATE public.order_items SET inventory_reserved=false,assigned_uids='{}' WHERE order_id=current_setting('test.ret_ord')::integer;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Return source cannot clear reservation'; END IF;
 UPDATE public.internal_transfers SET status='RETURNED_TO_SOURCE',returned_at=now(),updated_at=now() WHERE id=current_setting('test.transfer')::integer;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>1 THEN RAISE EXCEPTION 'Return source cannot finalize receipt'; END IF;
END $$;

-- Customer dispute scope works; unrelated customer cannot submit against another order.
SELECT set_config('app.current_user_type','customer',true),set_config('app.current_user_role','CUSTOMER',true),set_config('app.order_operation','customer_receive',true),set_config('app.current_user_id',:'t_other_customer',true);
DO $$ BEGIN
 IF public.submit_delivery_dispute(current_setting('test.ord')::integer,'Not mine') <> 'NOT_FOUND' THEN RAISE EXCEPTION 'Other customer can dispute'; END IF;
END $$;
SELECT set_config('app.current_user_id',:'t_customer',true);
DO $$ BEGIN
 IF public.submit_delivery_dispute(current_setting('test.ord')::integer,'Package not received') <> 'SUBMITTED' THEN RAISE EXCEPTION 'Owner dispute denied'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
