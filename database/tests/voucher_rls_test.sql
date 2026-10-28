\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.customers (full_name) VALUES ('Voucher RLS customer') RETURNING id AS customer \gset test_
INSERT INTO public.vouchers (voucher_code, discount_type, discount_value, total_quantity, used_quantity, start_date, end_date)
VALUES (format('VOUCHER-RLS-%s', txid_current()), 'FIXED', 1000, 3, 0, now() - interval '1 day', now() + interval '1 day') RETURNING id AS voucher, voucher_code AS code \gset test_
INSERT INTO public.vouchers (voucher_code, discount_type, discount_value, total_quantity, start_date, end_date)
VALUES (format('VOUCHER-OTHER-%s', txid_current()), 'FIXED', 1000, 3, now() - interval '1 day', now() + interval '1 day');
INSERT INTO public.orders (order_code, customer_id, voucher_id, subtotal_amount, discount_amount, total_amount, order_status)
VALUES (format('VOUCHER-ORDER-%s', txid_current()), :test_customer, :test_voucher, 10000, 1000, 9000, 'PENDING') RETURNING id AS order \gset test_
SELECT set_config('test.voucher_id', :'test_voucher', true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', '', true), set_config('app.current_user_type', '', true),
       set_config('app.current_user_role', '', true), set_config('app.voucher_scope', '', true), set_config('app.voucher_code', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.vouchers) THEN RAISE EXCEPTION 'Missing voucher context exposed rows'; END IF;
    RAISE NOTICE 'PASS no voucher context hides rows';
END $$;
SELECT set_config('app.voucher_scope', 'validate', true), set_config('app.voucher_code', :'test_code', true);
DO $$ DECLARE affected integer; BEGIN
    IF (SELECT count(*) FROM public.vouchers) <> 1 THEN RAISE EXCEPTION 'Exact-code scope failed'; END IF;
    UPDATE public.vouchers SET used_quantity = 1;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Public validation consumed voucher'; END IF;
    RAISE NOTICE 'PASS exact-code preview cannot consume usage';
END $$;
SELECT set_config('app.current_user_id', :'test_customer', true), set_config('app.current_user_type', 'employee', true),
       set_config('app.current_user_role', 'PHARMACIST', true), set_config('app.voucher_scope', 'read', true);
DO $$ DECLARE affected integer; BEGIN
    UPDATE public.vouchers SET status = 'INACTIVE';
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Pharmacist modified voucher'; END IF;
    RAISE NOTICE 'PASS pharmacist read-only access';
END $$;
SELECT set_config('app.current_user_role', 'STORE_MANAGER', true), set_config('app.voucher_scope', 'manage', true);
DO $$ BEGIN
    BEGIN
        UPDATE public.vouchers SET used_quantity = 1 WHERE id = current_setting('test.voucher_id')::integer;
        RAISE EXCEPTION 'Manager edited usage counter';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        TRUNCATE public.vouchers CASCADE;
        RAISE EXCEPTION 'Runtime truncated vouchers';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        PERFORM setval('public.vouchers_id_seq', 1);
        RAISE EXCEPTION 'Runtime reset voucher sequence';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS manager cannot edit counter, truncate or reset sequence';
END $$;
SELECT set_config('app.current_user_type', 'customer', true), set_config('app.current_user_role', 'CUSTOMER', true),
       set_config('app.order_operation', 'checkout', true), set_config('app.voucher_scope', 'checkout', true),
       set_config('app.voucher_order_id', :'test_order', true);
DO $$ BEGIN
    UPDATE public.vouchers SET used_quantity = used_quantity + 1 WHERE id = current_setting('test.voucher_id')::integer;
    IF (SELECT used_quantity FROM public.vouchers WHERE id = current_setting('test.voucher_id')::integer) <> 1 THEN
        RAISE EXCEPTION 'Bound checkout did not consume voucher'; END IF;
    BEGIN
        UPDATE public.vouchers SET discount_value = 1 WHERE id = current_setting('test.voucher_id')::integer;
        RAISE EXCEPTION 'Checkout changed voucher terms';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    PERFORM set_config('app.voucher_order_id', '', true);
    BEGIN
        UPDATE public.vouchers SET used_quantity = used_quantity + 1 WHERE id = current_setting('test.voucher_id')::integer;
        RAISE EXCEPTION 'Checkout consumed voucher without bound order';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS bound checkout consumes only counter; unbound consumption blocked';
END $$;
ROLLBACK;
