\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename='employees' AND policyname='employee_management')
 OR NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename='customers' AND policyname='customer_status') THEN
   RAISE EXCEPTION 'Employee and customer RLS policies must be installed first';
 END IF;
END $$;
DROP POLICY customer_status ON public.customers;
CREATE POLICY customer_status ON public.customers FOR UPDATE TO app_user
 USING (current_setting('app.customer_operation',true)='manage'
   AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER') AND public.customer_staff(id))
 WITH CHECK (current_setting('app.customer_operation',true)='manage'
   AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER') AND public.customer_staff(id));
CREATE OR REPLACE FUNCTION public.employee_facility_scope(unit integer, employee_role text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
 SELECT current_setting('app.employee_operation',true)='manage'
 AND current_setting('app.current_user_type',true)='employee'
 AND current_setting('app.current_user_role',true)='STORE_MANAGER'
 AND NULLIF(current_setting('app.current_user_id',true),'') IS NOT NULL
 AND unit = NULLIF(current_setting('app.current_unit_id',true),'')::integer
 AND employee_role IN ('PHARMACIST','WAREHOUSE_STAFF')
$$;
REVOKE ALL ON FUNCTION public.employee_facility_scope(integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.employee_facility_scope(integer,text) TO app_user, auth_runtime;
DROP POLICY IF EXISTS employee_facility_management ON public.employees;
CREATE POLICY employee_facility_management ON public.employees FOR ALL TO app_user
 USING (public.employee_facility_scope(facility_id,role)) WITH CHECK (public.employee_facility_scope(facility_id,role));
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
 IF public.employee_manager() OR public.employee_facility_scope(OLD.facility_id,OLD.role) THEN
   IF OLD.id = NULLIF(current_setting('app.current_user_id',true),'')::integer AND NEW.status <> 'ACTIVE' THEN
     RAISE EXCEPTION 'Cannot deactivate your own account' USING ERRCODE='42501'; END IF;
 ELSE
   IF (to_jsonb(NEW) - ARRAY['full_name','email','password_hash']) IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['full_name','email','password_hash']) THEN
     RAISE EXCEPTION 'Profile updates cannot change employee permissions' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
COMMIT;
