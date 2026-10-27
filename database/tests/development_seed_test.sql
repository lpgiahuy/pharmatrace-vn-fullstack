\set ON_ERROR_STOP on

-- Run as postgres on a freshly initialized development database, before other tests.
BEGIN;

DO $$
DECLARE
    fixture RECORD;
    actual_count BIGINT;
    sequence_name TEXT;
    maximum_id BIGINT;
    sequence_value BIGINT;
BEGIN
    FOR fixture IN SELECT * FROM (VALUES
        ('facilities', 250), ('employees', 5), ('customers', 7),
        ('prescriptions', 4), ('orders', 46), ('articles', 2),
        ('manufacturers', 371), ('medicines', 543), ('batches', 24),
        ('packaging_variants', 624), ('cart_items', 8), ('categories', 38),
        ('customer_wishlists', 14), ('medicine_boxes', 9844),
        ('internal_transfers', 1), ('inventories', 45), ('inventory_logs', 3),
        ('loyalty_point_logs', 6), ('medicine_categories', 670), ('reviews', 6),
        ('moderation_audit_logs', 24), ('moderation_reports', 6),
        ('order_items', 51), ('order_prescription_reviews', 2),
        ('qr_scan_logs', 105), ('shipments', 5), ('vouchers', 3),
        ('purchase_orders', 0), ('accounts_payable', 0), ('accounts_receivable', 0),
        ('cashbook_logs', 0), ('sscc_cartons', 0), ('fraud_alerts', 0),
        ('purchase_order_items', 0)
    ) AS expected(table_name, row_count)
    LOOP
        EXECUTE format('SELECT count(*) FROM public.%I', fixture.table_name) INTO actual_count;
        IF actual_count <> fixture.row_count THEN
            RAISE EXCEPTION 'Seed row count mismatch for %: expected %, got %',
                fixture.table_name, fixture.row_count, actual_count;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS all 34 application table row counts';

    IF to_regclass('public._prisma_migrations') IS NOT NULL
        OR to_regclass('public.medicines_backup_before_m2m') IS NOT NULL
        OR to_regclass('public.medicines_category_id_backup_v2') IS NOT NULL THEN
        RAISE EXCEPTION 'Development seed must not restore migration history or backup tables';
    END IF;

    IF (SELECT count(*) FROM public.loyalty_point_logs WHERE transaction_type = 'REDEEM') <> 4
        OR (SELECT count(*) FROM public.loyalty_point_logs WHERE transaction_type = 'REDEEM_REVERSAL') <> 2 THEN
        RAISE EXCEPTION 'Redemption/reversal seed semantics changed';
    END IF;
    RAISE NOTICE 'PASS excluded tables and loyalty transaction types';

    IF EXISTS (SELECT FROM public.orders
        WHERE order_status NOT IN ('PENDING', 'WAITING_INTERNAL_TRANSFER', 'WAITING_TRANSFER',
            'PROCESSING', 'SHIPPING', 'IN_TRANSIT', 'COMPLETED', 'DELIVERED',
            'CANCELLED', 'CANCELED', 'RETURNED', 'PARTIALLY_RETURNED')
            OR payment_status NOT IN ('UNPAID', 'PAID', 'REFUNDED')
            OR payment_method NOT IN ('COD', 'BANK_TRANSFER', 'E_WALLET')) THEN
        RAISE EXCEPTION 'Order and payment values must use uppercase English values';
    END IF;
    RAISE NOTICE 'PASS English order and payment values';

    FOR fixture IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (is_identity = 'YES' OR column_default LIKE 'nextval(%')
    LOOP
        sequence_name := pg_get_serial_sequence(format('public.%I', fixture.table_name), fixture.column_name);
        EXECUTE format('SELECT max(%I) FROM public.%I', fixture.column_name, fixture.table_name) INTO maximum_id;
        EXECUTE format('SELECT last_value FROM %s', sequence_name) INTO sequence_value;
        IF maximum_id > sequence_value THEN
            RAISE EXCEPTION 'Sequence % is behind imported IDs', sequence_name;
        END IF;
    END LOOP;
    RAISE NOTICE 'PASS sequences cover all imported IDs';

    IF EXISTS (SELECT 1 FROM public.customers WHERE email !~ '^customer[0-9]+@example\.test$')
        OR EXISTS (SELECT 1 FROM public.employees WHERE email !~ '^employee[0-9]+@example\.test$')
        OR EXISTS (SELECT 1 FROM public.prescriptions WHERE prescription_image_url NOT LIKE 'https://example.invalid/demo-prescriptions/%')
        OR EXISTS (SELECT 1 FROM public.qr_scan_logs WHERE ip_address IS NOT NULL AND ip_address NOT LIKE '192.0.2.%') THEN
        RAISE EXCEPTION 'Unexpected personal contact, image, or IP values in development fixtures';
    END IF;
    RAISE NOTICE 'PASS synthetic contact/image/IP fixtures';

    IF has_table_privilege('app_user', 'public.order_prescription_reviews', 'DELETE')
        OR has_table_privilege('app_user', 'public.order_prescription_reviews', 'TRUNCATE')
        OR has_sequence_privilege('app_user', 'public.order_prescription_reviews_id_seq', 'UPDATE') THEN
        RAISE EXCEPTION 'Review privileges inherited broader access than intended';
    END IF;
    IF NOT has_table_privilege('app_user', 'public.order_prescription_reviews', 'SELECT')
        OR NOT has_table_privilege('app_user', 'public.order_prescription_reviews', 'INSERT')
        OR NOT has_table_privilege('app_user', 'public.order_prescription_reviews', 'UPDATE') THEN
        RAISE EXCEPTION 'Review workflow privileges are missing';
    END IF;
    RAISE NOTICE 'PASS restricted review grants';
END
$$;

ROLLBACK;
