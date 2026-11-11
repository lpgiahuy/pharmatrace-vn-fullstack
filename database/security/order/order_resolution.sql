\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install order resolution as a trusted superuser';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.staff_order_cancellations (
  order_id integer PRIMARY KEY REFERENCES public.orders(id),
  reason text NOT NULL,
  cancelled_by integer NOT NULL REFERENCES public.employees(id),
  cancelled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.delivery_disputes (
  order_id integer PRIMARY KEY REFERENCES public.orders(id),
  reason text NOT NULL,
  opened_by integer REFERENCES public.customers(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  outcome text CHECK (outcome IN ('DELIVERED','NOT_DELIVERED')),
  resolution_reason text,
  resolved_by integer REFERENCES public.employees(id),
  resolved_at timestamptz,
  CHECK ((outcome IS NULL AND resolution_reason IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (outcome IS NOT NULL AND length(btrim(resolution_reason)) BETWEEN 1 AND 500 AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL))
);
INSERT INTO public.delivery_disputes(order_id,reason,opened_by)
  SELECT o.id,s.delivery_notes,o.customer_id FROM public.orders o JOIN public.shipments s ON s.order_id=o.id
  WHERE s.delivery_notes LIKE '%[DISPUTED]%' ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.cancellation_refunds (
  order_id integer PRIMARY KEY REFERENCES public.orders(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('CASH','BANK_TRANSFER','E_WALLET')),
  reason text NOT NULL,
  approved_by integer NOT NULL REFERENCES public.employees(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  payment_reference text UNIQUE,
  executed_by integer REFERENCES public.employees(id),
  executed_at timestamptz,
  cashbook_id integer UNIQUE REFERENCES public.cashbook_logs(id),
  CHECK ((cashbook_id IS NULL AND payment_reference IS NULL AND executed_by IS NULL AND executed_at IS NULL)
    OR (cashbook_id IS NOT NULL AND length(btrim(payment_reference)) BETWEEN 1 AND 100 AND executed_by IS NOT NULL AND executed_at IS NOT NULL))
);
ALTER TABLE public.staff_order_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_order_cancellations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_disputes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancellation_refunds FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_order_cancellations,public.delivery_disputes,public.cancellation_refunds FROM PUBLIC,app_user;
GRANT SELECT ON public.staff_order_cancellations,public.delivery_disputes,public.cancellation_refunds TO app_user;
DROP POLICY IF EXISTS cancellation_read ON public.staff_order_cancellations;
CREATE POLICY cancellation_read ON public.staff_order_cancellations FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.orders o WHERE o.id=order_id
    AND (public.order_staff(o.export_facility_id) OR public.order_customer(o.customer_id))));
DROP POLICY IF EXISTS dispute_read ON public.delivery_disputes;
CREATE POLICY dispute_read ON public.delivery_disputes FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.orders o WHERE o.id=order_id AND (public.order_staff(o.export_facility_id) OR public.order_customer(o.customer_id)))
  OR public.order_job());
DROP POLICY IF EXISTS cancellation_refund_read ON public.cancellation_refunds;
CREATE POLICY cancellation_refund_read ON public.cancellation_refunds FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.orders o WHERE o.id=order_id AND public.order_staff(o.export_facility_id)));

CREATE OR REPLACE FUNCTION public.audit_staff_order_cancellation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  v_reason text;
BEGIN
  IF NEW.order_status='CANCELLED' AND OLD.order_status IS DISTINCT FROM NEW.order_status
    AND current_setting('app.current_user_type',true)='employee'
    AND current_setting('app.order_operation',true)='status' THEN
    v_reason := coalesce(nullif(btrim(current_setting('app.cancellation_reason',true)),''), btrim(coalesce(NEW.note,'')));
    IF length(v_reason) NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'A cancellation reason is required' USING ERRCODE='22023';
    END IF;
    INSERT INTO public.staff_order_cancellations(order_id,reason,cancelled_by)
      VALUES(NEW.id,v_reason,nullif(current_setting('app.current_user_id',true),'')::integer)
      ON CONFLICT (order_id) DO UPDATE SET reason = EXCLUDED.reason, cancelled_by = EXCLUDED.cancelled_by, cancelled_at = now();
    -- Keep customer's original delivery note untouched
    NEW.note := OLD.note;
  END IF;
  RETURN NEW;
