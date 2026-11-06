\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.confirm_customer_receipt(target_order integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; shipment public.shipments%ROWTYPE; actor integer;
BEGIN
 IF current_setting('app.order_operation',true) IS DISTINCT FROM 'customer_receive'
 OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'customer'
 OR current_setting('app.current_user_role',true) IS DISTINCT FROM 'CUSTOMER' THEN
   RAISE EXCEPTION 'Customer receipt confirmation is not authorized' USING ERRCODE='42501';
 END IF;
 actor := NULLIF(current_setting('app.current_user_id',true),'')::integer;
 IF actor IS NULL THEN RAISE EXCEPTION 'Missing customer identity' USING ERRCODE='42501'; END IF;
 SELECT * INTO ord FROM public.orders WHERE id=target_order AND customer_id=actor FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 SELECT * INTO shipment FROM public.shipments WHERE order_id=ord.id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_READY'; END IF;
 IF ord.order_status IN ('COMPLETED','DELIVERED') AND shipment.shipping_status='DELIVERED' THEN RETURN 'ALREADY_RECEIVED'; END IF;
 IF ord.order_status IS NULL OR ord.order_status NOT IN ('SHIPPING','IN_TRANSIT') OR shipment.shipping_status IS DISTINCT FROM 'IN_TRANSIT' THEN RETURN 'NOT_READY'; END IF;
 PERFORM set_config('app.logistics_reason','Customer confirmed receipt',true);
 PERFORM set_config('app.logistics_occurred_at',now()::text,true);
 UPDATE public.shipments SET shipping_status='DELIVERED',actual_delivery_at=now(),updated_at=now() WHERE id=shipment.id;
 UPDATE public.orders SET order_status='COMPLETED' WHERE id=ord.id;
 RETURN 'RECEIVED';
END $$;
REVOKE ALL ON FUNCTION public.confirm_customer_receipt(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_customer_receipt(integer) TO app_user;
COMMIT;
