\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('Logistics source test','PHARMACY') RETURNING id AS source \gset test_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('Logistics destination test','PHARMACY') RETURNING id AS dest \gset test_
INSERT INTO public.facilities(facility_name, facility_type) VALUES ('Logistics unrelated test','PHARMACY') RETURNING id AS other \gset test_
INSERT INTO public.employees(full_name, role, facility_id) VALUES ('Logistics test admin','SUPER_ADMIN',:test_source) RETURNING id AS actor \gset test_
INSERT INTO public.medicines(medicine_name) VALUES ('Logistics test medicine') RETURNING id AS medicine \gset test_
INSERT INTO public.packaging_variants(medicine_id,unit_name) VALUES (:test_medicine,'tablet') RETURNING id AS variant \gset test_
INSERT INTO public.inventories(facility_id,variant_id,stock_quantity,reserved_quantity) VALUES (:test_source,:test_variant,5,2);
INSERT INTO public.orders(order_code,export_facility_id,order_status,total_amount,payment_method) VALUES (format('LOG-COD-%s',txid_current()),:test_dest,'COMPLETED',100,'COD') RETURNING id AS cod_order \gset test_
INSERT INTO public.shipments(order_id,tracking_number,shipping_status,cod_amount) VALUES (:test_cod_order,format('LOG-TRK-%s',txid_current()),'DELIVERED',100) RETURNING id AS shipment \gset test_
INSERT INTO public.orders(order_code,export_facility_id,order_status) VALUES (format('LOG-TRANSFER-%s',txid_current()),:test_dest,'WAITING_INTERNAL_TRANSFER') RETURNING id AS transfer_order \gset test_
INSERT INTO public.order_items(order_id,medicine_id,variant_id,quantity,inventory_reserved,source_facility_id) VALUES (:test_transfer_order,:test_medicine,:test_variant,2,true,:test_source);
INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,items) VALUES (format('LOG-ITR-%s',txid_current()),:test_transfer_order,:test_source,:test_dest,jsonb_build_array(jsonb_build_object('variantId',:test_variant,'quantity',2))) RETURNING id AS transfer \gset test_
SELECT set_config('test.shipment', :'test_shipment', true), set_config('test.transfer', :'test_transfer', true), set_config('test.source', :'test_source', true), set_config('test.variant', :'test_variant', true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'test_actor', true), set_config('app.current_user_type','employee',true), set_config('app.current_user_role','STORE_MANAGER',true), set_config('app.current_unit_id', :'test_other', true), set_config('app.order_operation','status',true);
DO $$ BEGIN
 BEGIN PERFORM public.collect_shipment_cod(current_setting('test.shipment')::integer); RAISE EXCEPTION 'Out-of-facility collection succeeded';
 EXCEPTION WHEN no_data_found THEN NULL; END;
END $$;
SELECT set_config('app.current_user_role','SUPER_ADMIN',true);
DO $$ DECLARE first_id integer; BEGIN
 first_id := public.collect_shipment_cod(current_setting('test.shipment')::integer);
 IF first_id IS NULL OR public.collect_shipment_cod(current_setting('test.shipment')::integer) IS DISTINCT FROM first_id THEN RAISE EXCEPTION 'COD duplicate handling failed'; END IF;
 IF (SELECT count(*) FROM public.logistics_cod_settlements WHERE shipment_id = current_setting('test.shipment')::integer) <> 1 THEN RAISE EXCEPTION 'COD settlement missing'; END IF;
END $$;
SELECT set_config('app.order_operation','dispatch',true);
DO $$ BEGIN
 IF public.cancel_internal_transfer(current_setting('test.transfer')::integer) IS NOT TRUE THEN RAISE EXCEPTION 'Transfer cancellation failed'; END IF;
 IF public.cancel_internal_transfer(current_setting('test.transfer')::integer) IS NOT FALSE THEN RAISE EXCEPTION 'Repeated cancellation succeeded'; END IF;
 IF (SELECT status FROM public.internal_transfers WHERE id=current_setting('test.transfer')::integer) <> 'CANCELLED' THEN RAISE EXCEPTION 'Transfer status not updated'; END IF;
 IF (SELECT count(*) FROM public.logistics_events WHERE transfer_id=current_setting('test.transfer')::integer) <> 2 THEN RAISE EXCEPTION 'Transfer history missing'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT reserved_quantity FROM public.inventories WHERE facility_id=current_setting('test.source')::integer AND variant_id=current_setting('test.variant')::integer) <> 0 THEN RAISE EXCEPTION 'Reservation was not released'; END IF;
END $$;
ROLLBACK;