END $$;
-- Fires after guard_cancellation_safeguards (triggers run alphabetically): the guard must see the staff reason in NEW.note before this restores the customer's note.
DROP TRIGGER IF EXISTS audit_staff_order_cancellation ON public.orders;
DROP TRIGGER IF EXISTS staff_order_cancellation_audit ON public.orders;
CREATE TRIGGER staff_order_cancellation_audit BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_staff_order_cancellation();

CREATE OR REPLACE FUNCTION public.cancel_internal_transfer(target_id integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Transfer replanning is not supported. Cancel the entire order from its order page.' USING ERRCODE='22023';
END $$;
CREATE OR REPLACE FUNCTION public.reroute_internal_transfer(target integer,destination integer,reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Rerouting would change the accepted delivery plan. Cancel the entire order and place a new order.' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION public.submit_delivery_dispute(target_order integer,dispute_reason text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE;
BEGIN
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'customer_receive'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'customer'
    OR current_setting('app.current_user_role',true) IS DISTINCT FROM 'CUSTOMER' THEN
    RAISE EXCEPTION 'Customer dispute is not authorized' USING ERRCODE='42501';
  END IF;
  IF length(btrim(coalesce(dispute_reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid dispute reason' USING ERRCODE='22023';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id=target_order
    AND customer_id=nullif(current_setting('app.current_user_id',true),'')::integer FOR UPDATE;
  IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
  IF ord.order_status NOT IN ('COMPLETED','SHIPPING') OR NOT EXISTS (SELECT FROM public.shipments WHERE order_id=ord.id) THEN RETURN 'NOT_READY'; END IF;
  IF EXISTS (SELECT FROM public.delivery_disputes WHERE order_id=ord.id) THEN RETURN 'SUBMITTED'; END IF;
  INSERT INTO public.delivery_disputes(order_id,reason,opened_by) VALUES(ord.id,btrim(dispute_reason),ord.customer_id);
  RETURN 'SUBMITTED';
END $$;

CREATE OR REPLACE FUNCTION public.resolve_delivery_dispute(target integer,decision text,reason_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; dispute public.delivery_disputes%ROWTYPE; actor integer; earned integer;
BEGIN
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST') THEN
    RAISE EXCEPTION 'Dispute resolution is not authorized' USING ERRCODE='42501';
  END IF;
  actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR coalesce(decision,'') NOT IN ('DELIVERED','NOT_DELIVERED')
    OR length(btrim(coalesce(reason_text,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Outcome and resolution reason are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id=target AND public.order_staff(export_facility_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO dispute FROM public.delivery_disputes WHERE order_id=target FOR UPDATE;
  IF NOT FOUND OR dispute.outcome IS NOT NULL THEN RAISE EXCEPTION 'An open dispute is required' USING ERRCODE='22023'; END IF;
  IF decision='DELIVERED' AND NOT EXISTS (SELECT FROM public.shipments s WHERE s.order_id=target AND s.shipping_status='DELIVERED'
    AND s.actual_delivery_at IS NOT NULL AND ((nullif(btrim(s.proof_type),'') IS NOT NULL
    AND nullif(btrim(s.proof_reference),'') IS NOT NULL AND nullif(btrim(s.delivered_to_name),'') IS NOT NULL)
    OR EXISTS (SELECT FROM public.logistics_events e WHERE e.shipment_id=s.id AND e.new_status='DELIVERED'
      AND e.actor_type='customer' AND e.actor_id=ord.customer_id))) THEN
    RAISE EXCEPTION 'Complete delivery evidence is required' USING ERRCODE='22023';
  END IF;
  UPDATE public.delivery_disputes SET outcome=decision,resolution_reason=btrim(reason_text),resolved_by=actor,resolved_at=now() WHERE order_id=target;
  IF decision='NOT_DELIVERED' AND ord.customer_id IS NOT NULL THEN
    SELECT greatest(coalesce(sum(points),0),0)::integer INTO earned FROM public.loyalty_point_logs
      WHERE order_id=target AND transaction_type IN ('EARN','EARNED','EARN_REVERSAL','RMA_DEDUCTION');
    IF earned > 0 THEN
      UPDATE public.customers SET reward_points=coalesce(reward_points,0)-earned WHERE id=ord.customer_id;
      INSERT INTO public.loyalty_point_logs(customer_id,order_id,transaction_type,points,description)
        VALUES(ord.customer_id,target,'EARN_REVERSAL',-earned,'Points reversed after delivery dispute resolution');
    END IF;
  END IF;
  RETURN jsonb_build_object('outcome',decision,'resolvedBy',actor,'resolvedAt',now());
END $$;

CREATE OR REPLACE FUNCTION public.approve_cancellation_refund(target integer,paid numeric,method text,reason_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; actor integer;
BEGIN
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','FINANCE_MANAGER') THEN
    RAISE EXCEPTION 'Refund approval is not authorized' USING ERRCODE='42501';
  END IF;
  actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR paid IS NULL OR paid::text IN ('NaN','Infinity','-Infinity') OR paid<=0 OR paid<>round(paid,2)
    OR coalesce(method,'') NOT IN ('CASH','BANK_TRANSFER','E_WALLET') OR length(btrim(coalesce(reason_text,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Valid refund amount, method and reason are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id=target AND public.order_staff(export_facility_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
  IF ord.order_status IS DISTINCT FROM 'CANCELLED' OR ord.payment_status IS DISTINCT FROM 'PAID' OR paid<>ord.total_amount
    OR EXISTS (SELECT FROM public.shipments WHERE order_id=target) THEN
    RAISE EXCEPTION 'A paid order cancelled before packing requires a full refund' USING ERRCODE='22023';
  END IF;
  IF NOT EXISTS (SELECT FROM public.online_payment_receipts WHERE order_id=target AND status='APPROVED' AND cashbook_id IS NOT NULL AND amount=paid)
    AND (SELECT coalesce(sum(allocated),0) FROM public.payment_exceptions WHERE order_id=target AND approved_by IS NOT NULL AND cashbook_id IS NOT NULL) <> paid THEN
    RAISE EXCEPTION 'Approved received-payment evidence is required' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.cancellation_refunds(order_id,amount,payment_method,reason,approved_by)
    VALUES(target,paid,method,btrim(reason_text),actor);
  RETURN jsonb_build_object('status','APPROVED','amount',paid);
END $$;

CREATE OR REPLACE FUNCTION public.record_cancellation_refund(target integer,paid numeric,reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; refund public.cancellation_refunds%ROWTYPE; actor integer; cash integer;
BEGIN
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','FINANCE_MANAGER','ACCOUNTANT') THEN
    RAISE EXCEPTION 'Refund recording is not authorized' USING ERRCODE='42501';
  END IF;
  actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR length(btrim(coalesce(reference,''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Actual refund reference is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id=target AND public.order_staff(export_facility_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO refund FROM public.cancellation_refunds WHERE order_id=target FOR UPDATE;
  IF NOT FOUND OR paid IS NULL OR paid IS DISTINCT FROM refund.amount THEN RAISE EXCEPTION 'Actual amount must match the approved refund' USING ERRCODE='22023'; END IF;
  IF refund.cashbook_id IS NOT NULL THEN
    IF refund.payment_reference IS DISTINCT FROM btrim(reference) THEN RAISE EXCEPTION 'Refund already recorded with another reference' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('status','RECORDED','cashbookId',refund.cashbook_id);
  END IF;
  IF ord.order_status IS DISTINCT FROM 'CANCELLED' OR ord.payment_status IS DISTINCT FROM 'PAID'
    OR EXISTS (SELECT FROM public.shipments WHERE order_id=target) THEN RAISE EXCEPTION 'Order is no longer eligible for cancellation refund' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT FROM public.online_payment_receipts WHERE order_id=target AND status='APPROVED' AND cashbook_id IS NOT NULL AND amount=paid)
    AND (SELECT coalesce(sum(allocated),0) FROM public.payment_exceptions WHERE order_id=target AND approved_by IS NOT NULL AND cashbook_id IS NOT NULL) <> paid THEN
    RAISE EXCEPTION 'Received-payment evidence changed; reconcile the refund approval' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,order_id,payment_method,note,created_by_user_id)
    VALUES('CANCEL-REF-'||target,'EXPENSE','CUSTOMER_REFUND',paid,'CUSTOMER',target,refund.payment_method,'Refund reference: '||btrim(reference),actor) RETURNING id INTO cash;
  UPDATE public.cancellation_refunds SET payment_reference=btrim(reference),executed_by=actor,executed_at=now(),cashbook_id=cash WHERE order_id=target;
  UPDATE public.payment_exceptions SET refunded=refunded+allocated,allocated=0 WHERE order_id=target AND allocated>0;
  UPDATE public.orders SET payment_status='REFUNDED' WHERE id=target;
  RETURN jsonb_build_object('status','RECORDED','cashbookId',cash,'amount',paid);
END $$;
REVOKE ALL ON FUNCTION public.audit_staff_order_cancellation(), public.resolve_delivery_dispute(integer,text,text),
  public.approve_cancellation_refund(integer,numeric,text,text),public.record_cancellation_refund(integer,numeric,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_delivery_dispute(integer,text,text),public.approve_cancellation_refund(integer,numeric,text,text),
  public.record_cancellation_refund(integer,numeric,text) TO app_user;

CREATE OR REPLACE FUNCTION public.guard_refund_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE refund_reference text; payload jsonb := to_jsonb(NEW);
BEGIN
  refund_reference:=CASE WHEN TG_TABLE_NAME='payment_exception_actions' THEN payload->>'reference' ELSE payload->>'payment_reference' END;
  IF refund_reference IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='payment_exception_actions' AND payload->>'action'<>'REFUND' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(btrim(refund_reference),104));
  IF EXISTS (SELECT FROM public.cancellation_refunds r WHERE r.payment_reference=btrim(refund_reference)
      AND (TG_TABLE_NAME<>'cancellation_refunds' OR r.order_id<>(to_jsonb(NEW)->>'order_id')::integer))
    OR EXISTS (SELECT FROM public.return_refund_decisions r WHERE r.payment_reference=btrim(refund_reference)
      AND (TG_TABLE_NAME<>'return_refund_decisions' OR r.id<>(to_jsonb(NEW)->>'id')::integer))
    OR EXISTS (SELECT FROM public.payment_exception_actions r WHERE r.action='REFUND' AND r.reference=btrim(refund_reference)
      AND (TG_TABLE_NAME<>'payment_exception_actions' OR r.id<>(to_jsonb(NEW)->>'id')::integer)) THEN
    RAISE EXCEPTION 'Actual refund reference has already been recorded' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_refund_reference ON public.cancellation_refunds;
CREATE TRIGGER guard_refund_reference BEFORE INSERT OR UPDATE ON public.cancellation_refunds FOR EACH ROW EXECUTE FUNCTION public.guard_refund_reference();
DROP TRIGGER IF EXISTS guard_refund_reference ON public.return_refund_decisions;
CREATE TRIGGER guard_refund_reference BEFORE INSERT OR UPDATE ON public.return_refund_decisions FOR EACH ROW EXECUTE FUNCTION public.guard_refund_reference();
DROP TRIGGER IF EXISTS guard_refund_reference ON public.payment_exception_actions;
CREATE TRIGGER guard_refund_reference BEFORE INSERT ON public.payment_exception_actions FOR EACH ROW EXECUTE FUNCTION public.guard_refund_reference();
REVOKE ALL ON FUNCTION public.guard_refund_reference() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.guard_order_resolution() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='orders' THEN
    IF current_user='app_user' AND current_setting('app.order_operation',true)='status'
      AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      RAISE EXCEPTION 'Payment status changes require financial evidence and reconciliation' USING ERRCODE='42501';
    END IF;
  ELSE
    IF NEW.transaction_type IN ('EARN','EARNED') AND EXISTS (
      SELECT FROM public.delivery_disputes WHERE order_id=NEW.order_id AND outcome IS DISTINCT FROM 'DELIVERED') THEN
      RAISE EXCEPTION 'Delivery dispute outcome prevents loyalty points' USING ERRCODE='22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_order_resolution ON public.orders;
CREATE TRIGGER guard_order_resolution BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.guard_order_resolution();
DROP TRIGGER IF EXISTS guard_order_resolution ON public.loyalty_point_logs;
CREATE TRIGGER guard_order_resolution BEFORE INSERT ON public.loyalty_point_logs FOR EACH ROW EXECUTE FUNCTION public.guard_order_resolution();
REVOKE ALL ON FUNCTION public.guard_order_resolution() FROM PUBLIC;
COMMIT;
