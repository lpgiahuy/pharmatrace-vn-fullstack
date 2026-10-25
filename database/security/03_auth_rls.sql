\set ON_ERROR_STOP on
\if :{?auth_rls_activate}
\else
    \set auth_rls_activate false
\endif
BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('customers', 'employees')
        AND (c.relrowsecurity OR c.relforcerowsecurity)
        AND NOT EXISTS (SELECT FROM pg_policy p WHERE p.polrelid = c.oid
            AND p.polname IN ('auth_customer_select', 'auth_employee_select'))) THEN
        RAISE EXCEPTION 'Account RLS was already configured outside this migration';
    END IF;
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('customers', 'employees')
        AND policyname NOT IN ('auth_customer_select', 'auth_customer_update',
            'auth_customer_register', 'auth_employee_select', 'auth_employee_update')) THEN
        RAISE EXCEPTION 'Existing account policies need manual review before auth RLS';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'auth_runtime') THEN
        CREATE ROLE auth_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'auth_runtime'
        AND (rolsuper OR rolbypassrls OR rolcanlogin OR rolcreatedb OR rolcreaterole OR rolreplication))
        OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
            WHERE r.rolname = 'auth_runtime') THEN
        RAISE EXCEPTION 'auth_runtime must be an unprivileged, non-login role with no parent roles';
    END IF;
END
$$;

GRANT auth_runtime TO app_user;
GRANT USAGE ON SCHEMA public TO auth_runtime;
GRANT SELECT ON public.customers, public.employees, public.facilities TO auth_runtime;
GRANT UPDATE (full_name, email, default_address, password_hash) ON public.customers TO auth_runtime;
GRANT UPDATE (full_name, email, password_hash) ON public.employees TO auth_runtime;
GRANT INSERT (full_name, phone_number, email, password_hash, default_address) ON public.customers TO auth_runtime;
GRANT USAGE ON SEQUENCE public.customers_id_seq TO auth_runtime;

DO $$
BEGIN
    IF has_column_privilege('auth_runtime', 'public.employees', 'role', 'UPDATE')
        OR has_column_privilege('auth_runtime', 'public.employees', 'facility_id', 'UPDATE')
        OR has_column_privilege('auth_runtime', 'public.customers', 'reward_points', 'UPDATE')
        OR has_column_privilege('auth_runtime', 'public.customers', 'id', 'INSERT')
        OR has_table_privilege('auth_runtime', 'public.employees', 'INSERT, DELETE, TRUNCATE')
        OR has_table_privilege('auth_runtime', 'public.customers', 'DELETE, TRUNCATE') THEN
        RAISE EXCEPTION 'auth_runtime has broader account privileges than this migration permits';
    END IF;
END
$$;

DROP POLICY IF EXISTS auth_customer_select ON public.customers;
CREATE POLICY auth_customer_select ON public.customers FOR SELECT TO auth_runtime USING (
    (current_setting('app.current_user_type', true) = 'customer'
        AND id = NULLIF(current_setting('app.current_user_id', true), '')::integer)
    OR (current_setting('app.auth_operation', true) = 'customer_login'
        AND NULLIF(current_setting('app.auth_identifier', true), '') IS NOT NULL
        AND (phone_number = current_setting('app.auth_identifier', true)
            OR lower(email) = current_setting('app.auth_identifier', true)))
    OR (current_setting('app.auth_operation', true) = 'register'
        AND phone_number = NULLIF(current_setting('app.auth_identifier', true), ''))
);
DROP POLICY IF EXISTS auth_customer_update ON public.customers;
CREATE POLICY auth_customer_update ON public.customers FOR UPDATE TO auth_runtime
USING (current_setting('app.current_user_type', true) = 'customer'
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::integer)
WITH CHECK (current_setting('app.current_user_type', true) = 'customer'
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::integer);
DROP POLICY IF EXISTS auth_customer_register ON public.customers;
CREATE POLICY auth_customer_register ON public.customers FOR INSERT TO auth_runtime
WITH CHECK (current_setting('app.auth_operation', true) = 'register'
    AND phone_number = NULLIF(current_setting('app.auth_identifier', true), '')
    AND membership_tier = 'BRONZE' AND reward_points = 0 AND status = 'ACTIVE');

DROP POLICY IF EXISTS auth_employee_select ON public.employees;
CREATE POLICY auth_employee_select ON public.employees FOR SELECT TO auth_runtime USING (
    (current_setting('app.current_user_type', true) = 'employee'
        AND id = NULLIF(current_setting('app.current_user_id', true), '')::integer)
    OR (current_setting('app.auth_operation', true) = 'employee_login'
        AND lower(email) = NULLIF(current_setting('app.auth_identifier', true), ''))
);
DROP POLICY IF EXISTS auth_employee_update ON public.employees;
CREATE POLICY auth_employee_update ON public.employees FOR UPDATE TO auth_runtime
USING (current_setting('app.current_user_type', true) = 'employee'
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::integer)
WITH CHECK (current_setting('app.current_user_type', true) = 'employee'
    AND id = NULLIF(current_setting('app.current_user_id', true), '')::integer);

\if :auth_rls_activate
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees FORCE ROW LEVEL SECURITY;
\else
    \echo 'Auth role/policies prepared; account RLS enforcement is not enabled by this script.'
\endif
COMMIT;
