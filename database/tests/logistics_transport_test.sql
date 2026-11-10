\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Transport test source','PHARMACY') RETURNING id AS source \gset t_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Transport test destination','PHARMACY') RETURNING id AS dest \gset t_
INSERT INTO public.employees(full_name,role,status,facility_id) VALUES ('Source transporter','WAREHOUSE_STAFF','ACTIVE',:t_source) RETURNING id AS actor \gset t_
INSERT INTO public.employees(full_name,role,status,facility_id) VALUES ('Destination receiver','STORE_MANAGER','ACTIVE',:t_dest) RETURNING id AS receiver \gset t_
INSERT INTO public.orders(order_code,export_facility_id,order_status) VALUES ('TRANSPORT-' || txid_current(),:t_dest,'WAITING_INTERNAL_TRANSFER') RETURNING id AS ord \gset t_
INSERT INTO public.medicines(medicine_name) VALUES ('Transport medicine') RETURNING id AS medicine \gset t_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:t_medicine,'kg') RETURNING id AS variant \gset t_
INSERT INTO public.order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved,unit_name) VALUES (:t_ord,:t_medicine,:t_variant,1,:t_source,true,'kg');
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,items) VALUES ('INTERNAL-' || txid_current(),:t_ord,:t_source,:t_dest,jsonb_build_array(jsonb_build_object('variantId',:t_variant,'quantity',1))) RETURNING id AS internal \gset t_
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,items) VALUES ('EXTERNAL-' || txid_current(),:t_ord,:t_source,:t_dest,jsonb_build_array(jsonb_build_object('variantId',:t_variant,'quantity',1))) RETURNING id AS external \gset t_
SELECT set_config('test.internal', :'t_internal',true),set_config('test.external', :'t_external',true),set_config('test.actor', :'t_actor',true),set_config('test.receiver', :'t_receiver',true),set_config('test.variant', :'t_variant',true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'t_actor',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_role','WAREHOUSE_STAFF',true),set_config('app.current_unit_id', :'t_source',true),set_config('app.order_operation','dispatch',true);
DO $$ BEGIN
 PERFORM public.record_transfer_manifest(current_setting('test.internal')::integer,jsonb_build_array(jsonb_build_object('variantId',current_setting('test.variant')::integer,'quantity',1,'boxUids','[]'::jsonb)));
 PERFORM public.record_transfer_manifest(current_setting('test.external')::integer,jsonb_build_array(jsonb_build_object('variantId',current_setting('test.variant')::integer,'quantity',1,'boxUids','[]'::jsonb)));
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
DO $$ BEGIN
 BEGIN
  PERFORM public.collect_shipment_cod(current_setting('test.ship')::integer);
  RAISE EXCEPTION 'COD collection accepted without a settled statement';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.collect_shipment_cod(current_setting('test.failed_ship')::integer);
  RAISE EXCEPTION 'Undelivered return COD collected';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
ROLLBACK;
