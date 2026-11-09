\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
        AND tablename = 'customer_wishlists'
        AND policyname NOT IN ('wishlist_customer_select', 'wishlist_customer_insert', 'wishlist_customer_delete')) THEN
        RAISE EXCEPTION 'Existing wishlist policies need review before applying wishlist RLS';
    END IF;
END
$$;

REVOKE ALL PRIVILEGES ON public.customer_wishlists FROM PUBLIC, app_user;
GRANT SELECT, INSERT, DELETE ON public.customer_wishlists TO app_user;

DROP POLICY IF EXISTS wishlist_customer_select ON public.customer_wishlists;
CREATE POLICY wishlist_customer_select ON public.customer_wishlists FOR SELECT TO app_user
USING (
    current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
);

DROP POLICY IF EXISTS wishlist_customer_insert ON public.customer_wishlists;
CREATE POLICY wishlist_customer_insert ON public.customer_wishlists FOR INSERT TO app_user
WITH CHECK (
    current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
);

DROP POLICY IF EXISTS wishlist_customer_delete ON public.customer_wishlists;
CREATE POLICY wishlist_customer_delete ON public.customer_wishlists FOR DELETE TO app_user
USING (
    current_setting('app.current_user_type', true) = 'customer'
    AND current_setting('app.current_user_role', true) = 'CUSTOMER'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
);

ALTER TABLE public.customer_wishlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_wishlists FORCE ROW LEVEL SECURITY;
COMMIT;
