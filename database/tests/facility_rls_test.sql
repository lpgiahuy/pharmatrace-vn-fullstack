\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE app_user;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.facilities) THEN RAISE EXCEPTION 'Public facility reads failed'; END IF;
  BEGIN
    INSERT INTO public.facilities (facility_name, facility_type) VALUES ('Denied facility', 'PHARMACY');
    RAISE EXCEPTION 'Unscoped insert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    TRUNCATE public.facilities CASCADE;
    RAISE EXCEPTION 'TRUNCATE was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('app.facility_operation', 'manage', true), set_config('app.current_user_id', '1', true),
       set_config('app.current_user_type', 'employee', true), set_config('app.current_user_role', 'STORE_MANAGER', true);
DO $$ BEGIN
  BEGIN
    INSERT INTO public.facilities (facility_name, facility_type) VALUES ('Denied manager', 'PHARMACY');
    RAISE EXCEPTION 'Non-super admin insert was allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('app.current_user_role', 'SUPER_ADMIN', true);
INSERT INTO public.facilities (facility_name, facility_type) VALUES ('Facility RLS fixture', 'PHARMACY') RETURNING id AS facility_id \gset test_
UPDATE public.facilities SET facility_name = 'Facility RLS updated' WHERE id = :test_facility_id;
DELETE FROM public.facilities WHERE id = :test_facility_id;
RESET ROLE;
SET LOCAL ROLE auth_runtime;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM public.facilities) THEN RAISE EXCEPTION 'Auth runtime cannot read facilities'; END IF;
END $$;
ROLLBACK;
