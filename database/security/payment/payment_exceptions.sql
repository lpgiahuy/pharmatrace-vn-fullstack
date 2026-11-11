\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS public.payment_exceptions (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES public.orders(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('BANK_TRANSFER','E_WALLET')),
  payment_reference text NOT NULL,
  reason text NOT NULL,
  recorded_by integer NOT NULL REFERENCES public.employees(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  approved_by integer REFERENCES public.employees(id),
  approved_at timestamptz,
  cashbook_id integer REFERENCES public.cashbook_logs(id),
  allocated numeric(15,2) NOT NULL DEFAULT 0 CHECK (allocated >= 0),
  refunded numeric(15,2) NOT NULL DEFAULT 0 CHECK (refunded >= 0),
  CHECK (allocated + refunded <= amount),
  UNIQUE(payment_method,payment_reference)
);
CREATE TABLE IF NOT EXISTS public.payment_exception_actions (
  id serial PRIMARY KEY,
  exception_id integer NOT NULL REFERENCES public.payment_exceptions(id),
  action text NOT NULL CHECK (action IN ('APPROVE','APPLY','REFUND')),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  reference text NOT NULL,
  reason text NOT NULL,
  actor_id integer NOT NULL REFERENCES public.employees(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  cashbook_id integer REFERENCES public.cashbook_logs(id),
  UNIQUE(exception_id,action,reference)
);
CREATE UNIQUE INDEX IF NOT EXISTS unique_exception_refund_reference ON public.payment_exception_actions(reference) WHERE action='REFUND';
REVOKE ALL ON public.payment_exceptions,public.payment_exception_actions FROM PUBLIC,app_user;
GRANT SELECT ON public.payment_exceptions,public.payment_exception_actions TO app_user;
ALTER TABLE public.payment_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_exceptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_exception_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_exception_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS payment_exception_read ON public.payment_exceptions;
CREATE POLICY payment_exception_read ON public.payment_exceptions FOR SELECT TO app_user USING (
  current_setting('app.current_user_type',true)='employee'
  AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','ACCOUNTANT','FINANCE_MANAGER')
);
DROP POLICY IF EXISTS payment_exception_action_read ON public.payment_exception_actions;
CREATE POLICY payment_exception_action_read ON public.payment_exception_actions FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.payment_exceptions p WHERE p.id=exception_id)
);
-- The same bank/wallet transaction cannot be recorded through both payment paths.
CREATE OR REPLACE FUNCTION public.guard_payment_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  NEW.payment_reference:=btrim(NEW.payment_reference);
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.payment_method||':'||NEW.payment_reference,0));
  IF (TG_TABLE_NAME='payment_exceptions' AND EXISTS (SELECT FROM public.online_payment_receipts
      WHERE payment_method=NEW.payment_method AND payment_reference=NEW.payment_reference AND status <> 'REJECTED'))
    OR (TG_TABLE_NAME='online_payment_receipts' AND EXISTS (SELECT FROM public.payment_exceptions
      WHERE payment_method=NEW.payment_method AND payment_reference=NEW.payment_reference)) THEN
    RAISE EXCEPTION 'Payment reference was already recorded through another workflow' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_payment_reference() FROM PUBLIC,app_user;
DROP TRIGGER IF EXISTS guard_payment_reference ON public.payment_exceptions;
CREATE TRIGGER guard_payment_reference BEFORE INSERT ON public.payment_exceptions FOR EACH ROW EXECUTE FUNCTION public.guard_payment_reference();
DROP TRIGGER IF EXISTS guard_payment_reference ON public.online_payment_receipts;
CREATE TRIGGER guard_payment_reference BEFORE INSERT OR UPDATE OF status ON public.online_payment_receipts FOR EACH ROW EXECUTE FUNCTION public.guard_payment_reference();

