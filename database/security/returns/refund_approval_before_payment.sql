\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install refund functions as a trusted superuser';
  END IF;
END $$;
ALTER TABLE public.return_refund_decisions ALTER COLUMN payment_reference DROP NOT NULL;
ALTER TABLE public.return_refund_decisions ALTER COLUMN cashbook_id DROP NOT NULL;
ALTER TABLE public.return_refund_decisions ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'RECORDED' CHECK (status IN ('APPROVED','RECORDED'));
ALTER TABLE public.return_refund_decisions ADD COLUMN IF NOT EXISTS executed_by integer REFERENCES public.employees(id);
ALTER TABLE public.return_refund_decisions ADD COLUMN IF NOT EXISTS executed_at timestamptz;
DROP FUNCTION IF EXISTS public.record_return_refund(integer,numeric,numeric,text,text,text);

CREATE OR REPLACE FUNCTION public.approve_return_refund(target integer, goods numeric, fee numeric, method text, reason_text text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; shipment public.shipments%ROWTYPE; actor integer; maximum_goods numeric; decision_id integer;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true), '') NOT IN ('SUPER_ADMIN', 'STORE_MANAGER') THEN
    RAISE EXCEPTION 'Refund approval is not authorized' USING ERRCODE = '42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id', true), '')::integer;
  IF actor IS NULL OR goods IS NULL OR fee IS NULL OR goods::text IN ('NaN','Infinity','-Infinity')
    OR fee::text IN ('NaN','Infinity','-Infinity') OR goods <> round(goods,2) OR fee <> round(fee,2)
    OR goods <= 0 OR fee < 0 OR fee >= goods OR coalesce(method,'') NOT IN ('CASH','BANK_TRANSFER','DEBIT_CARD','E_WALLET')
    OR length(btrim(coalesce(reason_text,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Valid refund values, method and reason are required' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'Refund has already been approved for this return' USING ERRCODE = '23505';
  END IF;
  SELECT coalesce(sum(r.quantity * i.unit_price),0) INTO maximum_goods FROM public.shipment_return_items r
    JOIN public.order_items i ON i.order_id = ord.id AND i.variant_id = r.variant_id WHERE r.shipment_id = target;
  IF maximum_goods <= 0 OR goods > maximum_goods OR goods > greatest(ord.total_amount - coalesce(ord.shipping_fee,0),0) THEN
    RAISE EXCEPTION 'Refund goods value exceeds the received items or paid merchandise' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.return_refund_decisions(shipment_id,order_id,goods_value,customer_fee,refund_amount,payment_method,reason,approved_by,status)
    VALUES(target,ord.id,goods,fee,goods-fee,method,btrim(reason_text),actor,'APPROVED') RETURNING id INTO decision_id;
  RETURN jsonb_build_object('id',decision_id,'status','APPROVED','refundAmount',goods-fee);
END $$;

CREATE OR REPLACE FUNCTION public.record_approved_refund(target integer, reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; decision public.return_refund_decisions%ROWTYPE; actor integer; cash_id integer;
  earned integer; reversed integer; points_to_reverse integer; merchandise_paid numeric;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true), '') NOT IN ('SUPER_ADMIN', 'STORE_MANAGER') THEN
    RAISE EXCEPTION 'Refund recording is not authorized' USING ERRCODE = '42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id', true), '')::integer;
  IF actor IS NULL OR length(btrim(coalesce(reference,''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Payment reference is required' USING ERRCODE = '22023';
  END IF;
  SELECT o.* INTO ord FROM public.orders o JOIN public.shipments s ON s.order_id = o.id
    WHERE s.id = target AND public.order_staff(o.export_facility_id) FOR UPDATE OF o;
  IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO decision FROM public.return_refund_decisions WHERE shipment_id = target FOR UPDATE;
  IF NOT FOUND OR decision.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'An approved unpaid refund is required' USING ERRCODE = '22023';
  END IF;
  IF ord.payment_status IS DISTINCT FROM 'PAID' OR NOT EXISTS (
    SELECT FROM public.shipments s WHERE s.id = target AND s.shipping_status = 'RETURNED_TO_WAREHOUSE' AND s.return_qa_status = 'COMPLETED'
  ) THEN
    RAISE EXCEPTION 'Refund requires paid order and completed return inspection' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,order_id,payment_method,note,created_by_user_id)
    VALUES('REF-' || gen_random_uuid()::text,'EXPENSE','CUSTOMER_REFUND',decision.refund_amount,'CUSTOMER',ord.id,decision.payment_method,
      'Refund reference: ' || btrim(reference),actor) RETURNING id INTO cash_id;
  UPDATE public.return_refund_decisions SET payment_reference = btrim(reference), cashbook_id = cash_id,
    executed_by = actor, executed_at = now(), status = 'RECORDED' WHERE id = decision.id;
  IF ord.customer_id IS NOT NULL THEN
    SELECT coalesce(sum(points) FILTER (WHERE transaction_type = 'EARN'),0),
      -coalesce(sum(points) FILTER (WHERE transaction_type IN ('EARN_REVERSAL','RMA_DEDUCTION')),0)
      INTO earned, reversed FROM public.loyalty_point_logs WHERE order_id = ord.id;
    merchandise_paid := greatest(ord.total_amount - coalesce(ord.shipping_fee,0),0);
    points_to_reverse := least(greatest(earned-reversed,0), CASE WHEN decision.goods_value = merchandise_paid THEN earned ELSE floor(decision.goods_value / 100)::integer END);
    IF points_to_reverse > 0 THEN
      UPDATE public.customers SET reward_points = coalesce(reward_points,0)-points_to_reverse WHERE id = ord.customer_id;
      INSERT INTO public.loyalty_point_logs(customer_id,order_id,transaction_type,points,description)
        VALUES(ord.customer_id,ord.id,'RMA_DEDUCTION',-points_to_reverse,'Points reversed after return refund');
    END IF;
  END IF;
  IF decision.refund_amount = ord.total_amount THEN UPDATE public.orders SET payment_status = 'REFUNDED' WHERE id = ord.id; END IF;
  RETURN jsonb_build_object('id',decision.id,'status','RECORDED','cashbookId',cash_id,'refundAmount',decision.refund_amount);
END $$;
REVOKE ALL ON FUNCTION public.approve_return_refund(integer,numeric,numeric,text,text), public.record_approved_refund(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_return_refund(integer,numeric,numeric,text,text), public.record_approved_refund(integer,text) TO app_user;
COMMIT;
