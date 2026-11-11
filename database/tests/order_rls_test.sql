\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.customers (full_name) VALUES ('Order RLS A') RETURNING id AS a \gset test_
INSERT INTO public.customers (full_name) VALUES ('Order RLS B') RETURNING id AS b \gset test_
INSERT INTO public.facilities (facility_name, facility_type) VALUES ('Order RLS export', 'PHARMACY') RETURNING id AS unit \gset test_
INSERT INTO public.facilities (facility_name, facility_type) VALUES ('Order RLS source', 'PHARMACY') RETURNING id AS source \gset test_
INSERT INTO public.orders (order_code, customer_id, export_facility_id, order_status)
VALUES (format('RLS-A-%s', txid_current()), :test_a, :test_unit, 'PENDING') RETURNING id AS own \gset test_
INSERT INTO public.orders (order_code, customer_id, export_facility_id, order_status)
VALUES (format('RLS-B-%s', txid_current()), :test_b, :test_source, 'PENDING') RETURNING id AS other \gset test_
INSERT INTO public.order_items (order_id, quantity) VALUES (:test_own, 1), (:test_other, 1);
INSERT INTO public.internal_transfers (transfer_code, order_id, from_facility_id, to_facility_id)
VALUES (format('RLS-T-%s', txid_current()), :test_own, :test_source, :test_unit);
SELECT set_config('test.order_own', :'test_own', true), set_config('test.order_other', :'test_other', true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id', '', true), set_config('app.current_user_type', '', true),
       set_config('app.current_user_role', '', true), set_config('app.current_unit_id', '', true), set_config('app.order_operation', '', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.orders) OR EXISTS (SELECT FROM public.order_items)
        OR EXISTS (SELECT FROM public.shipments) OR EXISTS (SELECT FROM public.internal_transfers)
        OR EXISTS (SELECT FROM public.loyalty_point_logs) THEN RAISE EXCEPTION 'Missing context exposed order data'; END IF;
    RAISE NOTICE 'PASS missing context hides order tables';
END $$;
SELECT set_config('app.current_user_id', :'test_a', true), set_config('app.current_user_type', 'customer', true),
       set_config('app.current_user_role', 'CUSTOMER', true), set_config('app.order_operation', 'cancel', true);
DO $$ DECLARE affected integer; BEGIN
    IF NOT EXISTS (SELECT FROM public.orders WHERE id = current_setting('test.order_own')::integer)
        OR EXISTS (SELECT FROM public.orders WHERE id = current_setting('test.order_other')::integer) THEN
        RAISE EXCEPTION 'Order ownership visibility failed'; END IF;
    UPDATE public.orders SET order_status = 'CANCELLED' WHERE id = current_setting('test.order_other')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Foreign cancellation allowed'; END IF;
    BEGIN
        UPDATE public.orders SET payment_status = 'PAID' WHERE id = current_setting('test.order_own')::integer;
        RAISE EXCEPTION 'Customer changed payment';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        UPDATE public.orders SET total_amount = 1 WHERE id = current_setting('test.order_own')::integer;
        RAISE EXCEPTION 'Customer changed total';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    INSERT INTO public.order_cancellation_reasons (order_id, customer_id, reason_code)
    SELECT id, customer_id, 'CHANGED_MIND' FROM public.orders WHERE id = current_setting('test.order_own')::integer;
    UPDATE public.orders SET order_status = 'CANCELLED' WHERE id = current_setting('test.order_own')::integer;
    BEGIN
        DELETE FROM public.orders;
        RAISE EXCEPTION 'Runtime deleted orders';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        TRUNCATE public.orders CASCADE;
        RAISE EXCEPTION 'Runtime truncated orders';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS ownership, cancellation, protected fields and destructive privilege checks';
END $$;
SELECT set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', 'WAREHOUSE_STAFF', true),
       set_config('app.current_unit_id', :'test_source', true), set_config('app.order_operation', 'dispatch', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.orders WHERE id = current_setting('test.order_own')::integer) THEN
        RAISE EXCEPTION 'Source warehouse read destination order'; END IF;
    IF NOT EXISTS (SELECT FROM public.internal_transfers WHERE order_id = current_setting('test.order_own')::integer) THEN
        RAISE EXCEPTION 'Source warehouse cannot read its transfer'; END IF;
    IF NOT EXISTS (SELECT FROM public.transfer_order_state(current_setting('test.order_own')::integer)) THEN
        RAISE EXCEPTION 'Source warehouse cannot read workflow state'; END IF;
    BEGIN
        DELETE FROM public.loyalty_point_logs;
        RAISE EXCEPTION 'Runtime deleted point ledger';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS transfer projection without order access and append-only ledger';
END $$;
ROLLBACK;
