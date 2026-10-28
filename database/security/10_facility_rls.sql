\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public' AND tablename = 'facilities'
        AND policyname NOT IN ('facility_read', 'facility_insert', 'facility_update', 'facility_delete')) THEN
        RAISE EXCEPTION 'Existing facility policies need manual review';
    END IF;
END $$;
REVOKE ALL ON public.facilities FROM PUBLIC, app_user;
GRANT SELECT ON public.facilities TO app_user, auth_runtime;
GRANT INSERT (facility_name, facility_type, address, phone_number, email, latitude, longitude, created_at),
      UPDATE (facility_name, facility_type, address, phone_number, email, latitude, longitude), DELETE
    ON public.facilities TO app_user;
REVOKE ALL ON SEQUENCE public.facilities_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.facilities_id_seq TO app_user;

CREATE OR REPLACE FUNCTION public.facility_manager() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT current_setting('app.facility_operation', true) = 'manage'
      AND current_setting('app.current_user_type', true) = 'employee'
      AND current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
      AND NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.facility_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.facility_manager() TO app_user;
DROP POLICY IF EXISTS facility_read ON public.facilities;
CREATE POLICY facility_read ON public.facilities FOR SELECT TO app_user, auth_runtime USING (true);
DROP POLICY IF EXISTS facility_insert ON public.facilities;
CREATE POLICY facility_insert ON public.facilities FOR INSERT TO app_user WITH CHECK (public.facility_manager());
DROP POLICY IF EXISTS facility_update ON public.facilities;
CREATE POLICY facility_update ON public.facilities FOR UPDATE TO app_user USING (public.facility_manager()) WITH CHECK (public.facility_manager());
DROP POLICY IF EXISTS facility_delete ON public.facilities;
CREATE POLICY facility_delete ON public.facilities FOR DELETE TO app_user USING (public.facility_manager());
ALTER TABLE public.facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facilities FORCE ROW LEVEL SECURITY;
COMMIT;

