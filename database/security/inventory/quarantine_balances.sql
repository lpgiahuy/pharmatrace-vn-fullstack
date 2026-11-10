\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install quarantine controls as a trusted superuser';
  END IF;
END $$;
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS variant_id integer REFERENCES public.packaging_variants(id);
ALTER TABLE public.inventory_logs ADD COLUMN IF NOT EXISTS stock_bucket text;
CREATE TABLE IF NOT EXISTS public.quarantine_balances (
  facility_id integer NOT NULL REFERENCES public.facilities(id),
  variant_id integer NOT NULL REFERENCES public.packaging_variants(id),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (facility_id, variant_id)
);
CREATE TABLE IF NOT EXISTS public.quarantine_movements (
  origin_type text NOT NULL CHECK (origin_type IN ('SHIPMENT','TRANSFER','TRANSFER_RETURN')),
  origin_id integer NOT NULL,
  variant_id integer NOT NULL REFERENCES public.packaging_variants(id),
  action text NOT NULL CHECK (action IN ('IN','RESTOCK','FAILED_QA')),
  inventory_log_id integer NOT NULL REFERENCES public.inventory_logs(id),
  PRIMARY KEY (origin_type, origin_id, variant_id, action)
);
ALTER TABLE public.quarantine_movements DROP CONSTRAINT IF EXISTS quarantine_movements_origin_type_check;
ALTER TABLE public.quarantine_movements ADD CONSTRAINT quarantine_movements_origin_type_check CHECK (origin_type IN ('SHIPMENT','TRANSFER','TRANSFER_RETURN'));
REVOKE ALL ON public.quarantine_balances, public.quarantine_movements FROM PUBLIC, app_user;

CREATE OR REPLACE FUNCTION public.record_quarantine_movement(kind text, target integer, target_variant integer, movement text, units integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE facility integer; medicine integer; reference text; previous integer; current_balance integer; delta integer;
  available integer; actor integer; operation text := current_setting('app.order_operation', true); log_id integer;
BEGIN
  actor := nullif(current_setting('app.current_user_id', true),'')::integer;
  IF actor IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST','WAREHOUSE_STAFF')
    OR kind NOT IN ('SHIPMENT','TRANSFER','TRANSFER_RETURN') OR units IS NULL OR units <= 0 THEN
    RAISE EXCEPTION 'Invalid quarantine movement' USING ERRCODE = '42501';
  END IF;
  IF kind = 'SHIPMENT' THEN
    SELECT o.export_facility_id, i.medicine_id, s.tracking_number, r.quantity
      INTO facility, medicine, reference, available
      FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
      JOIN public.order_items i ON i.order_id = o.id AND i.variant_id = target_variant
      JOIN public.shipment_return_items r ON r.shipment_id = s.id AND r.variant_id = i.variant_id
      WHERE s.id = target AND ((movement = 'IN' AND operation = 'receive' AND s.shipping_status IN ('RETURN_REQUESTED','RETURN_IN_TRANSIT'))
        OR (movement IN ('RESTOCK','FAILED_QA') AND operation = 'status' AND s.shipping_status = 'RETURNED_TO_WAREHOUSE' AND s.return_qa_status = 'PENDING_INSPECTION'));
  ELSE
    SELECT CASE WHEN kind = 'TRANSFER_RETURN' THEN t.from_facility_id ELSE t.to_facility_id END, i.medicine_id, t.transfer_code, (line->>'quantity')::integer
      INTO facility, medicine, reference, available
      FROM public.internal_transfers t JOIN public.order_items i ON i.order_id = t.order_id
      CROSS JOIN LATERAL jsonb_array_elements(t.items) line
      WHERE t.id = target AND i.variant_id = target_variant AND i.variant_id = (line->>'variantId')::integer
        AND ((kind = 'TRANSFER' AND t.status = 'DISPATCHED') OR (kind = 'TRANSFER_RETURN' AND t.status = 'RETURN_REQUESTED'))
        AND operation = 'receive' AND movement = 'IN';
  END IF;
  IF facility IS NULL OR medicine IS NULL OR public.order_staff(facility) IS NOT TRUE OR units > available THEN
    RAISE EXCEPTION 'Quarantine movement is not authorized or exceeds the recorded goods' USING ERRCODE = '42501';
  END IF;
  delta := CASE movement WHEN 'IN' THEN units WHEN 'RESTOCK' THEN -units ELSE 0 END;
  INSERT INTO public.quarantine_balances(facility_id,variant_id,quantity) VALUES (facility,target_variant,0) ON CONFLICT DO NOTHING;
  UPDATE public.quarantine_balances SET quantity = quantity + delta
    WHERE facility_id = facility AND variant_id = target_variant AND quantity + delta >= 0 RETURNING quantity INTO current_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarantine balance is insufficient; reconcile prior intake first' USING ERRCODE = '22023'; END IF;
  previous := current_balance - delta;
  INSERT INTO public.inventory_logs(facility_id,medicine_id,variant_id,stock_bucket,transaction_type,quantity_changed,previous_quantity,new_quantity,reference_code,note,performed_by_id)
    VALUES(facility,medicine,target_variant,'QUARANTINE',CASE movement WHEN 'IN' THEN 'QUARANTINE_IN' WHEN 'RESTOCK' THEN 'QUARANTINE_TO_STOCK' ELSE 'QUARANTINE_FAILED_QA' END,
      delta,previous,current_balance,reference,format('%s: %s units',movement,units),actor) RETURNING id INTO log_id;
  INSERT INTO public.quarantine_movements(origin_type,origin_id,variant_id,action,inventory_log_id) VALUES (kind,target,target_variant,movement,log_id);
  RETURN log_id;
END $$;
REVOKE ALL ON FUNCTION public.record_quarantine_movement(text,integer,integer,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_quarantine_movement(text,integer,integer,text,integer) TO app_user;
COMMIT;
