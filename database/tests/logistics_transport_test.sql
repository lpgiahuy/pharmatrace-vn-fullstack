\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Transport test source','PHARMACY') RETURNING id AS source \gset t_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Transport test destination','PHARMACY') RETURNING id AS dest \gset t_
INSERT INTO public.employees(full_name,role,status,facility_id) VALUES ('Source transporter','WAREHOUSE_STAFF','ACTIVE',:t_source) RETURNING id AS actor \gset t_
INSERT INTO public.employees(full_name,role,status,facility_id) VALUES ('Destination receiver','STORE_MANAGER','ACTIVE',:t_dest) RETURNING id AS receiver \gset t_
INSERT INTO public.orders(order_code,export_facility_id,order_status) VALUES ('TRANSPORT-' || txid_current(),:t_dest,'WAITING_INTERNAL_TRANSFER') RETURNING id AS ord \gset t_
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id) VALUES ('INTERNAL-' || txid_current(),:t_ord,:t_source,:t_dest) RETURNING id AS internal \gset t_
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id) VALUES ('EXTERNAL-' || txid_current(),:t_ord,:t_source,:t_dest) RETURNING id AS external \gset t_
SELECT set_config('test.internal', :'t_internal',true),set_config('test.external', :'t_external',true),set_config('test.actor', :'t_actor',true),set_config('test.receiver', :'t_receiver',true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'t_actor',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_role','WAREHOUSE_STAFF',true),set_config('app.current_unit_id', :'t_source',true),set_config('app.order_operation','dispatch',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.transfer_transport_staff(current_setting('test.internal')::integer)) <> 1 THEN RAISE EXCEPTION 'Staff projection leaked another facility'; END IF;
 BEGIN
  UPDATE public.internal_transfers SET status='DISPATCHED',transport_mode='INTERNAL',transport_employee_id=current_setting('test.receiver')::integer,transport_employee_name='Destination receiver'
  WHERE id=current_setting('test.internal')::integer;
  RAISE EXCEPTION 'Out-of-facility driver accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.internal_transfers SET status='DISPATCHED',transport_mode='INTERNAL',transport_employee_id=current_setting('test.actor')::integer,transport_employee_name='Source transporter',dispatched_at=now()
 WHERE id=current_setting('test.internal')::integer;
 BEGIN
  UPDATE public.internal_transfers SET status='DISPATCHED',transport_mode='THIRD_PARTY',courier_name='GHN'
  WHERE id=current_setting('test.external')::integer;
  RAISE EXCEPTION 'Missing carrier tracking accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.internal_transfers SET status='DISPATCHED',transport_mode='THIRD_PARTY',courier_name='GHN',tracking_code='ACTUAL-GHN-001',dispatched_at=now()
 WHERE id=current_setting('test.external')::integer;
END $$;
SELECT set_config('app.order_operation','receive',true);
DO $$ DECLARE n integer; BEGIN
 UPDATE public.internal_transfers SET status='RECEIVED',received_at=now() WHERE id=current_setting('test.internal')::integer;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Source received for destination'; END IF;
END $$;
SELECT set_config('app.current_user_id', :'t_receiver',true),set_config('app.current_user_role','STORE_MANAGER',true),set_config('app.current_unit_id', :'t_dest',true);
DO $$ DECLARE n integer; BEGIN
 IF EXISTS (SELECT FROM public.transfer_transport_staff(current_setting('test.external')::integer)) THEN RAISE EXCEPTION 'Destination accessed source employee projection'; END IF;
 UPDATE public.internal_transfers SET status='RECEIVED',received_at=now() WHERE id=current_setting('test.internal')::integer;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Destination could not receive internal transport'; END IF;
 UPDATE public.internal_transfers SET status='RECEIVED',received_at=now() WHERE id=current_setting('test.external')::integer;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Destination could not receive third-party transport'; END IF;
END $$;
RESET ROLE;
INSERT INTO public.orders(order_code,export_facility_id,order_status,payment_method,total_amount) VALUES ('COD-RETURN-' || txid_current(),:t_dest,'COMPLETED','COD',100) RETURNING id AS cod_order \gset t_
INSERT INTO public.shipments(order_id,tracking_number,courier_name,shipping_status,actual_delivery_at,cod_amount)
 VALUES (:t_cod_order,'SHARED-CODE-' || txid_current(),'GHN','RETURN_IN_TRANSIT',now(),100) RETURNING id AS ship \gset t_
INSERT INTO public.orders(order_code,export_facility_id,order_status,payment_method,total_amount) VALUES ('COD-FAILED-' || txid_current(),:t_dest,'SHIPPING','COD',100) RETURNING id AS failed_order \gset t_
INSERT INTO public.shipments(order_id,tracking_number,courier_name,shipping_status,cod_amount)
 VALUES (:t_failed_order,'SHARED-CODE-' || txid_current(),'GHTK','RETURN_IN_TRANSIT',100) RETURNING id AS failed_ship \gset t_
SELECT set_config('test.ship', :'t_ship',true),set_config('test.failed_ship', :'t_failed_ship',true);
SET LOCAL ROLE app_user;
SELECT set_config('app.order_operation','status',true);
DO $$ DECLARE receipt integer; BEGIN
 receipt := public.collect_shipment_cod(current_setting('test.ship')::integer);
 IF receipt IS NULL OR receipt IS DISTINCT FROM public.collect_shipment_cod(current_setting('test.ship')::integer) THEN RAISE EXCEPTION 'Return COD receipt is not idempotent'; END IF;
 IF public.collect_shipment_cod(current_setting('test.failed_ship')::integer) IS NOT NULL THEN RAISE EXCEPTION 'Undelivered return COD collected'; END IF;
 IF (SELECT count(*) FROM public.logistics_cod_settlements WHERE shipment_id=current_setting('test.ship')::integer)<>1 THEN RAISE EXCEPTION 'Duplicate settlement'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.cashbook_logs WHERE order_id=(SELECT order_id FROM public.shipments WHERE id=current_setting('test.ship')::integer))<>1 THEN RAISE EXCEPTION 'Duplicate cashbook entry'; END IF;
END $$;
ROLLBACK;
