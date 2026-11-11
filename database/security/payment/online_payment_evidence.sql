\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install financial controls as a trusted superuser';
  END IF;
END $$;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_role_check;
ALTER TABLE public.employees ADD CONSTRAINT employees_role_check CHECK (role IN (
  'SUPER_ADMIN','ADMIN','STORE_MANAGER','PHARMACIST','WAREHOUSE_STAFF','WAREHOUSE_MANAGER','FACTORY_WAREHOUSE_STAFF','ACCOUNTANT','FINANCE_MANAGER'
));
CREATE OR REPLACE FUNCTION public.order_staff(unit_id integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT current_setting('app.current_user_type', true) = 'employee'
    AND nullif(current_setting('app.current_user_id', true), '') IS NOT NULL
    AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST','WAREHOUSE_STAFF','ACCOUNTANT','FINANCE_MANAGER')
    AND (current_setting('app.current_user_role', true) IN ('SUPER_ADMIN','ACCOUNTANT','FINANCE_MANAGER')
      OR unit_id = nullif(current_setting('app.current_unit_id', true), '')::integer)
$$;
CREATE TABLE IF NOT EXISTS public.online_payment_receipts (
  id serial PRIMARY KEY,
  order_id integer NOT NULL REFERENCES public.orders(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  payment_method text NOT NULL CHECK (payment_method IN ('BANK_TRANSFER','E_WALLET')),
  payment_reference text NOT NULL CHECK (length(btrim(payment_reference)) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  recorded_by integer NOT NULL REFERENCES public.employees(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  approved_by integer REFERENCES public.employees(id),
  approved_at timestamptz,
  rejection_reason text,
  rejected_by integer REFERENCES public.employees(id),
  rejected_at timestamptz,
  cashbook_id integer UNIQUE REFERENCES public.cashbook_logs(id),
  UNIQUE(payment_method,payment_reference)
);
ALTER TABLE public.online_payment_receipts ADD COLUMN IF NOT EXISTS rejected_by integer REFERENCES public.employees(id);
ALTER TABLE public.online_payment_receipts ADD COLUMN IF NOT EXISTS rejected_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_online_payment_active ON public.online_payment_receipts(order_id) WHERE status IN ('PENDING','APPROVED');
ALTER TABLE public.online_payment_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_payment_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.online_payment_receipts FROM PUBLIC, app_user;
GRANT SELECT ON public.online_payment_receipts TO app_user;
DROP POLICY IF EXISTS online_payment_read ON public.online_payment_receipts;
CREATE POLICY online_payment_read ON public.online_payment_receipts FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id))
);
CREATE OR REPLACE FUNCTION public.submit_online_payment(target integer, paid numeric, method text, reference text) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; actor integer; receipt integer;
BEGIN
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','ACCOUNTANT','FINANCE_MANAGER') THEN
    RAISE EXCEPTION 'Payment recording is not authorized' USING ERRCODE='42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR paid IS NULL OR paid::text IN ('NaN','Infinity','-Infinity') OR paid <= 0 OR paid <> round(paid,2)
    OR coalesce(method,'') NOT IN ('BANK_TRANSFER','E_WALLET') OR length(btrim(coalesce(reference,''))) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Valid amount, method and reference are required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id=target FOR UPDATE;
  IF NOT FOUND OR public.order_staff(ord.export_facility_id) IS NOT TRUE THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
  IF ord.order_status <> 'PENDING' OR ord.payment_status IS DISTINCT FROM 'UNPAID' OR ord.payment_method <> method OR paid <> ord.total_amount
    OR (method = 'E_WALLET' AND ord.created_at <= now()-interval '15 minutes')
    OR (method = 'BANK_TRANSFER' AND ord.created_at <= now()-interval '30 minutes') THEN
    RAISE EXCEPTION 'Payment does not match an eligible unpaid order; reconcile late or unmatched payments separately' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.online_payment_receipts(order_id,amount,payment_method,payment_reference,recorded_by)
    VALUES(target,paid,method,btrim(reference),actor) RETURNING id INTO receipt;
  RETURN receipt;
END $$;
CREATE OR REPLACE FUNCTION public.approve_online_payment(target integer, receipt_id integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; receipt public.online_payment_receipts%ROWTYPE; actor integer; cash_id integer;
BEGIN
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','FINANCE_MANAGER') THEN
    RAISE EXCEPTION 'Payment approval is not authorized' USING ERRCODE='42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id',true),'')::integer;
  SELECT * INTO ord FROM public.orders WHERE id=target FOR UPDATE;
  IF NOT FOUND OR actor IS NULL OR public.order_staff(ord.export_facility_id) IS NOT TRUE THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO receipt FROM public.online_payment_receipts WHERE id=receipt_id AND order_id=target FOR UPDATE;
  IF NOT FOUND OR receipt.status <> 'PENDING' OR ord.order_status <> 'PENDING' OR ord.payment_status IS DISTINCT FROM 'UNPAID'
    OR receipt.amount <> ord.total_amount OR receipt.payment_method <> ord.payment_method
    OR (ord.payment_method = 'E_WALLET' AND ord.created_at <= now()-interval '15 minutes')
    OR (ord.payment_method = 'BANK_TRANSFER' AND ord.created_at <= now()-interval '30 minutes') THEN
    RAISE EXCEPTION 'Payment is no longer eligible; reconcile late or unmatched payments separately' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,order_id,payment_method,note,created_by_user_id)
    VALUES('PAY-'||receipt.id,'INCOME','ONLINE_PAYMENT',receipt.amount,'CUSTOMER',target,receipt.payment_method,
      'Payment reference: '||receipt.payment_reference,receipt.recorded_by) RETURNING id INTO cash_id;
  UPDATE public.online_payment_receipts SET status='APPROVED',approved_by=actor,approved_at=now(),cashbook_id=cash_id WHERE id=receipt.id;
  UPDATE public.orders SET payment_status='PAID' WHERE id=target;
  RETURN cash_id;
