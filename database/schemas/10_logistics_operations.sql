\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
   RAISE EXCEPTION 'Logistics functions must be installed by a trusted superuser';
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.logistics_events (
 id bigserial PRIMARY KEY,
 shipment_id integer REFERENCES public.shipments(id) ON DELETE RESTRICT,
 transfer_id integer REFERENCES public.internal_transfers(id) ON DELETE RESTRICT,
 old_status text, new_status text NOT NULL, reason text,
 actor_id integer, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((shipment_id IS NULL) <> (transfer_id IS NULL))
);
CREATE TABLE IF NOT EXISTS public.logistics_cod_settlements (
 shipment_id integer PRIMARY KEY REFERENCES public.shipments(id) ON DELETE RESTRICT,
 cashbook_id integer NOT NULL UNIQUE REFERENCES public.cashbook_logs(id) ON DELETE RESTRICT,
 amount numeric(15,2) NOT NULL CHECK (amount > 0),
 collected_by integer NOT NULL REFERENCES public.employees(id),
 collected_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.logistics_events ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE public.logistics_events ADD COLUMN IF NOT EXISTS actor_type varchar(20), ADD COLUMN IF NOT EXISTS actor_name varchar(150), ADD COLUMN IF NOT EXISTS actor_role varchar(50);
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
CREATE OR REPLACE FUNCTION public.collect_shipment_cod(target_id integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE shipment public.shipments%ROWTYPE; unit_id integer; actor integer; cash_id integer;
BEGIN
 IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) NOT IN ('SUPER_ADMIN', 'STORE_MANAGER') THEN
   RAISE EXCEPTION 'COD collection is not authorized' USING ERRCODE = '42501';
 END IF;
 actor := NULLIF(current_setting('app.current_user_id', true), '')::integer;
 IF actor IS NULL THEN RAISE EXCEPTION 'Missing actor' USING ERRCODE = '42501'; END IF;
 SELECT * INTO shipment FROM public.shipments WHERE id = target_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE = 'P0002'; END IF;
 SELECT export_facility_id INTO unit_id FROM public.orders WHERE id = shipment.order_id;
 IF public.order_staff(unit_id) IS NOT TRUE THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE = 'P0002'; END IF;
 IF shipment.cod_settlement_status = 'SETTLED' THEN
   SELECT cashbook_id INTO cash_id FROM public.logistics_cod_settlements WHERE shipment_id = shipment.id;
   RETURN cash_id;
 END IF;
 IF (shipment.shipping_status <> 'DELIVERED' AND NOT (shipment.actual_delivery_at IS NOT NULL AND shipment.shipping_status IN ('RETURN_REQUESTED','RETURN_IN_TRANSIT','RETURNED_TO_WAREHOUSE')))
    OR shipment.cod_amount <= 0 OR shipment.cod_settlement_status <> 'UNSETTLED' THEN
   RETURN NULL;
 END IF;
 INSERT INTO public.cashbook_logs(transaction_code, transaction_type, category, amount, party_type, order_id, payment_method, created_by_user_id)
 VALUES ('COD-SHIP-' || shipment.id, 'INCOME', 'COD', shipment.cod_amount, 'OTHER', shipment.order_id, 'CASH', actor) RETURNING id INTO cash_id;
 UPDATE public.shipments SET cod_settlement_status = 'SETTLED', cod_settled_at = now(), updated_at = now() WHERE id = shipment.id;
 INSERT INTO public.logistics_cod_settlements(shipment_id, cashbook_id, amount, collected_by) VALUES (shipment.id, cash_id, shipment.cod_amount, actor);
 RETURN cash_id;
END $$;
CREATE OR REPLACE FUNCTION public.cancel_internal_transfer(target_id integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE t public.internal_transfers%ROWTYPE; item jsonb; oi public.order_items%ROWTYPE; affected integer; order_state text;
BEGIN
 IF current_setting('app.order_operation', true) IS DISTINCT FROM 'dispatch'
   OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
   OR current_setting('app.current_user_role', true) NOT IN ('SUPER_ADMIN','STORE_MANAGER','WAREHOUSE_STAFF')
   OR NULLIF(current_setting('app.current_user_id', true), '') IS NULL THEN
   RAISE EXCEPTION 'Transfer cancellation is not authorized' USING ERRCODE = '42501';
 END IF;
 SELECT * INTO t FROM public.internal_transfers WHERE id = target_id;
 IF NOT FOUND OR public.order_staff(t.from_facility_id) IS NOT TRUE THEN RAISE EXCEPTION 'Transfer not found' USING ERRCODE = 'P0002'; END IF;
 SELECT order_status INTO order_state FROM public.orders WHERE id = t.order_id FOR UPDATE;
 SELECT * INTO t FROM public.internal_transfers WHERE id = target_id FOR UPDATE;
 IF t.status <> 'REQUESTED' OR order_state <> 'WAITING_INTERNAL_TRANSFER' THEN RETURN false; END IF;
 IF jsonb_typeof(t.items) <> 'array' OR jsonb_array_length(t.items) = 0 THEN RAISE EXCEPTION 'Invalid transfer items' USING ERRCODE = '22023'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(t.items) LOOP
   SELECT * INTO STRICT oi FROM public.order_items WHERE order_id = t.order_id
     AND variant_id = (item->>'variantId')::integer AND source_facility_id = t.from_facility_id
     AND inventory_reserved = true AND quantity = (item->>'quantity')::integer FOR UPDATE;
   UPDATE public.inventories SET reserved_quantity = reserved_quantity - oi.quantity, updated_at = now()
     WHERE facility_id = t.from_facility_id AND variant_id = oi.variant_id AND reserved_quantity >= oi.quantity;
   GET DIAGNOSTICS affected = ROW_COUNT;
   IF affected <> 1 THEN RAISE EXCEPTION 'Inconsistent inventory reservation' USING ERRCODE = '22023'; END IF;
   IF cardinality(oi.assigned_uids) > 0 THEN
     UPDATE public.medicine_boxes SET status = 'IN_STOCK' WHERE uid = ANY(oi.assigned_uids)
       AND current_facility_id = t.from_facility_id AND status = 'RESERVED';
     GET DIAGNOSTICS affected = ROW_COUNT;
     IF affected <> cardinality(oi.assigned_uids) THEN RAISE EXCEPTION 'Inconsistent box reservation' USING ERRCODE = '22023'; END IF;
   END IF;
   UPDATE public.order_items SET inventory_reserved = false, assigned_uids = ARRAY[]::uuid[] WHERE id = oi.id;
 END LOOP;
 UPDATE public.internal_transfers SET status = 'CANCELLED', notes = 'Cancelled before dispatch; order requires replanning or cancellation', updated_at = now() WHERE id = t.id;
 RETURN true;
END $$;
DROP TRIGGER IF EXISTS logistics_shipment_event ON public.shipments;
CREATE TRIGGER logistics_shipment_event AFTER INSERT OR UPDATE ON public.shipments FOR EACH ROW EXECUTE FUNCTION public.log_logistics_event();
DROP TRIGGER IF EXISTS logistics_transfer_event ON public.internal_transfers;
CREATE TRIGGER logistics_transfer_event AFTER INSERT OR UPDATE ON public.internal_transfers FOR EACH ROW EXECUTE FUNCTION public.log_logistics_event();
COMMIT;
