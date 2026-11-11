\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.facilities(id, facility_name, facility_type) VALUES ((SELECT coalesce(max(id), 0) + 1000000 FROM public.facilities), 'Pickup status test', 'PHARMACY') RETURNING id AS unit \gset t_
INSERT INTO public.employees(id, full_name, role, facility_id) VALUES ((SELECT coalesce(max(id), 0) + 1000000 FROM public.employees), 'Pickup status manager', 'STORE_MANAGER', :t_unit) RETURNING id AS actor \gset t_
INSERT INTO public.orders(id, order_code, export_facility_id, order_status) VALUES ((SELECT coalesce(max(id), 0) + 1000000 FROM public.orders), format('PICKUP-%s', txid_current()), :t_unit, 'PROCESSING') RETURNING id AS ord \gset t_
INSERT INTO public.shipments(id, order_id, tracking_number, shipping_status) VALUES ((SELECT coalesce(max(id), 0) + 1000000 FROM public.shipments), :t_ord, format('PICKUP-%s', txid_current()), 'PENDING_PICKUP') RETURNING id AS shipment \gset t_
SELECT set_config('test.order_id', :'t_ord', true), set_config('test.shipment_id', :'t_shipment', true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', :'t_actor', true), set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', 'STORE_MANAGER', true), set_config('app.current_unit_id', :'t_unit', true), set_config('app.order_operation', 'pack', true);
UPDATE public.orders SET order_status = 'PENDING_PICKUP' WHERE id = current_setting('test.order_id')::integer;
SELECT set_config('app.order_operation', 'status', true);
DO $$ BEGIN
  BEGIN
    UPDATE public.orders SET order_status = 'PICKED_UP' WHERE id = current_setting('test.order_id')::integer;
    RAISE EXCEPTION 'Order pickup was allowed without carrier pickup';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
UPDATE public.shipments SET shipping_status = 'PICKED_UP' WHERE id = current_setting('test.shipment_id')::integer;
UPDATE public.orders SET order_status = 'PICKED_UP' WHERE id = current_setting('test.order_id')::integer;
UPDATE public.shipments SET shipping_status = 'IN_TRANSIT' WHERE id = current_setting('test.shipment_id')::integer;
UPDATE public.orders SET order_status = 'SHIPPING' WHERE id = current_setting('test.order_id')::integer;
DO $$ BEGIN
 IF (SELECT order_status FROM public.orders WHERE id = current_setting('test.order_id')::integer) <> 'SHIPPING' THEN
   RAISE EXCEPTION 'Order did not reach shipping';
 END IF;
END $$;
RESET ROLE;
ROLLBACK;
