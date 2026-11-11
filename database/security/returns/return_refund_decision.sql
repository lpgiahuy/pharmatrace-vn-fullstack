\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install refund functions as a trusted superuser';
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.return_refund_decisions (
  id serial PRIMARY KEY,
  shipment_id integer NOT NULL UNIQUE REFERENCES public.shipments(id),
  order_id integer NOT NULL REFERENCES public.orders(id),
  goods_value numeric(15,2) NOT NULL CHECK (goods_value > 0),
  customer_fee numeric(15,2) NOT NULL CHECK (customer_fee >= 0 AND customer_fee < goods_value),
  refund_amount numeric(15,2) NOT NULL CHECK (refund_amount > 0 AND refund_amount = goods_value - customer_fee),
  payment_method text NOT NULL CHECK (payment_method IN ('CASH','BANK_TRANSFER','DEBIT_CARD','E_WALLET')),
  payment_reference text NOT NULL CHECK (length(btrim(payment_reference)) BETWEEN 1 AND 100),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  approved_by integer NOT NULL REFERENCES public.employees(id),
  cashbook_id integer NOT NULL UNIQUE REFERENCES public.cashbook_logs(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_method, payment_reference)
);
ALTER TABLE public.return_refund_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.return_refund_decisions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.return_refund_decisions FROM PUBLIC, app_user;
GRANT SELECT ON public.return_refund_decisions TO app_user;
DROP POLICY IF EXISTS return_refund_read ON public.return_refund_decisions;
CREATE POLICY return_refund_read ON public.return_refund_decisions FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id))
);

CREATE OR REPLACE FUNCTION public.record_return_refund(target integer, goods numeric, fee numeric, method text, reference text, reason_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; shipment public.shipments%ROWTYPE; actor integer; maximum_goods numeric; amount numeric;
  cash_id integer; decision_id integer; earned integer; reversed integer; points_to_reverse integer; merchandise_paid numeric;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true), '') NOT IN ('SUPER_ADMIN', 'STORE_MANAGER') THEN
    RAISE EXCEPTION 'Refund approval is not authorized' USING ERRCODE = '42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id', true), '')::integer;
  IF actor IS NULL OR goods IS NULL OR fee IS NULL OR goods::text IN ('NaN','Infinity','-Infinity')
    OR fee::text IN ('NaN','Infinity','-Infinity') OR goods <> round(goods,2) OR fee <> round(fee,2)
    OR goods <= 0 OR fee < 0 OR fee >= goods OR method NOT IN ('CASH','BANK_TRANSFER','DEBIT_CARD','E_WALLET')
    OR length(btrim(coalesce(reference,''))) NOT BETWEEN 1 AND 100
    OR length(btrim(coalesce(reason_text,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Valid refund amounts, payment evidence and reason are required' USING ERRCODE = '22023';
  END IF;
  SELECT o.* INTO ord FROM public.orders o JOIN public.shipments s ON s.order_id = o.id
    WHERE s.id = target AND public.order_staff(o.export_facility_id) FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO shipment FROM public.shipments WHERE id = target FOR UPDATE;
  IF shipment.shipping_status <> 'RETURNED_TO_WAREHOUSE' OR shipment.return_qa_status IS DISTINCT FROM 'COMPLETED'
    OR ord.payment_status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION 'Refund requires paid order and completed return inspection' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT FROM public.return_refund_decisions d WHERE d.shipment_id = target) THEN
    RAISE EXCEPTION 'Refund has already been recorded for this return' USING ERRCODE = '23505';
  END IF;
  SELECT coalesce(sum(r.quantity * i.unit_price),0) INTO maximum_goods FROM public.shipment_return_items r
    JOIN public.order_items i ON i.order_id = ord.id AND i.variant_id = r.variant_id WHERE r.shipment_id = target;
  merchandise_paid := greatest(ord.total_amount - coalesce(ord.shipping_fee,0),0);
  IF maximum_goods <= 0 OR goods > maximum_goods OR goods > merchandise_paid THEN
    RAISE EXCEPTION 'Refund goods value exceeds the received items or paid merchandise' USING ERRCODE = '22023';
  END IF;
  amount := goods - fee;
  INSERT INTO public.cashbook_logs(transaction_code, transaction_type, category, amount, party_type, order_id, payment_method, note, created_by_user_id)
    VALUES ('REF-' || gen_random_uuid()::text, 'EXPENSE', 'CUSTOMER_REFUND', amount, 'CUSTOMER', ord.id, method,
      'Refund reference: ' || btrim(reference), actor) RETURNING id INTO cash_id;
  INSERT INTO public.return_refund_decisions(shipment_id, order_id, goods_value, customer_fee, refund_amount, payment_method, payment_reference, reason, approved_by, cashbook_id)
    VALUES(target, ord.id, goods, fee, amount, method, btrim(reference), btrim(reason_text), actor, cash_id) RETURNING id INTO decision_id;
  IF ord.customer_id IS NOT NULL THEN
    SELECT coalesce(sum(points) FILTER (WHERE transaction_type = 'EARN'),0),
      -coalesce(sum(points) FILTER (WHERE transaction_type IN ('EARN_REVERSAL','RMA_DEDUCTION')),0)
      INTO earned, reversed FROM public.loyalty_point_logs WHERE order_id = ord.id;
    points_to_reverse := least(greatest(earned - reversed,0), CASE WHEN goods = merchandise_paid THEN earned ELSE floor(goods / 100)::integer END);
    IF points_to_reverse > 0 THEN
      UPDATE public.customers SET reward_points = coalesce(reward_points,0) - points_to_reverse WHERE id = ord.customer_id;
      INSERT INTO public.loyalty_point_logs(customer_id,order_id,transaction_type,points,description)
        VALUES(ord.customer_id,ord.id,'RMA_DEDUCTION',-points_to_reverse,'Points reversed after return refund');
    END IF;
  END IF;
  IF amount = ord.total_amount THEN UPDATE public.orders SET payment_status = 'REFUNDED' WHERE id = ord.id; END IF;
  RETURN jsonb_build_object('id',decision_id,'cashbookId',cash_id,'refundAmount',amount);
END $$;
REVOKE ALL ON FUNCTION public.record_return_refund(integer,numeric,numeric,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_return_refund(integer,numeric,numeric,text,text,text) TO app_user;
COMMIT;