END $$;
CREATE OR REPLACE FUNCTION public.reject_online_payment(target integer, receipt_id integer, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; actor integer;
BEGIN
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','FINANCE_MANAGER') THEN
    RAISE EXCEPTION 'Payment rejection is not authorized' USING ERRCODE='42501';
  END IF;
  actor := nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR length(btrim(coalesce(reason,''))) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Payment rejection reason is required' USING ERRCODE='22023';
  END IF;
  SELECT * INTO ord FROM public.orders WHERE id=target FOR UPDATE;
  IF NOT FOUND OR public.order_staff(ord.export_facility_id) IS NOT TRUE THEN RAISE EXCEPTION 'Order not found' USING ERRCODE='P0002'; END IF;
  UPDATE public.online_payment_receipts SET status='REJECTED',rejection_reason=btrim(reason),rejected_by=actor,rejected_at=now()
    WHERE id=receipt_id AND order_id=target AND status='PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending payment evidence not found' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.submit_online_payment(integer,numeric,text,text), public.approve_online_payment(integer,integer), public.reject_online_payment(integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_online_payment(integer,numeric,text,text), public.approve_online_payment(integer,integer), public.reject_online_payment(integer,integer,text) TO app_user;
CREATE OR REPLACE FUNCTION public.require_online_payment_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.payment_method IN ('BANK_TRANSFER','E_WALLET') AND NEW.payment_status='PAID'
    AND OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NOT EXISTS (
      SELECT FROM public.online_payment_receipts r WHERE r.order_id=NEW.id AND r.status='APPROVED'
        AND r.amount=NEW.total_amount AND r.payment_method=NEW.payment_method AND r.cashbook_id IS NOT NULL
    ) THEN RAISE EXCEPTION 'Approved payment evidence is required' USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_online_payment_evidence() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS require_online_payment_evidence ON public.orders;
CREATE TRIGGER require_online_payment_evidence BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.require_online_payment_evidence();
COMMIT;
