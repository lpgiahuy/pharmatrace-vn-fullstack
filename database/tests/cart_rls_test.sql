\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.customers (full_name, email)
VALUES ('Cart RLS A', format('cart-a-%s@example.test', txid_current()))
RETURNING id AS a \gset cart_
INSERT INTO public.customers (full_name, email)
VALUES ('Cart RLS B', format('cart-b-%s@example.test', txid_current()))
RETURNING id AS b \gset cart_
SELECT id AS variant FROM public.packaging_variants ORDER BY id LIMIT 1 \gset cart_
INSERT INTO public.cart_items (customer_id, variant_id, quantity) VALUES (:cart_b, :cart_variant, 1);
SELECT set_config('test.cart_b', :'cart_b', true);
SELECT set_config('test.cart_variant', :'cart_variant', true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', '', true);
SELECT set_config('app.current_user_type', '', true);
SELECT set_config('app.current_user_role', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.cart_items) THEN RAISE EXCEPTION 'Missing context exposed cart'; END IF;
    RAISE NOTICE 'PASS cart missing context';
END $$;

SELECT set_config('app.current_user_id', :'cart_a', true);
SELECT set_config('app.current_user_type', 'customer', true);
SELECT set_config('app.current_user_role', 'CUSTOMER', true);
INSERT INTO public.cart_items (customer_id, variant_id, quantity) VALUES (:cart_a, :cart_variant, 1);
DO $$
DECLARE affected integer;
BEGIN
    IF (SELECT count(*) FROM public.cart_items) <> 1 THEN RAISE EXCEPTION 'Cart ownership read failed'; END IF;
    UPDATE public.cart_items SET quantity = 2;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Own cart update failed'; END IF;
    UPDATE public.cart_items SET quantity = 3 WHERE customer_id = current_setting('test.cart_b')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Cross-customer update allowed'; END IF;
    DELETE FROM public.cart_items WHERE customer_id = current_setting('test.cart_b')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Cross-customer delete allowed'; END IF;
    BEGIN
        INSERT INTO public.cart_items (customer_id, variant_id, quantity)
        VALUES (current_setting('test.cart_b')::integer, current_setting('test.cart_variant')::integer, 1);
        RAISE EXCEPTION 'Cross-customer insert allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        UPDATE public.cart_items SET customer_id = current_setting('test.cart_b')::integer;
        RAISE EXCEPTION 'Cart ownership update allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        TRUNCATE public.cart_items;
        RAISE EXCEPTION 'Cart TRUNCATE allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        PERFORM setval('public.cart_items_id_seq', 1);
        RAISE EXCEPTION 'Cart sequence reset allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS own read/insert/update; cross-customer writes, ownership, TRUNCATE and sequence reset denied';
END $$;

SELECT set_config('app.current_user_type', 'employee', true);
SELECT set_config('app.current_user_role', 'SUPER_ADMIN', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.cart_items) THEN RAISE EXCEPTION 'Employee exposed cart with same ID'; END IF;
    RAISE NOTICE 'PASS employee context denied';
END $$;
SELECT set_config('app.current_user_type', 'customer', true);
SELECT set_config('app.current_user_role', 'CUSTOMER', true);
DELETE FROM public.cart_items;
RESET ROLE;
DO $$ BEGIN
    IF (SELECT count(*) FROM public.cart_items WHERE customer_id = current_setting('test.cart_b')::integer AND quantity = 1) <> 1 THEN
        RAISE EXCEPTION 'Foreign cart modified';
    END IF;
    RAISE NOTICE 'PASS own delete preserves foreign cart';
END $$;
ROLLBACK;
