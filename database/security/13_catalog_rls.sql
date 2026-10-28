\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.catalog_manager() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT current_setting('app.catalog_operation',true)='manage'
 AND current_setting('app.current_user_type',true)='employee'
 AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER')
 AND NULLIF(current_setting('app.current_user_id',true),'') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.catalog_manager() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.catalog_manager() TO app_user;
DO $$
DECLARE t text; cols text; seq text;
BEGIN
 FOREACH t IN ARRAY ARRAY['medicines','categories','medicine_categories','packaging_variants'] LOOP
  IF EXISTS (SELECT FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname NOT IN ('catalog_read','catalog_write')) THEN
   RAISE EXCEPTION 'Review existing policies on %',t;
  END IF;
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user',t);
  EXECUTE format('GRANT SELECT, DELETE ON public.%I TO app_user',t);
  SELECT string_agg(format('%I',a.attname), ', ' ORDER BY a.attnum) INTO cols
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=t AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated='' AND a.attname <> 'id';
  EXECUTE format('GRANT INSERT (%s), UPDATE (%s) ON public.%I TO app_user',cols,cols,t);
  seq := NULL;
  IF t <> 'medicine_categories' THEN seq := pg_get_serial_sequence(format('public.%I', t),'id'); END IF;
  IF seq IS NOT NULL THEN
   EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, app_user',seq);
   EXECUTE format('GRANT USAGE ON SEQUENCE %s TO app_user',seq);
  END IF;
  EXECUTE format('DROP POLICY IF EXISTS catalog_read ON public.%I',t);
  EXECUTE format('CREATE POLICY catalog_read ON public.%I FOR SELECT TO app_user USING (true)',t);
  EXECUTE format('DROP POLICY IF EXISTS catalog_write ON public.%I',t);
  EXECUTE format('CREATE POLICY catalog_write ON public.%I FOR ALL TO app_user USING (public.catalog_manager()) WITH CHECK (public.catalog_manager())',t);
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
 END LOOP;
END $$;
COMMIT;
