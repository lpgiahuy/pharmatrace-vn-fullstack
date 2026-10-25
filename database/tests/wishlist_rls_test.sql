\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.customers (full_name, email)
VALUES ('Wishlist RLS A', format('wishlist-a-%s@example.test', txid_current()))
RETURNING id AS customer_a \gset wishlist_
INSERT INTO public.customers (full_name, email)
VALUES ('Wishlist RLS B', format('wishlist-b-%s@example.test', txid_current()))
RETURNING id AS customer_b \gset wishlist_
SELECT id AS medicine FROM public.medicines ORDER BY id LIMIT 1 \gset wishlist_
INSERT INTO public.customer_wishlists (customer_id, medicine_id)
VALUES (:wishlist_customer_b, :wishlist_medicine);
SELECT set_config('test.wishlist_customer_a', :'wishlist_customer_a', true);
SELECT set_config('test.wishlist_customer_b', :'wishlist_customer_b', true);
SELECT set_config('test.wishlist_medicine', :'wishlist_medicine', true);

SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', '', true);
SELECT set_config('app.current_user_type', '', true);
SELECT set_config('app.current_user_role', '', true);
DO $$
BEGIN
    IF EXISTS (SELECT FROM public.customer_wishlists) THEN
        RAISE EXCEPTION 'Missing context exposed wishlist rows';
    END IF;
    RAISE NOTICE 'PASS wishlist missing context';
END
$$;

SELECT set_config('app.current_user_id', :'wishlist_customer_a', true);
SELECT set_config('app.current_user_type', 'customer', true);
SELECT set_config('app.current_user_role', 'CUSTOMER', true);
INSERT INTO public.customer_wishlists (customer_id, medicine_id)
VALUES (:wishlist_customer_a, :wishlist_medicine);
DO $$
DECLARE
    affected integer;
BEGIN
    IF (SELECT count(*) FROM public.customer_wishlists) <> 1 THEN
        RAISE EXCEPTION 'Customer cannot see exactly their own fixture';
    END IF;
    BEGIN
        INSERT INTO public.customer_wishlists (customer_id, medicine_id)
        VALUES (current_setting('test.wishlist_customer_b')::integer, current_setting('test.wishlist_medicine')::integer);
        RAISE EXCEPTION 'Cross-customer insert was allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    DELETE FROM public.customer_wishlists WHERE customer_id = current_setting('test.wishlist_customer_b')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Cross-customer delete was allowed'; END IF;
    BEGIN
        UPDATE public.customer_wishlists SET customer_id = current_setting('test.wishlist_customer_b')::integer;
        RAISE EXCEPTION 'Wishlist UPDATE was allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
        TRUNCATE public.customer_wishlists;
        RAISE EXCEPTION 'Wishlist TRUNCATE was allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'PASS own read/insert and denied cross-customer writes, UPDATE, TRUNCATE';
END
$$;

SELECT set_config('app.current_user_type', 'employee', true);
SELECT set_config('app.current_user_role', 'SUPER_ADMIN', true);
DO $$
BEGIN
    IF EXISTS (SELECT FROM public.customer_wishlists) THEN
        RAISE EXCEPTION 'Employee with a matching customer ID could read wishlist';
    END IF;
    BEGIN
        INSERT INTO public.customer_wishlists (customer_id, medicine_id)
        VALUES (current_setting('test.wishlist_customer_a')::integer, current_setting('test.wishlist_medicine')::integer);
        RAISE EXCEPTION 'Employee could write a customer wishlist';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    RAISE NOTICE 'PASS employee identity denied';
END
$$;

SELECT set_config('app.current_user_type', 'customer', true);
SELECT set_config('app.current_user_role', 'CUSTOMER', true);
DELETE FROM public.customer_wishlists;
RESET ROLE;
DO $$
BEGIN
    IF (SELECT count(*) FROM public.customer_wishlists
        WHERE customer_id = current_setting('test.wishlist_customer_b')::integer) <> 1 THEN
        RAISE EXCEPTION 'Deleting own wishlist affected another customer';
    END IF;
    IF EXISTS (SELECT FROM public.customer_wishlists
        WHERE customer_id = current_setting('test.wishlist_customer_a')::integer) THEN
        RAISE EXCEPTION 'Deleting own wishlist did not work';
    END IF;
    RAISE NOTICE 'PASS own delete preserves foreign wishlist';
END
$$;
ROLLBACK;
