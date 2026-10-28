\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE app_user;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM public.medicines) OR NOT EXISTS (SELECT FROM public.categories) THEN RAISE EXCEPTION 'Public catalog reads failed'; END IF;
 BEGIN INSERT INTO public.categories (category_name) VALUES ('Unauthorized'); RAISE EXCEPTION 'Unscoped write succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN TRUNCATE public.medicines CASCADE; RAISE EXCEPTION 'Truncate succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('app.catalog_operation','manage',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_id','1',true),set_config('app.current_user_role','PHARMACIST',true);
DO $$ BEGIN
 BEGIN INSERT INTO public.categories (category_name) VALUES ('Denied'); RAISE EXCEPTION 'Pharmacist write succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('app.current_user_role','STORE_MANAGER',true);
INSERT INTO public.categories (category_name) VALUES ('Catalog RLS fixture') RETURNING id AS id \gset c_
UPDATE public.categories SET description='Updated' WHERE id=:c_id;
DELETE FROM public.categories WHERE id=:c_id;
ROLLBACK;
