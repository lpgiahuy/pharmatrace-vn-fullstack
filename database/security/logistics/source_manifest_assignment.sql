\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.prepare_dispatch_manifest(target integer, manifest jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.internal_transfers%ROWTYPE; ord public.orders%ROWTYPE; item public.order_items%ROWTYPE;
  line jsonb; scanned uuid[]; changed integer;
BEGIN
  SELECT * INTO t FROM public.internal_transfers WHERE id=target;
  SELECT * INTO ord FROM public.orders WHERE id=t.order_id FOR UPDATE;
  SELECT * INTO t FROM public.internal_transfers WHERE id=target FOR UPDATE;
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'dispatch'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR nullif(current_setting('app.current_user_id',true),'') IS NULL
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER','WAREHOUSE_STAFF')
    OR public.order_staff(t.from_facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Source handoff is not authorized' USING ERRCODE='42501';
  END IF;
  IF t.id IS NULL OR t.status<>'REQUESTED' OR ord.order_status<>'WAITING_INTERNAL_TRANSFER'
    OR coalesce(ord.prescription_review_status,'APPROVED')<>'APPROVED'
    OR jsonb_typeof(manifest) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Transfer is not ready for source handoff' USING ERRCODE='22023';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(manifest) LOOP
    SELECT * INTO item FROM public.order_items WHERE order_id=t.order_id
      AND variant_id=(line->>'variantId')::integer AND source_facility_id=t.from_facility_id FOR UPDATE;
    IF item.id IS NULL OR item.inventory_reserved IS NOT TRUE OR item.quantity IS DISTINCT FROM (line->>'quantity')::integer
      OR jsonb_typeof(line->'boxUids') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Scanned line does not match the source reservation' USING ERRCODE='22023';
    END IF;
    IF cardinality(item.assigned_uids)=0 AND jsonb_array_length(line->'boxUids')>0 THEN
      SELECT array_agg(value::uuid) INTO scanned FROM jsonb_array_elements_text(line->'boxUids');
      IF cardinality(scanned)<>item.quantity OR cardinality(scanned)<>(SELECT count(DISTINCT uid) FROM unnest(scanned) uid) THEN
        RAISE EXCEPTION 'Scan one unique UID for each reserved unit' USING ERRCODE='22023';
      END IF;
      UPDATE public.medicine_boxes b SET status='RESERVED'
        WHERE b.uid=ANY(scanned) AND b.current_facility_id=t.from_facility_id AND b.status='IN_STOCK'
          AND EXISTS (SELECT FROM public.batches batch WHERE batch.id=b.batch_id AND batch.medicine_id=item.medicine_id
            AND batch.status='ACTIVE' AND batch.expiry_date>current_date);
      GET DIAGNOSTICS changed=ROW_COUNT;
      IF changed<>item.quantity THEN RAISE EXCEPTION 'Scanned packages are unavailable, ineligible or belong to another medicine' USING ERRCODE='22023'; END IF;
      UPDATE public.order_items SET assigned_uids=scanned WHERE id=item.id;
    END IF;
  END LOOP;
  -- The existing validator checks completeness and exact agreement with every transfer line.
  PERFORM public.record_transfer_manifest(target,manifest);
END $$;
REVOKE ALL ON FUNCTION public.prepare_dispatch_manifest(integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prepare_dispatch_manifest(integer,jsonb) TO app_user;
COMMIT;
