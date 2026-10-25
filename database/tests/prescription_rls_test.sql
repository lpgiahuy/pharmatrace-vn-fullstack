\set ON_ERROR_STOP on

BEGIN;

INSERT INTO public.orders (
    order_code,
    customer_id,
    export_facility_id,
    prescription_id,
    prescription_review_status,
    order_status
)
VALUES (
    format('RLS-TEST-%s', txid_current()),
    1,
    1,
    1,
    'PENDING_APPROVAL',
    'PENDING'
)
RETURNING id AS order_id \gset test_

INSERT INTO public.order_prescription_reviews (
    order_id,
    prescription_id,
    facility_id,
    status
)
VALUES (
    :test_order_id,
    1,
    1,
    'PENDING_APPROVAL'
)
RETURNING id AS review_id \gset test_

SELECT set_config('test.review_id', :'test_review_id', true);

SET LOCAL ROLE app_user;

SELECT set_config('app.current_user_id', '', true);
SELECT set_config('app.current_user_role', '', true);
SELECT set_config('app.current_user_type', '', true);
SELECT set_config('app.current_unit_id', '', true);

DO $$
DECLARE
    prescription_count integer;
    review_count integer;
BEGIN
    SELECT count(*) INTO prescription_count FROM public.prescriptions;
    SELECT count(*) INTO review_count FROM public.order_prescription_reviews;
    IF prescription_count <> 0 OR review_count <> 0 THEN
        RAISE EXCEPTION 'Fail-closed check failed: prescriptions=%, reviews=%', prescription_count, review_count;
    END IF;
    RAISE NOTICE 'PASS fail-closed context';
END
$$;

SELECT set_config('app.current_user_id', '1', true);
SELECT set_config('app.current_user_role', 'CUSTOMER', true);
SELECT set_config('app.current_user_type', 'customer', true);
SELECT set_config('app.current_unit_id', '', true);

DO $$
DECLARE
    own_count integer;
    foreign_count integer;
    review_count integer;
BEGIN
    SELECT count(*) INTO own_count FROM public.prescriptions WHERE id = 1 AND customer_id = 1;
    SELECT count(*) INTO foreign_count FROM public.prescriptions WHERE customer_id <> 1 OR customer_id IS NULL;
    SELECT count(*) INTO review_count
    FROM public.order_prescription_reviews
    WHERE id = current_setting('test.review_id')::integer;
    IF own_count <> 1 OR foreign_count <> 0 OR review_count <> 1 THEN
        RAISE EXCEPTION 'Customer 1 check failed: own=%, foreign=%, review=%', own_count, foreign_count, review_count;
    END IF;
    RAISE NOTICE 'PASS customer 1 owns prescription and linked review';
END
$$;

SELECT set_config('app.current_user_id', '2', true);
SELECT set_config('app.current_user_role', 'CUSTOMER', true);
SELECT set_config('app.current_user_type', 'customer', true);
SELECT set_config('app.current_unit_id', '', true);

DO $$
DECLARE
    prescription_count integer;
    review_count integer;
BEGIN
    SELECT count(*) INTO prescription_count FROM public.prescriptions WHERE id = 1;
    SELECT count(*) INTO review_count
    FROM public.order_prescription_reviews
    WHERE id = current_setting('test.review_id')::integer;
    IF prescription_count <> 0 OR review_count <> 0 THEN
        RAISE EXCEPTION 'Customer 2 isolation failed: prescription=%, review=%', prescription_count, review_count;
    END IF;
    RAISE NOTICE 'PASS customer 2 cannot read customer 1 data';
END
$$;

SELECT set_config('app.current_user_id', '13', true);
SELECT set_config('app.current_user_role', 'PHARMACIST', true);
SELECT set_config('app.current_user_type', 'employee', true);
SELECT set_config('app.current_unit_id', '1', true);

DO $$
DECLARE
    prescription_count integer;
    review_count integer;
BEGIN
    SELECT count(*) INTO prescription_count FROM public.prescriptions WHERE id = 1;
    SELECT count(*) INTO review_count
    FROM public.order_prescription_reviews
    WHERE id = current_setting('test.review_id')::integer;
    IF prescription_count <> 1 OR review_count <> 1 THEN
        RAISE EXCEPTION 'Facility 1 pharmacist check failed: prescription=%, review=%', prescription_count, review_count;
    END IF;
    RAISE NOTICE 'PASS facility 1 pharmacist can read assigned prescription';
END
$$;

SELECT set_config('app.current_user_id', '13', true);
SELECT set_config('app.current_user_role', 'PHARMACIST', true);
SELECT set_config('app.current_user_type', 'employee', true);
SELECT set_config('app.current_unit_id', '2', true);

DO $$
DECLARE
    prescription_count integer;
    review_count integer;
BEGIN
    SELECT count(*) INTO prescription_count FROM public.prescriptions WHERE id = 1;
    SELECT count(*) INTO review_count
    FROM public.order_prescription_reviews
    WHERE id = current_setting('test.review_id')::integer;
    IF prescription_count <> 0 OR review_count <> 0 THEN
        RAISE EXCEPTION 'Facility 2 isolation failed: prescription=%, review=%', prescription_count, review_count;
    END IF;
    RAISE NOTICE 'PASS facility 2 cannot read facility 1 prescription';
END
$$;

ROLLBACK;
