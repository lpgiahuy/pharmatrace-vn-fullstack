\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.log_logistics_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE before_status text; after_status text; identity_type text; identity_id integer; identity_name text; identity_role text;
BEGIN
 identity_type := NULLIF(current_setting('app.current_user_type', true), '');
 identity_id := NULLIF(current_setting('app.current_user_id', true), '')::integer;
 IF identity_type = 'employee' AND identity_id IS NOT NULL THEN
   SELECT full_name, role INTO identity_name, identity_role FROM public.employees WHERE id=identity_id;
 END IF;
 IF identity_type IS NULL AND identity_id IS NOT NULL AND identity_name IS NULL THEN
   SELECT full_name, role INTO identity_name, identity_role FROM public.employees WHERE id=identity_id;
   IF identity_name IS NOT NULL THEN
     identity_type := 'employee';
   END IF;
 END IF;
 IF TG_TABLE_NAME = 'shipments' THEN
   after_status := NEW.shipping_status;
   IF TG_OP = 'UPDATE' THEN before_status := OLD.shipping_status; END IF;
 ELSE
   after_status := NEW.status;
   IF TG_OP = 'UPDATE' THEN before_status := OLD.status; END IF;
 END IF;
 IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'shipments' THEN
   IF (to_jsonb(NEW)->>'courier_name', to_jsonb(NEW)->>'tracking_number', to_jsonb(NEW)->>'carrier_confirmed_at') IS DISTINCT FROM
      (to_jsonb(OLD)->>'courier_name', to_jsonb(OLD)->>'tracking_number', to_jsonb(OLD)->>'carrier_confirmed_at') THEN
     PERFORM set_config('app.logistics_reason', 'Carrier updated: ' || (to_jsonb(OLD)->>'courier_name') || '/' || (to_jsonb(OLD)->>'tracking_number') || ' -> ' || (to_jsonb(NEW)->>'courier_name') || '/' || (to_jsonb(NEW)->>'tracking_number'), true);
     before_status := NULL;
   END IF;
 END IF;
 IF TG_OP = 'INSERT' OR before_status IS DISTINCT FROM after_status THEN
   INSERT INTO public.logistics_events(shipment_id, transfer_id, old_status, new_status, reason, actor_id, occurred_at, actor_type, actor_name, actor_role)
   VALUES (CASE WHEN TG_TABLE_NAME = 'shipments' THEN NEW.id END,
     CASE WHEN TG_TABLE_NAME = 'internal_transfers' THEN NEW.id END,
     before_status, after_status, NULLIF(current_setting('app.logistics_reason', true), ''),
     identity_id, COALESCE(NULLIF(current_setting('app.logistics_occurred_at', true), '')::timestamptz, now()),
     identity_type, identity_name, identity_role);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_logistics_event() FROM PUBLIC,app_user;
COMMIT;
