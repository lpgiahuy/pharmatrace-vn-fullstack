\set ON_ERROR_STOP on
BEGIN;
INSERT INTO facilities (facility_name,facility_type) VALUES ('Scope fixture A','PHARMACY') RETURNING id AS id \gset a_
INSERT INTO facilities (facility_name,facility_type) VALUES ('Scope fixture B','PHARMACY') RETURNING id AS id \gset b_
INSERT INTO employees (full_name,email,role,status,facility_id) VALUES ('Staff A','scope-a@example.test','PHARMACIST','ACTIVE',:a_id) RETURNING id AS id \gset e_
INSERT INTO employees (full_name,email,role,status,facility_id) VALUES ('Staff B','scope-b@example.test','PHARMACIST','ACTIVE',:b_id);
SET LOCAL ROLE app_user;
SELECT set_config('app.employee_operation','manage',true),set_config('app.current_user_type','employee',true),set_config('app.current_user_role','STORE_MANAGER',true),set_config('app.current_user_id','987654',true),set_config('app.current_unit_id',:'a_id',true);
DO $$ DECLARE n integer; BEGIN
 IF (SELECT count(*) FROM employees WHERE email IN ('scope-a@example.test','scope-b@example.test')) <> 1 THEN RAISE EXCEPTION 'Cross-facility read'; END IF;
 UPDATE employees SET full_name='Allowed update' WHERE email='scope-a@example.test'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>1 THEN RAISE EXCEPTION 'Own staff update denied'; END IF;
 UPDATE employees SET full_name='Denied update' WHERE email='scope-b@example.test'; GET DIAGNOSTICS n=ROW_COUNT; IF n<>0 THEN RAISE EXCEPTION 'Cross-facility update allowed'; END IF;
 BEGIN UPDATE employees SET role='SUPER_ADMIN' WHERE email='scope-a@example.test'; RAISE EXCEPTION 'Privilege escalation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE employees SET facility_id=NULL WHERE email='scope-a@example.test'; RAISE EXCEPTION 'Facility reassignment allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
