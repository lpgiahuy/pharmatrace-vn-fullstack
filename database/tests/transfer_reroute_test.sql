\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Reroute source','PHARMACY') RETURNING id AS source \gset t_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Reroute destination','PHARMACY') RETURNING id AS dest \gset t_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Reroute new destination','PHARMACY') RETURNING id AS new_dest \gset t_
INSERT INTO public.employees(full_name,role,facility_id) VALUES ('Reroute admin','SUPER_ADMIN',:t_source) RETURNING id AS actor \gset t_
INSERT INTO public.medicines(medicine_name) VALUES ('Reroute medicine') RETURNING id AS medicine \gset t_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:t_medicine,'kg') RETURNING id AS variant \gset t_
INSERT INTO public.orders(order_code,export_facility_id,order_status) VALUES ('REROUTE-'||txid_current(),:t_dest,'WAITING_INTERNAL_TRANSFER') RETURNING id AS ord \gset t_
INSERT INTO public.order_items(order_id,medicine_id,variant_id,quantity,source_facility_id,inventory_reserved) VALUES (:t_ord,:t_medicine,:t_variant,1,:t_source,true);
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items) VALUES ('REROUTE-'||txid_current(),:t_ord,:t_source,:t_dest,'DISPATCHED',jsonb_build_array(jsonb_build_object('variantId',:t_variant,'quantity',1))) RETURNING id AS transfer \gset t_
SELECT set_config('test.transfer',:'t_transfer',true),set_config('test.order',:'t_ord',true),set_config('test.destination',:'t_new_dest',true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id',:'t_actor',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_role','STORE_MANAGER',true),set_config('app.current_unit_id',:'t_source',true),set_config('app.order_operation','dispatch',true);
DO $$ BEGIN
 BEGIN
  PERFORM public.reroute_internal_transfer(current_setting('test.transfer')::int,current_setting('test.destination')::int,'Changed route');
  RAISE EXCEPTION 'Manager changed the delivery plan';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT set_config('app.current_user_role','SUPER_ADMIN',true);
DO $$ BEGIN
 BEGIN
  UPDATE public.internal_transfers SET to_facility_id=current_setting('test.destination')::int WHERE id=current_setting('test.transfer')::int;
  RAISE EXCEPTION 'Direct destination update allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.reroute_internal_transfer(current_setting('test.transfer')::int,current_setting('test.destination')::int,'Changed route');
  RAISE EXCEPTION 'Administrator changed the delivery plan';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF (SELECT to_facility_id FROM public.internal_transfers WHERE id=current_setting('test.transfer')::int) = current_setting('test.destination')::int
   OR (SELECT export_facility_id FROM public.orders WHERE id=current_setting('test.order')::int) = current_setting('test.destination')::int THEN
  RAISE EXCEPTION 'Rejected reroute changed order or transfer destination';
 END IF;
END $$;
RESET ROLE;
ROLLBACK;
