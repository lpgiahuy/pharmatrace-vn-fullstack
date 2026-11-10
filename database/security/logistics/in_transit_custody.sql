\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install custody controls as a trusted superuser';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.transfer_custody (
  transfer_id integer NOT NULL REFERENCES public.internal_transfers(id),
  variant_id integer NOT NULL REFERENCES public.packaging_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  outstanding integer NOT NULL CHECK (outstanding >= 0 AND outstanding <= quantity),
  box_uids uuid[] NOT NULL,
  handed_over_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  PRIMARY KEY (transfer_id, variant_id)
);
-- Fresh bootstrap loads legacy demo fixtures; existing databases must reconcile real handoffs first.
\if :{?bootstrap_current_functions}
\else
DO $$ BEGIN
  IF EXISTS (SELECT FROM public.internal_transfers t WHERE t.status IN ('DISPATCHED','RETURN_REQUESTED')
    AND NOT EXISTS (SELECT FROM public.transfer_custody c WHERE c.transfer_id=t.id)) THEN
    RAISE EXCEPTION 'Complete or physically reconcile active legacy transfers without custody records before installing custody tracking';
  END IF;
END $$;
\endif
ALTER TABLE public.transfer_custody ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfer_custody FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.transfer_custody FROM PUBLIC, app_user;
GRANT SELECT ON public.transfer_custody TO app_user;
DROP POLICY IF EXISTS custody_read ON public.transfer_custody;
CREATE POLICY custody_read ON public.transfer_custody FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.internal_transfers t WHERE t.id=transfer_id
    AND (public.order_staff(t.from_facility_id) OR public.order_staff(t.to_facility_id)))
);
CREATE OR REPLACE FUNCTION public.handoff_transfer_custody() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE line jsonb; item public.order_items%ROWTYPE; balance integer; changed integer;
BEGIN
  IF NEW.status <> 'DISPATCHED' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  FOR line IN SELECT value FROM jsonb_array_elements(NEW.items) LOOP
    SELECT * INTO STRICT item FROM public.order_items WHERE order_id=NEW.order_id
      AND variant_id=(line->>'variantId')::integer AND source_facility_id=NEW.from_facility_id FOR UPDATE;
    IF item.inventory_reserved IS NOT TRUE OR item.quantity <> (line->>'quantity')::integer THEN
      RAISE EXCEPTION 'Transfer reservation changed' USING ERRCODE='22023';
    END IF;
    UPDATE public.inventories SET stock_quantity=stock_quantity-item.quantity,
      reserved_quantity=reserved_quantity-item.quantity, updated_at=now()
      WHERE facility_id=NEW.from_facility_id AND variant_id=item.variant_id
        AND stock_quantity >= item.quantity AND reserved_quantity >= item.quantity
      RETURNING stock_quantity INTO balance;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source reservation is insufficient' USING ERRCODE='22023'; END IF;
    UPDATE public.medicine_boxes SET status='IN_TRANSIT', current_facility_id=NULL
      WHERE uid=ANY(item.assigned_uids) AND status='RESERVED' AND current_facility_id=NEW.from_facility_id;
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed <> cardinality(item.assigned_uids) THEN RAISE EXCEPTION 'Source package custody changed' USING ERRCODE='22023'; END IF;
    INSERT INTO public.transfer_custody(transfer_id,variant_id,quantity,outstanding,box_uids)
      VALUES(NEW.id,item.variant_id,item.quantity,item.quantity,item.assigned_uids);
    INSERT INTO public.inventory_logs(facility_id,medicine_id,variant_id,stock_bucket,transaction_type,
      quantity_changed,previous_quantity,new_quantity,reference_code,note,performed_by_id)
      VALUES(NEW.from_facility_id,item.medicine_id,item.variant_id,'ON_HAND','TRANSFER_DISPATCH',
        -item.quantity,balance+item.quantity,balance,NEW.transfer_code,'Handed over to transport custody',
        nullif(current_setting('app.current_user_id',true),'')::integer);
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.handoff_transfer_custody() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS handoff_transfer_custody ON public.internal_transfers;
CREATE TRIGGER handoff_transfer_custody AFTER UPDATE ON public.internal_transfers
  FOR EACH ROW EXECUTE FUNCTION public.handoff_transfer_custody();

CREATE OR REPLACE FUNCTION public.consume_transfer_custody(target integer, variant integer, units integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.internal_transfers%ROWTYPE; remaining integer;
BEGIN
  SELECT * INTO t FROM public.internal_transfers WHERE id=target FOR UPDATE;
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'receive'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER','WAREHOUSE_STAFF')
    OR NOT ((t.status='DISPATCHED' AND public.order_staff(t.to_facility_id))
      OR (t.status='RETURN_REQUESTED' AND public.order_staff(t.from_facility_id))) THEN
    RAISE EXCEPTION 'Transfer custody receipt is not authorized' USING ERRCODE='42501';
  END IF;
  UPDATE public.transfer_custody SET outstanding=0,received_at=now()
    WHERE transfer_id=target AND variant_id=variant AND outstanding=units AND units > 0
    RETURNING outstanding INTO remaining;
  IF NOT FOUND THEN RAISE EXCEPTION 'Custody manifest is missing or already received; reconcile legacy transfers before receipt' USING ERRCODE='22023'; END IF;
  RETURN remaining;
END $$;
REVOKE ALL ON FUNCTION public.consume_transfer_custody(integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_transfer_custody(integer,integer,integer) TO app_user;
COMMIT;
