\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS public.transfer_manifests (
  transfer_id integer PRIMARY KEY REFERENCES public.internal_transfers(id),
  lines jsonb NOT NULL CHECK (jsonb_typeof(lines) = 'array'),
  prepared_by integer NOT NULL REFERENCES public.employees(id),
  prepared_at timestamptz NOT NULL DEFAULT now(),
  transaction_id bigint NOT NULL DEFAULT txid_current()
);
ALTER TABLE public.transfer_manifests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_manifests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.transfer_manifests FROM PUBLIC, app_user;
GRANT SELECT ON public.transfer_manifests TO app_user;
DROP POLICY IF EXISTS transfer_manifest_read ON public.transfer_manifests;
CREATE POLICY transfer_manifest_read ON public.transfer_manifests FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.internal_transfers t WHERE t.id = transfer_id
    AND (public.order_staff(t.from_facility_id) OR public.order_staff(t.to_facility_id)))
);

CREATE OR REPLACE FUNCTION public.record_transfer_manifest(target integer, manifest jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE transfer public.internal_transfers%ROWTYPE; expected jsonb; line jsonb; order_item public.order_items%ROWTYPE;
  scanned uuid[]; expected_quantity integer; variant integer; actor integer;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'dispatch'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true), '') NOT IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF') THEN
    RAISE EXCEPTION 'Manifest preparation is not authorized' USING ERRCODE = '42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id', true), '')::integer;
  SELECT * INTO transfer FROM public.internal_transfers WHERE id = target FOR UPDATE;
  IF NOT FOUND OR transfer.status <> 'REQUESTED' OR public.order_staff(transfer.from_facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Transfer not found at the source facility' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(manifest) IS DISTINCT FROM 'array' OR jsonb_typeof(transfer.items) IS DISTINCT FROM 'array'
    OR jsonb_array_length(manifest) = 0 OR jsonb_array_length(manifest) <> jsonb_array_length(transfer.items) THEN
    RAISE EXCEPTION 'Manifest must include every transfer line' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(DISTINCT (value->>'variantId')::integer) FROM jsonb_array_elements(manifest)) <> jsonb_array_length(manifest) THEN
    RAISE EXCEPTION 'Duplicate manifest variants' USING ERRCODE = '22023';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(manifest) LOOP
    variant := (line->>'variantId')::integer;
    SELECT value INTO expected FROM jsonb_array_elements(transfer.items) WHERE (value->>'variantId')::integer = variant;
    expected_quantity := (expected->>'quantity')::integer;
    IF expected IS NULL OR (line->>'quantity')::integer IS DISTINCT FROM expected_quantity OR expected_quantity <= 0
      OR jsonb_typeof(line->'boxUids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Manifest does not match transfer quantities' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO order_item FROM public.order_items WHERE order_id = transfer.order_id AND variant_id = variant
      AND source_facility_id = transfer.from_facility_id AND inventory_reserved = true FOR UPDATE;
    IF NOT FOUND OR order_item.quantity <> expected_quantity THEN
      RAISE EXCEPTION 'Transfer reservation does not match manifest' USING ERRCODE = '22023';
    END IF;
    IF (order_item.unit_name IS NULL OR upper(order_item.unit_name) ~ '(BOX|BLISTER|BOTTLE|VIAL|TUBE|PACK|SACHET|AMPOULE|PILL|TABLET|CAPSULE)')
      AND cardinality(order_item.assigned_uids) <> expected_quantity THEN
      RAISE EXCEPTION 'Tracked transfer packages require reserved UIDs' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(array_agg(uid ORDER BY uid), '{}'::uuid[]) INTO scanned
      FROM (SELECT value::uuid AS uid FROM jsonb_array_elements_text(line->'boxUids')) s;
    IF cardinality(scanned) <> (SELECT count(DISTINCT uid) FROM unnest(scanned) uid)
      OR scanned IS DISTINCT FROM ARRAY(SELECT uid FROM unnest(order_item.assigned_uids) uid ORDER BY uid)
      OR (cardinality(scanned) > 0 AND (cardinality(scanned) <> expected_quantity OR
        (SELECT count(*) FROM public.medicine_boxes b WHERE b.uid = ANY(scanned) AND b.current_facility_id = transfer.from_facility_id AND b.status = 'RESERVED') <> expected_quantity)) THEN
      RAISE EXCEPTION 'Scanned UIDs do not match reserved source packages' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  INSERT INTO public.transfer_manifests(transfer_id, lines, prepared_by, transaction_id) VALUES (target, manifest, actor, txid_current())
    ON CONFLICT (transfer_id) DO UPDATE SET lines = EXCLUDED.lines, prepared_by = EXCLUDED.prepared_by,
      prepared_at = now(), transaction_id = EXCLUDED.transaction_id;
END $$;
REVOKE ALL ON FUNCTION public.record_transfer_manifest(integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_transfer_manifest(integer, jsonb) TO app_user;

CREATE OR REPLACE FUNCTION public.require_transfer_manifest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status = 'DISPATCHED' AND OLD.status IS DISTINCT FROM NEW.status
    AND NOT EXISTS (SELECT FROM public.transfer_manifests m WHERE m.transfer_id = NEW.id AND m.transaction_id = txid_current()) THEN
    RAISE EXCEPTION 'A scanned source manifest is required before dispatch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_transfer_manifest() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS require_transfer_manifest ON public.internal_transfers;
CREATE TRIGGER require_transfer_manifest BEFORE UPDATE ON public.internal_transfers
FOR EACH ROW EXECUTE FUNCTION public.require_transfer_manifest();
COMMIT;
