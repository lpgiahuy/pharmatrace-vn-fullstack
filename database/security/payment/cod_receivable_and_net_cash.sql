\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install COD accounting as a trusted superuser';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.courier_receivables (
  shipment_id integer PRIMARY KEY REFERENCES public.shipments(id),
  courier_name text NOT NULL,
  amount_due numeric(15,2) NOT NULL CHECK (amount_due > 0),
  collected_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (collected_amount >= 0),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','SETTLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.courier_service_fees (
  shipment_id integer PRIMARY KEY REFERENCES public.shipments(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  statement_reference text NOT NULL,
  recorded_by integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.courier_receivables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_receivables FORCE ROW LEVEL SECURITY;
ALTER TABLE public.courier_service_fees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courier_service_fees FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.courier_receivables, public.courier_service_fees FROM PUBLIC, app_user;
GRANT SELECT ON public.courier_receivables, public.courier_service_fees TO app_user;
DROP POLICY IF EXISTS courier_receivable_read ON public.courier_receivables;
CREATE POLICY courier_receivable_read ON public.courier_receivables FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.shipments s JOIN public.orders o ON o.id=s.order_id WHERE s.id=shipment_id AND public.order_staff(o.export_facility_id))
);
DROP POLICY IF EXISTS courier_fee_read ON public.courier_service_fees;
CREATE POLICY courier_fee_read ON public.courier_service_fees FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.shipments s JOIN public.orders o ON o.id=s.order_id WHERE s.id=shipment_id AND public.order_staff(o.export_facility_id))
);

CREATE OR REPLACE FUNCTION public.create_courier_receivable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.shipping_status = 'DELIVERED' AND NEW.cod_amount > 0
    AND (TG_OP = 'INSERT' OR OLD.shipping_status IS DISTINCT FROM NEW.shipping_status) THEN
    INSERT INTO public.courier_receivables(shipment_id,courier_name,amount_due)
      VALUES(NEW.id,NEW.courier_name,NEW.cod_amount) ON CONFLICT (shipment_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.create_courier_receivable() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS create_courier_receivable ON public.shipments;
CREATE TRIGGER create_courier_receivable AFTER INSERT OR UPDATE OF shipping_status ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.create_courier_receivable();

\if :{?bootstrap_current_functions}
-- Fresh bootstrap installs only the final definition.
\else
CREATE OR REPLACE FUNCTION public.reconcile_shipment_cod(target_id integer, gross numeric, fee numeric, adjustment numeric, net numeric, statement text, reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s public.shipments%ROWTYPE; ord public.orders%ROWTYPE; previous public.logistics_cod_settlements%ROWTYPE;
  receivable public.courier_receivables%ROWTYPE; actor integer; cash_id integer; mismatch boolean; discrepancy text;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER') THEN
    RAISE EXCEPTION 'COD reconciliation is not authorized' USING ERRCODE = '42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id', true),'')::integer;
  IF actor IS NULL OR gross IS NULL OR fee IS NULL OR adjustment IS NULL OR net IS NULL OR least(gross,fee,net) < 0
    OR gross::text IN ('NaN','Infinity','-Infinity') OR fee::text IN ('NaN','Infinity','-Infinity')
    OR adjustment::text IN ('NaN','Infinity','-Infinity') OR net::text IN ('NaN','Infinity','-Infinity')
    OR gross <> round(gross,2) OR fee <> round(fee,2) OR adjustment <> round(adjustment,2) OR net <> round(net,2)
    OR length(btrim(coalesce(statement,''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid COD statement' USING ERRCODE = '22023';
  END IF;
  SELECT o.* INTO ord FROM public.orders o JOIN public.shipments sh ON sh.order_id=o.id
    WHERE sh.id=target_id AND public.order_staff(o.export_facility_id) FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO s FROM public.shipments WHERE id=target_id FOR UPDATE;
  SELECT * INTO previous FROM public.logistics_cod_settlements WHERE shipment_id=target_id;
  IF s.cod_settlement_status = 'SETTLED' THEN
    RETURN jsonb_build_object('shipmentId',target_id,'status','SETTLED','cashbookId',previous.cashbook_id,'netAmount',previous.net_amount);
  END IF;
  IF s.cod_amount <= 0 OR (s.shipping_status <> 'DELIVERED' AND NOT (s.actual_delivery_at IS NOT NULL AND s.shipping_status IN ('RETURN_REQUESTED','RETURN_IN_TRANSIT','RETURNED_TO_WAREHOUSE'))) THEN RETURN NULL; END IF;
  SELECT * INTO receivable FROM public.courier_receivables WHERE shipment_id=target_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Courier receivable is missing; reconcile historical delivery evidence first' USING ERRCODE = '22023'; END IF;
  mismatch := gross <> receivable.amount_due OR net <> gross-fee+adjustment;
  discrepancy := CASE WHEN gross < receivable.amount_due THEN 'UNDERPAID' WHEN gross > receivable.amount_due THEN 'OVERPAID' WHEN mismatch THEN 'NET_MISMATCH' ELSE 'NONE' END;
  IF NOT mismatch THEN
    IF net > 0 THEN
      INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,party_name,order_id,payment_method,note,created_by_user_id)
        VALUES('COD-SHIP-'||s.id,'INCOME','COD',net,'OTHER',s.courier_name,s.order_id,'BANK_TRANSFER','Statement: '||btrim(statement),actor) RETURNING id INTO cash_id;
    END IF;
    IF fee > 0 THEN
      INSERT INTO public.courier_service_fees(shipment_id,amount,statement_reference,recorded_by) VALUES(target_id,fee,btrim(statement),actor);
    END IF;
    UPDATE public.courier_receivables SET collected_amount=gross,status='SETTLED',settled_at=now() WHERE shipment_id=target_id;
  END IF;
  INSERT INTO public.logistics_cod_settlements(shipment_id,cashbook_id,amount,courier_fee,adjustment_amount,net_amount,statement_reference,discrepancy_amount,discrepancy_status,notes,collected_by)
    VALUES(target_id,cash_id,gross,fee,adjustment,net,btrim(statement),receivable.amount_due-gross,discrepancy,reason,actor)
    ON CONFLICT (shipment_id) DO UPDATE SET cashbook_id=excluded.cashbook_id,amount=excluded.amount,courier_fee=excluded.courier_fee,
      adjustment_amount=excluded.adjustment_amount,net_amount=excluded.net_amount,statement_reference=excluded.statement_reference,
      discrepancy_amount=excluded.discrepancy_amount,discrepancy_status=excluded.discrepancy_status,notes=excluded.notes,collected_by=excluded.collected_by,collected_at=now();
  UPDATE public.shipments SET cod_settlement_status=CASE WHEN mismatch THEN 'DISCREPANCY_PENDING' ELSE 'SETTLED' END,
    cod_settled_at=CASE WHEN mismatch THEN NULL ELSE now() END,updated_at=now() WHERE id=target_id;
  IF NOT mismatch THEN UPDATE public.orders SET payment_status='PAID' WHERE id=s.order_id; END IF;
  RETURN jsonb_build_object('shipmentId',target_id,'status',CASE WHEN mismatch THEN 'DISCREPANCY_PENDING' ELSE 'SETTLED' END,
    'cashbookId',cash_id,'netAmount',net,'discrepancyAmount',receivable.amount_due-gross,'discrepancyStatus',discrepancy);
END $$;
REVOKE ALL ON FUNCTION public.reconcile_shipment_cod(integer,numeric,numeric,numeric,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_shipment_cod(integer,numeric,numeric,numeric,numeric,text,text) TO app_user;
\endif
COMMIT;
