\set ON_ERROR_STOP on
BEGIN;
SELECT greatest((SELECT coalesce(max(id),0) FROM public.employees),(SELECT coalesce(max(id),0) FROM public.customers))+10000 AS shared_identity \gset t_
INSERT INTO public.customers(id,full_name) VALUES (:t_shared_identity,'Receipt test owner') RETURNING id AS owner \gset t_
INSERT INTO public.customers(full_name) VALUES ('Receipt test other') RETURNING id AS other \gset t_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Receipt test facility','PHARMACY') RETURNING id AS unit \gset t_
INSERT INTO public.facilities(facility_name,facility_type) VALUES ('Receipt test other facility','PHARMACY') RETURNING id AS other_unit \gset t_
SELECT :t_shared_identity AS employee \gset t_
INSERT INTO public.employees(id,full_name,role,facility_id) VALUES (:t_employee,'Receipt test manager','STORE_MANAGER',:t_unit);
INSERT INTO public.orders(order_code,customer_id,export_facility_id,order_status) VALUES ('RECEIPT-'||txid_current(),:t_owner,:t_unit,'SHIPPING') RETURNING id AS ord \gset t_
INSERT INTO public.shipments(order_id,tracking_number,shipping_status) VALUES (:t_ord,'RECEIPT-'||txid_current(),'PENDING_PICKUP') RETURNING id AS shipment \gset t_
INSERT INTO public.logistics_events(shipment_id,new_status,actor_id,actor_type) VALUES (:t_shipment,'IN_TRANSIT',:t_employee,NULL) RETURNING id AS legacy_event \gset t_
SELECT set_config('test.order', :'t_ord',true),set_config('test.shipment', :'t_shipment',true),set_config('test.event', :'t_legacy_event',true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'t_other',true),set_config('app.current_user_type','customer',true),set_config('app.current_user_role','CUSTOMER',true),set_config('app.order_operation','customer_receive',true);
DO $$ BEGIN
 IF public.confirm_customer_receipt(current_setting('test.order')::integer)<>'NOT_FOUND' THEN RAISE EXCEPTION 'Another customer can confirm receipt'; END IF;
 IF EXISTS(SELECT FROM public.logistics_event_actor(current_setting('test.event')::bigint)) THEN RAISE EXCEPTION 'Customer accessed employee projection'; END IF;
END $$;
SELECT set_config('app.current_user_id', :'t_owner',true);
DO $$ DECLARE affected integer; BEGIN
 IF public.confirm_customer_receipt(current_setting('test.order')::integer)<>'NOT_READY' THEN RAISE EXCEPTION 'Pending pickup was confirmed'; END IF;
 BEGIN UPDATE public.shipments SET shipping_status='DELIVERED' WHERE id=current_setting('test.shipment')::integer;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected<>0 THEN RAISE EXCEPTION 'Customer directly updated shipment'; END IF;
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
UPDATE public.shipments SET shipping_status='IN_TRANSIT' WHERE id=:t_shipment;
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'t_employee',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_role','STORE_MANAGER',true),set_config('app.current_unit_id', :'t_unit',true),set_config('app.order_operation','status',true);
DO $$ BEGIN
 BEGIN UPDATE public.shipments SET shipping_status='DELIVERED' WHERE id=current_setting('test.shipment')::integer;
 RAISE EXCEPTION 'Staff directly confirmed shipment'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.orders SET order_status='COMPLETED' WHERE id=current_setting('test.order')::integer;
 RAISE EXCEPTION 'Staff directly completed order'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.confirm_customer_receipt(current_setting('test.order')::integer);
 RAISE EXCEPTION 'Employee called customer receipt'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('app.current_user_id', :'t_owner',true),set_config('app.current_user_type','customer',true),set_config('app.current_user_role','CUSTOMER',true),set_config('app.order_operation','customer_receive',true);
DO $$ BEGIN
 IF public.confirm_customer_receipt(current_setting('test.order')::integer)<>'RECEIVED' THEN RAISE EXCEPTION 'Owner could not confirm'; END IF;
 IF public.confirm_customer_receipt(current_setting('test.order')::integer)<>'ALREADY_RECEIVED' THEN RAISE EXCEPTION 'Retry was not idempotent'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT order_status FROM public.orders WHERE id=current_setting('test.order')::integer)<>'COMPLETED' OR
    (SELECT shipping_status FROM public.shipments WHERE id=current_setting('test.shipment')::integer)<>'DELIVERED' THEN RAISE EXCEPTION 'Order and shipment inconsistent'; END IF;
 IF (SELECT count(*) FROM public.logistics_events WHERE shipment_id=current_setting('test.shipment')::integer AND new_status='DELIVERED' AND actor_type='customer')<>1 THEN RAISE EXCEPTION 'Customer receipt was not audited exactly once'; END IF;
END $$;
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'t_employee',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_role','STORE_MANAGER',true),set_config('app.current_unit_id', :'t_unit',true),set_config('app.order_operation','read',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM public.logistics_event_actor(current_setting('test.event')::bigint) WHERE actor_name='Receipt test manager') THEN RAISE EXCEPTION 'Authorized actor projection missing'; END IF;
END $$;
SELECT set_config('app.current_unit_id', :'t_other_unit',true);
DO $$ BEGIN
 IF EXISTS(SELECT FROM public.logistics_event_actor(current_setting('test.event')::bigint)) THEN RAISE EXCEPTION 'Other facility accessed employee projection'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
