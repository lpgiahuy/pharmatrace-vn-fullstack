\set ON_ERROR_STOP on
BEGIN;
INSERT INTO employees (full_name,email,role,status) VALUES ('Employee RLS A','employee-rls-a@example.test','PHARMACIST','ACTIVE') RETURNING id AS id \gset a_
INSERT INTO employees (full_name,email,role,status) VALUES ('Employee RLS B','employee-rls-b@example.test','PHARMACIST','ACTIVE');
SET LOCAL ROLE app_user;
DO $$ BEGIN
 IF EXISTS (SELECT FROM employees) THEN RAISE EXCEPTION 'Unscoped employee disclosure'; END IF;
END $$;
SELECT set_config('app.current_user_type','employee',true), set_config('app.current_user_id', :'a_id',true), set_config('app.current_user_role','PHARMACIST',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM employees) <> 1 THEN RAISE EXCEPTION 'Self access failed'; END IF;
 UPDATE employees SET full_name='Employee RLS updated';
 BEGIN
 UPDATE employees SET role='SUPER_ADMIN';
 RAISE EXCEPTION 'Profile escalated privileges';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 TRUNCATE employees CASCADE;
 RAISE EXCEPTION 'Runtime truncated employees';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE auth_runtime;
UPDATE employees SET full_name='Auth runtime profile';
ROLLBACK;
