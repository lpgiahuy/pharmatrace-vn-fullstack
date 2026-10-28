\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'vouchers'
        AND policyname NOT IN ('voucher_read', 'voucher_insert', 'voucher_update', 'voucher_delete')) THEN
        RAISE EXCEPTION 'Existing voucher policies need manual review';
    END IF;
END $$;

GRANT INSERT (voucher_id) ON public.orders TO app_user;

REVOKE ALL ON public.vouchers FROM PUBLIC, app_user;
GRANT SELECT ON public.vouchers TO app_user;
GRANT INSERT (voucher_code, discount_type, discount_value, min_order_value, max_discount_amount,
    total_quantity, used_quantity, start_date, end_date, status) ON public.vouchers TO app_user;
GRANT UPDATE (voucher_code, discount_type, discount_value, min_order_value, max_discount_amount,
    total_quantity, used_quantity, start_date, end_date, status), DELETE ON public.vouchers TO app_user;
REVOKE ALL ON SEQUENCE public.vouchers_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.vouchers_id_seq TO app_user;

CREATE OR REPLACE FUNCTION public.voucher_staff(write_access boolean) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT current_setting('app.current_user_type', true) = 'employee'
      AND NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
      AND CASE WHEN write_access THEN current_setting('app.voucher_scope', true) = 'manage'
            AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER')
        ELSE current_setting('app.voucher_scope', true) IN ('read', 'manage')
            AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST') END
$$;
CREATE OR REPLACE FUNCTION public.voucher_checkout() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT current_setting('app.voucher_scope', true) = 'checkout'
      AND current_setting('app.order_operation', true) = 'checkout'
      AND current_setting('app.current_user_type', true) = 'customer'
      AND current_setting('app.current_user_role', true) = 'CUSTOMER'
      AND NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
$$;
CREATE OR REPLACE FUNCTION public.voucher_terms(v public.vouchers) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT char_length(btrim(v.voucher_code)) BETWEEN 1 AND 50
      AND v.voucher_code = upper(btrim(v.voucher_code))
      AND v.discount_type IN ('PERCENT', 'FIXED') AND v.discount_value > 0
      AND (v.discount_type <> 'PERCENT' OR v.discount_value <= 100)
      AND coalesce(v.min_order_value, 0) >= 0
      AND (v.discount_type <> 'PERCENT' OR (v.max_discount_amount IS NOT NULL AND v.max_discount_amount > 0))
      AND (v.max_discount_amount IS NULL OR v.max_discount_amount > 0)
      AND v.total_quantity > 0 AND coalesce(v.used_quantity, 0) BETWEEN 0 AND v.total_quantity
      AND v.start_date IS NOT NULL AND v.end_date IS NOT NULL AND v.start_date <= v.end_date
      AND v.status IN ('ACTIVE', 'INACTIVE', 'EXPIRED')
$$;
REVOKE ALL ON FUNCTION public.voucher_staff(boolean), public.voucher_checkout(), public.voucher_terms(public.vouchers) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.voucher_staff(boolean), public.voucher_checkout(), public.voucher_terms(public.vouchers) TO app_user;
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.vouchers v WHERE public.voucher_terms(v) IS NOT TRUE) THEN
        RAISE EXCEPTION 'Reconcile voucher codes, terms, dates and usage capacity before enabling voucher RLS';
    END IF;
END $$;

ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_required_terms_check;
ALTER TABLE public.vouchers ADD CONSTRAINT vouchers_required_terms_check CHECK (
    start_date IS NOT NULL AND end_date IS NOT NULL AND start_date <= end_date
    AND (discount_type <> 'PERCENT' OR (max_discount_amount IS NOT NULL AND max_discount_amount > 0))
);

CREATE OR REPLACE FUNCTION public.guard_voucher_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN RETURN NEW; END IF;
    IF public.voucher_staff(true) AND NEW.used_quantity IS NOT DISTINCT FROM OLD.used_quantity THEN RETURN NEW; END IF;
    IF public.voucher_checkout()
      AND NULLIF(current_setting('app.voucher_order_id', true), '') IS NOT NULL
      AND (to_jsonb(NEW) - 'used_quantity') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'used_quantity')
      AND NEW.used_quantity = coalesce(OLD.used_quantity, 0) + 1
      AND OLD.status = 'ACTIVE' AND NEW.used_quantity <= OLD.total_quantity
      AND (OLD.start_date IS NULL OR OLD.start_date <= now()) AND (OLD.end_date IS NULL OR OLD.end_date >= now())
      AND EXISTS (SELECT FROM public.orders o
        WHERE o.id = NULLIF(current_setting('app.voucher_order_id', true), '')::integer AND o.voucher_id = OLD.id
          AND public.order_customer(o.customer_id) AND o.order_status IN ('PENDING', 'WAITING_INTERNAL_TRANSFER')
          AND o.subtotal_amount >= coalesce(OLD.min_order_value, 0)
          AND o.discount_amount = round(least(o.subtotal_amount,
            CASE WHEN OLD.discount_type = 'PERCENT' THEN least(o.subtotal_amount * OLD.discount_value / 100,
                coalesce(OLD.max_discount_amount, o.subtotal_amount)) ELSE OLD.discount_value END), 2)) THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Voucher usage can only be consumed by its checkout order; protected fields cannot be changed' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.guard_voucher_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_voucher_update() TO app_user;
DROP TRIGGER IF EXISTS voucher_update_guard ON public.vouchers;
CREATE TRIGGER voucher_update_guard BEFORE UPDATE ON public.vouchers FOR EACH ROW EXECUTE FUNCTION public.guard_voucher_update();

DROP POLICY IF EXISTS voucher_read ON public.vouchers;
CREATE POLICY voucher_read ON public.vouchers FOR SELECT TO app_user USING (
    public.voucher_staff(false)
    OR (upper(btrim(voucher_code)) = current_setting('app.voucher_code', true)
      AND ((current_setting('app.voucher_scope', true) = 'validate'
          AND coalesce(current_setting('app.current_user_id', true), '') = ''
          AND coalesce(current_setting('app.current_user_type', true), '') = '') OR public.voucher_checkout())));
DROP POLICY IF EXISTS voucher_insert ON public.vouchers;
CREATE POLICY voucher_insert ON public.vouchers FOR INSERT TO app_user WITH CHECK (
    public.voucher_staff(true) AND public.voucher_terms(vouchers) AND used_quantity = 0);
DROP POLICY IF EXISTS voucher_update ON public.vouchers;
CREATE POLICY voucher_update ON public.vouchers FOR UPDATE TO app_user
USING (public.voucher_staff(true) OR (public.voucher_checkout()
    AND upper(btrim(voucher_code)) = current_setting('app.voucher_code', true)
    AND status = 'ACTIVE' AND coalesce(used_quantity, 0) < total_quantity
    AND (start_date IS NULL OR start_date <= now()) AND (end_date IS NULL OR end_date >= now())))
WITH CHECK (public.voucher_terms(vouchers) AND (public.voucher_staff(true) OR public.voucher_checkout()));
DROP POLICY IF EXISTS voucher_delete ON public.vouchers;
CREATE POLICY voucher_delete ON public.vouchers FOR DELETE TO app_user USING (public.voucher_staff(true) AND coalesce(used_quantity, 0) = 0);

ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers FORCE ROW LEVEL SECURITY;
COMMIT;
