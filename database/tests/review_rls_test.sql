\set ON_ERROR_STOP on
BEGIN;
INSERT INTO public.customers (full_name, email)
VALUES ('Review RLS A', format('review-a-%s@example.test', txid_current())) RETURNING id AS a \gset review_
INSERT INTO public.customers (full_name, email)
VALUES ('Review RLS B', format('review-b-%s@example.test', txid_current())) RETURNING id AS b \gset review_
INSERT INTO public.medicines (medicine_name, unit_price)
VALUES ('Review RLS fixture', 10) RETURNING id AS medicine \gset review_
INSERT INTO public.reviews (customer_id, medicine_id, rating_stars, status, helpful_count)
VALUES (:review_a, :review_medicine, 5, 'HIDDEN', 0) RETURNING id AS own \gset review_
INSERT INTO public.reviews (customer_id, medicine_id, rating_stars, status, helpful_count)
VALUES (:review_b, :review_medicine, 5, 'HIDDEN', 0) RETURNING id AS foreign \gset review_
INSERT INTO public.reviews (customer_id, medicine_id, rating_stars, status, helpful_count)
VALUES (:review_b, :review_medicine, 5, 'APPROVED', 0);
SELECT set_config('test.review_medicine', :'review_medicine', true),
       set_config('test.review_own', :'review_own', true), set_config('test.review_foreign', :'review_foreign', true);
SET LOCAL ROLE app_user;
SELECT set_config('app.review_scope', '', true), set_config('app.current_user_id', '', true),
       set_config('app.current_user_type', '', true), set_config('app.current_user_role', '', true);
DO $$ BEGIN
    IF (SELECT count(*) FROM public.reviews WHERE medicine_id = current_setting('test.review_medicine')::integer) <> 1 THEN
        RAISE EXCEPTION 'Public review visibility failed';
    END IF;
    IF EXISTS (SELECT FROM public.moderation_reports) OR EXISTS (SELECT FROM public.moderation_audit_logs) THEN
        RAISE EXCEPTION 'Anonymous request exposed moderation data';
    END IF;
    RAISE NOTICE 'PASS public sees approved reviews only';
END $$;
SELECT set_config('app.review_scope', 'customer', true), set_config('app.current_user_id', :'review_a', true),
       set_config('app.current_user_type', 'customer', true), set_config('app.current_user_role', 'CUSTOMER', true);
DO $$ DECLARE affected integer; BEGIN
    IF (SELECT count(*) FROM public.reviews WHERE medicine_id = current_setting('test.review_medicine')::integer) <> 2 THEN
        RAISE EXCEPTION 'Customer ownership visibility failed';
    END IF;
    UPDATE public.reviews SET comment = 'Own edit' WHERE id = current_setting('test.review_own')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 1 THEN RAISE EXCEPTION 'Own edit denied'; END IF;
    DELETE FROM public.reviews WHERE id = current_setting('test.review_foreign')::integer;
    GET DIAGNOSTICS affected = ROW_COUNT;
    IF affected <> 0 THEN RAISE EXCEPTION 'Foreign delete allowed'; END IF;
    BEGIN
        UPDATE public.reviews SET status = 'APPROVED' WHERE id = current_setting('test.review_own')::integer;
        RAISE EXCEPTION 'Customer self-approval allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        UPDATE public.reviews SET admin_reply = 'Forged reply' WHERE id = current_setting('test.review_own')::integer;
        RAISE EXCEPTION 'Customer staff reply allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        INSERT INTO public.reviews (customer_id, medicine_id, rating_stars, status, is_verified_purchase, helpful_count)
        VALUES (current_setting('app.current_user_id')::integer, current_setting('test.review_medicine')::integer, 5, 'APPROVED', true, 0);
        RAISE EXCEPTION 'Review without purchase allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS own edit; foreign delete, self-approval, staff reply and unpurchased insert blocked';
END $$;
SELECT set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', 'PHARMACIST', true);
DO $$ BEGIN
    IF EXISTS (SELECT FROM public.reviews WHERE id = current_setting('test.review_own')::integer) THEN
        RAISE EXCEPTION 'Employee matched customer ownership';
    END IF;
END $$;
SELECT set_config('app.review_scope', 'staff', true);
DO $$ BEGIN
    UPDATE public.reviews SET admin_reply = 'Staff reply' WHERE id = current_setting('test.review_own')::integer;
    BEGIN
        UPDATE public.reviews SET status = 'APPROVED' WHERE id = current_setting('test.review_own')::integer;
        RAISE EXCEPTION 'Staff moderation allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        TRUNCATE public.moderation_audit_logs;
        RAISE EXCEPTION 'Audit truncate allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    BEGIN
        DELETE FROM public.moderation_audit_logs;
        RAISE EXCEPTION 'Audit delete allowed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    RAISE NOTICE 'PASS employee type isolation, staff reply, moderation and audit protections';
END $$;
ROLLBACK;
