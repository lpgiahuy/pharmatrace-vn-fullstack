-- Manual rollback ONLY for the pre-auth baseline where account RLS was disabled.
-- Never include this rollback script in master initialization.
-- Restores broad baseline visibility; never use as an automatic error handler.
\set ON_ERROR_STOP on
\if :{?auth_rls_rollback}
\else
    \echo 'Explicit auth_rls_rollback=true is required; read database/README.md (Auth RLS rollout) first.'
    DO $$ BEGIN RAISE EXCEPTION 'auth_rls_rollback=true is required'; END $$;
\endif
\if :auth_rls_rollback
BEGIN;
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('customers', 'employees')
        AND policyname NOT IN ('auth_customer_select', 'auth_customer_update',
            'auth_customer_register', 'auth_employee_select', 'auth_employee_update')) THEN
        RAISE EXCEPTION 'Other account policies exist; rollback needs manual review';
    END IF;
END
$$;
ALTER TABLE public.customers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS auth_customer_select ON public.customers;
DROP POLICY IF EXISTS auth_customer_update ON public.customers;
DROP POLICY IF EXISTS auth_customer_register ON public.customers;
DROP POLICY IF EXISTS auth_employee_select ON public.employees;
DROP POLICY IF EXISTS auth_employee_update ON public.employees;
-- Keep the non-login role for dependent grants; the backend flag must be false.
COMMIT;
\else
    \echo 'Auth RLS rollback skipped.'
\endif
