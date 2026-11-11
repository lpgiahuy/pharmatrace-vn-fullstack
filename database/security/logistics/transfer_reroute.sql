\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install transfer rerouting as a trusted superuser';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.reroute_internal_transfer(target integer, destination integer, reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE t public.internal_transfers%ROWTYPE; o public.orders%ROWTYPE;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'dispatch'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'SUPER_ADMIN'
    OR nullif(current_setting('app.current_user_id', true), '') IS NULL THEN
    RAISE EXCEPTION 'Only a super admin can reroute a transfer' USING ERRCODE = '42501';
  END IF;
  IF length(btrim(coalesce(reason, ''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'A reroute reason is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.internal_transfers WHERE id = target;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO o FROM public.orders WHERE id = t.order_id FOR UPDATE;
  SELECT * INTO t FROM public.internal_transfers WHERE id = target FOR UPDATE;
  IF o.order_status <> 'WAITING_INTERNAL_TRANSFER' OR t.status <> 'DISPATCHED'
    OR o.export_facility_id IS DISTINCT FROM t.to_facility_id
    OR destination IS NULL OR destination IN (t.from_facility_id, t.to_facility_id)
    OR NOT EXISTS (SELECT FROM public.facilities WHERE id = destination)
    OR EXISTS (SELECT FROM public.shipments WHERE order_id = o.id)
    OR EXISTS (SELECT FROM public.internal_transfers WHERE order_id = o.id AND id <> t.id)
    OR jsonb_typeof(t.items) IS DISTINCT FROM 'array' OR jsonb_array_length(t.items) = 0
    OR (SELECT count(*) FROM public.order_items WHERE order_id = o.id) <> jsonb_array_length(t.items)
    OR EXISTS (SELECT FROM public.order_items i WHERE i.order_id = o.id AND NOT EXISTS (
      SELECT FROM jsonb_array_elements(t.items) line
      WHERE (line->>'variantId')::integer = i.variant_id AND (line->>'quantity')::integer = i.quantity))
    OR EXISTS (SELECT FROM public.order_items WHERE order_id = o.id AND (source_facility_id IS DISTINCT FROM t.from_facility_id OR inventory_reserved IS NOT TRUE)) THEN
    RAISE EXCEPTION 'Transfer cannot be rerouted; return the goods and replan the order' USING ERRCODE = '22023';
  END IF;
  UPDATE public.orders SET export_facility_id = destination WHERE id = o.id;
  UPDATE public.internal_transfers SET to_facility_id = destination, distance_km = NULL, estimated_hours = NULL,
    notes = concat_ws(E'\n', nullif(notes, ''), format('Rerouted from facility %s to %s by employee %s: %s', t.to_facility_id, destination, current_setting('app.current_user_id', true), btrim(reason))),
    updated_at = now() WHERE id = target;
END $$;
REVOKE ALL ON FUNCTION public.reroute_internal_transfer(integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reroute_internal_transfer(integer, integer, text) TO app_user;
COMMIT;
