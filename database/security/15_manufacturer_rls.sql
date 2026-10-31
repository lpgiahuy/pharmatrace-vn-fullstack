\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='batches' AND column_name='legacy_manufacturer_facility_id') THEN
   RAISE EXCEPTION 'Upgrade the manufacturer schema before installing its policies';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.guard_employee_external_facility() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='UPDATE' AND NEW.facility_id IS NOT DISTINCT FROM OLD.facility_id THEN RETURN NEW; END IF;
 IF EXISTS (SELECT FROM public.facilities f WHERE f.id=NEW.facility_id AND f.facility_type IN ('MANUFACTURER','LEGACY_EXTERNAL')) THEN
   RAISE EXCEPTION 'Employees cannot be assigned to external manufacturers' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS employee_external_facility_guard ON public.employees;
CREATE TRIGGER employee_external_facility_guard BEFORE INSERT OR UPDATE OF facility_id ON public.employees
 FOR EACH ROW EXECUTE FUNCTION public.guard_employee_external_facility();
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename='manufacturers'
   AND policyname NOT IN ('manufacturer_read','manufacturer_write')) THEN
   RAISE EXCEPTION 'Existing manufacturer policies need manual review';
 END IF;
END $$;
REVOKE ALL ON public.manufacturers FROM PUBLIC, app_user;
GRANT SELECT ON public.manufacturers TO app_user;
GRANT INSERT (name, slug, country, business_registration_number, address, phone_number, email, logo_url, website, status),
 UPDATE (name, slug, country, business_registration_number, address, phone_number, email, logo_url, website, status)
 ON public.manufacturers TO app_user;
REVOKE ALL ON SEQUENCE public.manufacturers_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.manufacturers_id_seq TO app_user;
DROP POLICY IF EXISTS manufacturer_read ON public.manufacturers;
CREATE POLICY manufacturer_read ON public.manufacturers FOR SELECT TO app_user USING (
 current_setting('app.current_user_type',true)='employee' AND NULLIF(current_setting('app.current_user_id',true),'') IS NOT NULL
 AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST','WAREHOUSE_STAFF','WAREHOUSE_MANAGER','FACTORY_WAREHOUSE_STAFF'));
DROP POLICY IF EXISTS manufacturer_write ON public.manufacturers;
CREATE POLICY manufacturer_write ON public.manufacturers FOR ALL TO app_user USING (public.facility_manager()) WITH CHECK (public.facility_manager());
ALTER TABLE public.manufacturers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manufacturers FORCE ROW LEVEL SECURITY;
COMMIT;
