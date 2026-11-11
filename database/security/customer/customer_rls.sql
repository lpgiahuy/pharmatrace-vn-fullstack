\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename='customers' AND policyname NOT IN
 ('auth_customer_select','auth_customer_update','auth_customer_register','customer_staff_read','customer_status','customer_points')) THEN
 RAISE EXCEPTION 'Review existing customer policies'; END IF;
END $$;
REVOKE ALL ON public.customers FROM PUBLIC, app_user;
GRANT SELECT ON public.customers TO app_user;
GRANT UPDATE (full_name,email,default_address,password_hash,status,reward_points) ON public.customers TO app_user;
REVOKE ALL ON SEQUENCE public.customers_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.customers_id_seq TO app_user;
CREATE OR REPLACE FUNCTION public.customer_staff(target integer) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce(current_setting('app.current_user_type',true),'') <> 'employee'
 OR NULLIF(current_setting('app.current_user_id',true),'') IS NULL
 OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST') THEN RETURN false; END IF;
 IF current_setting('app.current_user_role',true)='SUPER_ADMIN' THEN RETURN true; END IF;
 RETURN EXISTS (SELECT FROM public.orders o WHERE o.customer_id=target AND public.order_staff(o.export_facility_id));
END $$;
CREATE OR REPLACE FUNCTION public.customer_points_access(target integer) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce(current_setting('app.order_operation',true),'') NOT IN ('checkout','cancel','status','prescription','loyalty') THEN RETURN false; END IF;
 RETURN public.order_operation_allowed() AND (public.order_customer(target) OR EXISTS (SELECT FROM public.orders o WHERE o.customer_id=target));
END $$;
REVOKE ALL ON FUNCTION public.customer_staff(integer),public.customer_points_access(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_staff(integer),public.customer_points_access(integer) TO app_user,auth_runtime;
DROP POLICY IF EXISTS customer_staff_read ON public.customers;
CREATE POLICY customer_staff_read ON public.customers FOR SELECT TO app_user USING (
 (current_setting('app.order_operation',true) IS NOT NULL AND public.customer_staff(id))
 OR public.customer_points_access(id)
 OR (current_setting('app.review_scope',true)='moderator' AND current_setting('app.current_user_type',true)='employee' AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','ADMIN') AND EXISTS (SELECT FROM public.reviews r WHERE r.customer_id=customers.id))
 OR (current_setting('app.review_scope',true)='staff' AND public.customer_staff(id) AND EXISTS (SELECT FROM public.reviews r WHERE r.customer_id=customers.id)));
DROP POLICY IF EXISTS customer_status ON public.customers;
CREATE POLICY customer_status ON public.customers FOR UPDATE TO app_user USING (
 current_setting('app.customer_operation',true)='manage' AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER') AND public.customer_staff(id)) WITH CHECK (
 current_setting('app.customer_operation',true)='manage' AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER') AND public.customer_staff(id));
DROP POLICY IF EXISTS customer_points ON public.customers;
CREATE POLICY customer_points ON public.customers FOR UPDATE TO app_user USING (public.customer_points_access(id)) WITH CHECK (public.customer_points_access(id));
CREATE OR REPLACE FUNCTION public.guard_customer_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE allowed text[];
BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN RETURN NEW; END IF;
 IF current_setting('app.customer_operation',true)='manage' AND public.customer_staff(OLD.id) THEN
   allowed := ARRAY['status'];
   IF NEW.status NOT IN ('ACTIVE','INACTIVE','BANNED') OR NEW.status IS NULL THEN RAISE EXCEPTION 'Invalid customer status' USING ERRCODE='42501'; END IF;
 ELSIF public.customer_points_access(OLD.id) THEN allowed := ARRAY['reward_points'];
 ELSE allowed := ARRAY['full_name','email','default_address','password_hash']; END IF;
 IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN
   RAISE EXCEPTION 'Protected customer fields cannot be changed in this scope' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_customer_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_customer_write() TO app_user,auth_runtime;
DROP TRIGGER IF EXISTS customer_write_guard ON public.customers;
CREATE TRIGGER customer_write_guard BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.guard_customer_write();
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
COMMIT;
