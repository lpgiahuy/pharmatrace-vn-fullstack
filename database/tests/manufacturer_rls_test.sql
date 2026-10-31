\set ON_ERROR_STOP on
BEGIN;
SELECT id FROM public.manufacturers ORDER BY id LIMIT 1 \gset manufacturer_
INSERT INTO public.facilities (facility_name, facility_type) VALUES ('Test external manufacturer', 'LEGACY_EXTERNAL') RETURNING id \gset external_
SELECT set_config('test.external_id', :'external_id', true);
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id','',true), set_config('app.current_user_type','',true),
 set_config('app.current_user_role','',true), set_config('app.facility_operation','',true);
DO $$ BEGIN
 IF EXISTS (SELECT FROM public.manufacturers) THEN RAISE EXCEPTION 'Anonymous manufacturer rows exposed'; END IF;
END $$;
SELECT set_config('test.manufacturer_id', :'manufacturer_id',true);
SELECT set_config('app.current_user_id','1',true), set_config('app.current_user_type','employee',true),
 set_config('app.current_user_role','STORE_MANAGER',true), set_config('app.facility_operation','manage',true);
DO $$ DECLARE n integer; BEGIN
 IF NOT EXISTS (SELECT FROM public.manufacturers) THEN RAISE EXCEPTION 'Staff cannot read manufacturers'; END IF;
 UPDATE public.manufacturers SET status='INACTIVE' WHERE id=current_setting('test.manufacturer_id',true)::int;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'Manager modified manufacturer'; END IF;
END $$;
SELECT set_config('app.current_user_role','SUPER_ADMIN',true), set_config('test.manufacturer_id', :'manufacturer_id',true);
DO $$ DECLARE n integer; BEGIN
 UPDATE public.manufacturers SET status=status WHERE id=current_setting('test.manufacturer_id')::int;
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Administrator cannot manage manufacturer'; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE employee_id int; external_id int; BEGIN
 SELECT id INTO employee_id FROM public.employees LIMIT 1;
 SELECT current_setting('test.external_id')::int INTO external_id;
 IF employee_id IS NULL OR external_id IS NULL THEN RAISE EXCEPTION 'Test fixture unavailable'; END IF;
 BEGIN
  UPDATE public.employees SET facility_id=external_id WHERE id=employee_id;
  RAISE EXCEPTION 'External manufacturer assigned to employee';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
ROLLBACK;