CREATE OR REPLACE FUNCTION public.record_payment_exception(target integer, paid numeric, method text, reference text, reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor integer; result integer;
BEGIN
  actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','ACCOUNTANT','FINANCE_MANAGER') THEN
    RAISE EXCEPTION 'Payment recording is not authorized' USING ERRCODE='42501';
  END IF;
  IF paid IS NULL OR paid::text IN ('NaN','Infinity','-Infinity') OR paid<=0 OR paid<>round(paid,2)
    OR coalesce(method,'') NOT IN ('BANK_TRANSFER','E_WALLET')
    OR length(btrim(coalesce(reference,''))) NOT BETWEEN 1 AND 100
    OR length(btrim(coalesce(reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Actual amount, method, payment reference and exception reason are required' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.orders WHERE id=target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.payment_exceptions(order_id,amount,payment_method,payment_reference,reason,recorded_by)
    VALUES(target,paid,method,btrim(reference),btrim(reason),actor) RETURNING id INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.resolve_payment_exception(target integer, receipt integer, decision text, units numeric, reference text, reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; p public.payment_exceptions%ROWTYPE; actor integer; cash integer; total numeric;
BEGIN
  actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','FINANCE_MANAGER') THEN
    RAISE EXCEPTION 'Finance approval is required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id=target FOR UPDATE;
  SELECT * INTO p FROM public.payment_exceptions WHERE id=receipt AND order_id=target FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment exception not found' USING ERRCODE='P0002'; END IF;
  IF coalesce(decision,'') NOT IN ('APPROVE','APPLY','REFUND')
    OR length(btrim(coalesce(reference,''))) NOT BETWEEN 1 AND 100
    OR length(btrim(coalesce(reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Decision, reference and reason are required' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT FROM public.payment_exception_actions a WHERE a.exception_id=receipt AND a.action=decision AND a.reference=btrim(resolve_payment_exception.reference)) THEN
    IF NOT EXISTS (SELECT FROM public.payment_exception_actions a WHERE a.exception_id=receipt AND a.action=decision
      AND a.reference=btrim(resolve_payment_exception.reference) AND a.amount=CASE WHEN decision='APPROVE' THEN p.amount ELSE units END
      AND a.reason=btrim(resolve_payment_exception.reason)) THEN
      RAISE EXCEPTION 'This decision reference has already been used with different details' USING ERRCODE='22023';
    END IF;
    RETURN jsonb_build_object('id',receipt,'status','ALREADY_RECORDED');
  END IF;
  IF decision='APPROVE' THEN
    IF p.approved_by IS NOT NULL THEN RETURN jsonb_build_object('id',receipt,'status','ALREADY_APPROVED'); END IF;
    units:=p.amount;
    INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,order_id,payment_method,note,created_by_user_id)
      VALUES('PEX-IN-'||receipt,'INCOME','UNALLOCATED_PAYMENT',units,'CUSTOMER',target,p.payment_method,p.payment_reference||': '||btrim(reason),actor) RETURNING id INTO cash;
    UPDATE public.payment_exceptions SET approved_by=actor,approved_at=now(),cashbook_id=cash WHERE id=receipt;
  ELSE
    IF p.approved_by IS NULL OR units IS NULL OR units::text IN ('NaN','Infinity','-Infinity') OR units<=0
      OR units<>round(units,2) OR units > p.amount-p.refunded-(CASE WHEN decision='REFUND' AND ord.order_status IN ('CANCELLED','CANCELED') AND ord.payment_status IS DISTINCT FROM 'PAID' THEN 0 ELSE p.allocated END) THEN
      RAISE EXCEPTION 'Amount exceeds approved unallocated funds' USING ERRCODE='22023';
    END IF;
    IF decision='APPLY' THEN
      SELECT coalesce(sum(allocated),0) INTO total FROM public.payment_exceptions WHERE order_id=target;
      IF ord.order_status NOT IN ('PENDING','WAITING_INTERNAL_TRANSFER','PROCESSING') OR ord.payment_status IS DISTINCT FROM 'UNPAID'
        OR ord.payment_method IS DISTINCT FROM p.payment_method OR total+units > ord.total_amount
        OR EXISTS (SELECT FROM public.online_payment_receipts WHERE order_id=target AND status <> 'REJECTED') THEN
        RAISE EXCEPTION 'Cannot apply funds to this order; keep on hold or refund instead' USING ERRCODE='22023';
      END IF;
      UPDATE public.payment_exceptions SET allocated=allocated+units WHERE id=receipt;
      IF total+units=ord.total_amount THEN UPDATE public.orders SET payment_status='PAID' WHERE id=target; END IF;
    ELSE
      INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,order_id,payment_method,note,created_by_user_id)
        VALUES('PEX-OUT-'||gen_random_uuid()::text,'EXPENSE','UNALLOCATED_PAYMENT_REFUND',units,'CUSTOMER',target,p.payment_method,
          'Refund reference: '||btrim(reference)||'; '||btrim(reason),actor) RETURNING id INTO cash;
      UPDATE public.payment_exceptions SET refunded=refunded+units,
        allocated=CASE WHEN ord.order_status IN ('CANCELLED','CANCELED') THEN least(allocated,amount-refunded-units) ELSE allocated END WHERE id=receipt;
    END IF;
  END IF;
  INSERT INTO public.payment_exception_actions(exception_id,action,amount,reference,reason,actor_id,cashbook_id)
    VALUES(receipt,decision,units,btrim(reference),btrim(reason),actor,cash);
  RETURN jsonb_build_object('id',receipt,'status','RECORDED','cashbookId',cash);
END $$;
REVOKE ALL ON FUNCTION public.record_payment_exception(integer,numeric,text,text,text), public.resolve_payment_exception(integer,integer,text,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_payment_exception(integer,numeric,text,text,text), public.resolve_payment_exception(integer,integer,text,numeric,text,text) TO app_user;

CREATE OR REPLACE FUNCTION public.require_online_payment_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.payment_method IN ('BANK_TRANSFER','E_WALLET') AND NEW.payment_status='PAID'
    AND OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NOT EXISTS (
      SELECT FROM public.online_payment_receipts r WHERE r.order_id=NEW.id AND r.status='APPROVED'
        AND r.amount=NEW.total_amount AND r.payment_method=NEW.payment_method AND r.cashbook_id IS NOT NULL
    ) AND (SELECT coalesce(sum(p.allocated),0) FROM public.payment_exceptions p
      WHERE p.order_id=NEW.id AND p.approved_by IS NOT NULL AND p.cashbook_id IS NOT NULL AND p.payment_method=NEW.payment_method) <> NEW.total_amount THEN
    RAISE EXCEPTION 'Approved payment evidence is required' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
COMMIT;
