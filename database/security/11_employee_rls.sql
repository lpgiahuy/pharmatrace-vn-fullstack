\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename='employees' AND policyname NOT IN ('auth_employee_select','auth_employee_update','employee_management','employee_facility_read')) THEN
 RAISE EXCEPTION 'Review existing employee policies before applying employee RLS'; END IF;
END $$;
REVOKE ALL ON public.employees FROM PUBLIC, app_user;
GRANT SELECT, DELETE ON public.employees TO app_user;
GRANT INSERT (full_name,email,password_hash,role,status,facility_id,created_at),
 UPDATE (full_name,email,password_hash,role,status,facility_id) ON public.employees TO app_user;
REVOKE ALL ON SEQUENCE public.employees_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.employees_id_seq TO app_user;
CREATE OR REPLACE FUNCTION public.employee_manager() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT current_setting('app.employee_operation',true)='manage'
 AND current_setting('app.current_user_type',true)='employee'
 AND current_setting('app.current_user_role',true)='SUPER_ADMIN'
 AND NULLIF(current_setting('app.current_user_id',true),'') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.employee_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_manager() TO app_user, auth_runtime;
DROP POLICY IF EXISTS employee_management ON public.employees;
CREATE POLICY employee_management ON public.employees FOR ALL TO app_user USING (public.employee_manager()) WITH CHECK (public.employee_manager());
DROP POLICY IF EXISTS employee_facility_read ON public.employees;
CREATE POLICY employee_facility_read ON public.employees FOR SELECT TO app_user USING (public.facility_manager());
CREATE OR REPLACE FUNCTION public.guard_employee_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
   IF OLD.id = NULLIF(current_setting('app.current_user_id',true),'')::integer THEN
     RAISE EXCEPTION 'Cannot delete your own account' USING ERRCODE='42501'; END IF;
   RETURN OLD;
 END IF;
 IF public.employee_manager() THEN
   IF OLD.id = NULLIF(current_setting('app.current_user_id',true),'')::integer AND NEW.status <> 'ACTIVE' THEN
     RAISE EXCEPTION 'Cannot deactivate your own account' USING ERRCODE='42501'; END IF;
 ELSE
   IF (to_jsonb(NEW) - ARRAY['full_name','email','password_hash']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['full_name','email','password_hash']) THEN
     RAISE EXCEPTION 'Profile updates cannot change employee permissions' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_employee_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_employee_write() TO app_user, auth_runtime;
DROP TRIGGER IF EXISTS employee_write_guard ON public.employees;
CREATE TRIGGER employee_write_guard BEFORE UPDATE OR DELETE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.guard_employee_write();
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;
COMMIT;
