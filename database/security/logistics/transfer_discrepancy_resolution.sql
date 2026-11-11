\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS public.transfer_resolutions (
  transfer_id integer PRIMARY KEY REFERENCES public.internal_transfers(id),
  action text NOT NULL CHECK (action IN ('RESUPPLY','ACCEPT_SHORTAGE')),
  source_facility_id integer REFERENCES public.facilities(id),
  reason text NOT NULL,
  customer_agreement text,
  resolved_by integer NOT NULL REFERENCES public.employees(id),
  resolved_at timestamptz NOT NULL DEFAULT now(),
  replacement_transfer_id integer REFERENCES public.internal_transfers(id)
);
REVOKE ALL ON public.transfer_resolutions FROM PUBLIC, app_user;
GRANT SELECT ON public.transfer_resolutions TO app_user;
ALTER TABLE public.transfer_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_resolutions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resolution_read ON public.transfer_resolutions;
CREATE POLICY resolution_read ON public.transfer_resolutions FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.internal_transfers t WHERE t.id=transfer_id AND public.order_staff(t.to_facility_id))
);
CREATE OR REPLACE FUNCTION public.resolve_transfer_discrepancy(target integer, decision text, source integer, reason text, agreement text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.internal_transfers%ROWTYPE; ord public.orders%ROWTYPE; item public.order_items%ROWTYPE;
  line jsonb; good integer; units integer; uids uuid[]; replacement integer; lines jsonb := '[]'; actor integer;
BEGIN
  actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
  SELECT * INTO t FROM public.internal_transfers WHERE id=target;
  SELECT * INTO ord FROM public.orders WHERE id=t.order_id FOR UPDATE;
  SELECT * INTO t FROM public.internal_transfers WHERE id=target FOR UPDATE;
  IF actor IS NULL OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR current_setting('app.order_operation',true) IS DISTINCT FROM 'replace'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER')
    OR public.order_staff(t.to_facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Destination manager approval is required' USING ERRCODE='42501';
  END IF;
  IF EXISTS (SELECT FROM public.transfer_resolutions WHERE transfer_id=target) THEN
    RETURN jsonb_build_object('id',target,'status','ALREADY_RESOLVED');
  END IF;
  IF t.status <> 'RECEIVED_WITH_DISCREPANCY' OR ord.order_status <> 'WAITING_INTERNAL_TRANSFER'
    OR EXISTS (SELECT FROM public.shipments WHERE order_id=ord.id)
    OR decision IS NULL OR decision NOT IN ('RESUPPLY','ACCEPT_SHORTAGE')
    OR length(btrim(coalesce(reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid discrepancy resolution or order state' USING ERRCODE='22023';
  END IF;
  IF decision='ACCEPT_SHORTAGE' AND (ord.payment_status IS DISTINCT FROM 'UNPAID' OR ord.voucher_id IS NOT NULL
    OR coalesce(ord.used_points,0) <> 0 OR coalesce(ord.discount_amount,0) <> 0
    OR length(btrim(coalesce(agreement,''))) NOT BETWEEN 1 AND 500
    OR EXISTS (SELECT FROM public.online_payment_receipts WHERE order_id=ord.id AND status <> 'REJECTED')
    OR EXISTS (SELECT FROM public.payment_exceptions WHERE order_id=ord.id)) THEN
    RAISE EXCEPTION 'Shortage acceptance requires customer agreement and an unpaid order without discounts, points or payment evidence' USING ERRCODE='22023';
  END IF;
  IF decision='RESUPPLY' AND NOT EXISTS (SELECT FROM public.facilities WHERE id=source AND facility_type IN ('CENTRAL_WAREHOUSE','BRANCH_WAREHOUSE','PHARMACY')) THEN
    RAISE EXCEPTION 'Choose a valid replacement source' USING ERRCODE='22023';
  END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(t.variance_details) LOOP
    IF (line->>'damagedQuantity')::integer + (line->>'missingQuantity')::integer = 0 THEN CONTINUE; END IF;
    SELECT * INTO STRICT item FROM public.order_items WHERE order_id=ord.id AND variant_id=(line->>'variantId')::integer FOR UPDATE;
    IF item.inventory_reserved OR item.source_facility_id IS DISTINCT FROM t.to_facility_id THEN
      RAISE EXCEPTION 'Order allocation changed; reload before resolving' USING ERRCODE='22023';
    END IF;
    good:=(line->>'goodQuantity')::integer;
    units:=CASE WHEN decision='RESUPPLY' THEN item.quantity ELSE good END;
    IF decision='ACCEPT_SHORTAGE' THEN source:=t.to_facility_id; END IF;
    IF units=0 THEN
      DELETE FROM public.order_items WHERE id=item.id;
      CONTINUE;
    END IF;
    UPDATE public.inventories SET reserved_quantity=coalesce(reserved_quantity,0)+units,updated_at=now()
      WHERE facility_id=source AND variant_id=item.variant_id AND stock_quantity-coalesce(reserved_quantity,0)>=units;
    IF NOT FOUND THEN RAISE EXCEPTION 'Replacement stock is insufficient for variant %',item.variant_id USING ERRCODE='22023'; END IF;
    uids:='{}';
    IF cardinality(item.assigned_uids)>0 OR item.unit_name IS NULL OR upper(item.unit_name) ~ '(BOX|BLISTER|BOTTLE|VIAL|TUBE|PACK|SACHET|AMPOULE|PILL|TABLET|CAPSULE)' THEN
      SELECT coalesce(array_agg(uid),'{}'::uuid[]) INTO uids FROM (
        SELECT b.uid FROM public.medicine_boxes b JOIN public.batches batch ON batch.id=b.batch_id
        WHERE b.current_facility_id=source AND b.status='IN_STOCK' AND batch.medicine_id=item.medicine_id
          AND batch.expiry_date > current_date AND batch.status='ACTIVE'
        ORDER BY batch.expiry_date,b.uid LIMIT units FOR UPDATE OF b
      ) selected;
      IF cardinality(uids)<>units THEN RAISE EXCEPTION 'Replacement package stock is insufficient' USING ERRCODE='22023'; END IF;
      UPDATE public.medicine_boxes SET status='RESERVED' WHERE uid=ANY(uids);
    END IF;
    UPDATE public.order_items SET quantity=units,total_price=unit_price*units,source_facility_id=source,
      assigned_uids=uids,inventory_reserved=true WHERE id=item.id;
    IF source <> t.to_facility_id THEN
      lines:=lines || jsonb_build_array(jsonb_build_object('variantId',item.variant_id,'medicineId',item.medicine_id,
        'medicineName',item.medicine_name,'unitName',item.unit_name,'quantity',units));
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT FROM public.order_items WHERE order_id=ord.id) THEN
    RAISE EXCEPTION 'No goods remain; cancel the order instead' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(lines)>0 THEN
    INSERT INTO public.internal_transfers(transfer_code,order_id,from_facility_id,to_facility_id,status,items,notes)
      VALUES('ITR-'||gen_random_uuid()::text,ord.id,source,t.to_facility_id,'REQUESTED',lines,'Replacement for '||t.transfer_code)
      RETURNING id INTO replacement;
  END IF;
  INSERT INTO public.transfer_resolutions(transfer_id,action,source_facility_id,reason,customer_agreement,resolved_by,replacement_transfer_id)
    VALUES(target,decision,source,btrim(reason),nullif(btrim(agreement),''),actor,replacement);
  UPDATE public.internal_transfers SET status='REPLACED',discrepancy_status='RESOLVED',
    notes=concat_ws(E'\n',notes,decision||': '||btrim(reason)),updated_at=now() WHERE id=target;
  IF decision='ACCEPT_SHORTAGE' THEN
    UPDATE public.orders SET subtotal_amount=(SELECT sum(total_price) FROM public.order_items WHERE order_id=ord.id),
      total_amount=(SELECT sum(total_price) FROM public.order_items WHERE order_id=ord.id)+coalesce(shipping_fee,0),
      note=concat_ws(E'\n',note,'Customer accepted shortage: '||btrim(agreement)) WHERE id=ord.id;
  END IF;
  IF NOT EXISTS (SELECT FROM public.internal_transfers WHERE order_id=ord.id AND status NOT IN ('RECEIVED','REPLACED'))
    AND NOT EXISTS (SELECT FROM public.order_items WHERE order_id=ord.id AND inventory_reserved IS NOT TRUE) THEN
    UPDATE public.orders SET order_status='PROCESSING' WHERE id=ord.id;
  END IF;
  RETURN jsonb_build_object('id',target,'replacementTransferId',replacement,'status','RESOLVED');
END $$;
REVOKE ALL ON FUNCTION public.resolve_transfer_discrepancy(integer,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_transfer_discrepancy(integer,text,integer,text,text) TO app_user;
COMMIT;
