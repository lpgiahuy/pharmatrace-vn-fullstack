\set ON_ERROR_STOP on
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cart_items'
        AND policyname NOT IN ('cart_customer_select', 'cart_customer_insert', 'cart_customer_update', 'cart_customer_delete')) THEN
        RAISE EXCEPTION 'Existing cart policies need review before applying cart RLS';
    END IF;
END
$$;

REVOKE ALL PRIVILEGES ON public.cart_items FROM PUBLIC, app_user;
GRANT SELECT, DELETE ON public.cart_items TO app_user;
GRANT INSERT (customer_id, variant_id, quantity, created_at) ON public.cart_items TO app_user;
GRANT UPDATE (variant_id, quantity) ON public.cart_items TO app_user;
REVOKE ALL PRIVILEGES ON SEQUENCE public.cart_items_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.cart_items_id_seq TO app_user;

DROP POLICY IF EXISTS cart_customer_select ON public.cart_items;
CREATE POLICY cart_customer_select ON public.cart_items FOR SELECT TO app_user
USING (current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer);

DROP POLICY IF EXISTS cart_customer_insert ON public.cart_items;
CREATE POLICY cart_customer_insert ON public.cart_items FOR INSERT TO app_user
WITH CHECK (current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer);

DROP POLICY IF EXISTS cart_customer_update ON public.cart_items;
CREATE POLICY cart_customer_update ON public.cart_items FOR UPDATE TO app_user
USING (current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer)
WITH CHECK (current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer);

DROP POLICY IF EXISTS cart_customer_delete ON public.cart_items;
CREATE POLICY cart_customer_delete ON public.cart_items FOR DELETE TO app_user
USING (current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer);

ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items FORCE ROW LEVEL SECURITY;
COMMIT;
