\set ON_ERROR_STOP on
BEGIN;
INSERT INTO customers (full_name,phone_number) VALUES ('Customer RLS fixture','0999999912') RETURNING id AS id \gset c_
SET LOCAL ROLE auth_runtime;
SELECT set_config('app.current_user_type','customer',true), set_config('app.current_user_id', :'c_id',true);
UPDATE customers SET full_name='Updated own profile' WHERE id=:c_id;
DO $$ BEGIN
 IF (SELECT count(*) FROM customers) <> 1 THEN RAISE EXCEPTION 'Customer self scope failed'; END IF;
 BEGIN
 UPDATE customers SET reward_points=999;
 RAISE EXCEPTION 'Customer changed loyalty balance';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET LOCAL ROLE app_user;
SELECT set_config('app.current_user_id','',true),set_config('app.current_user_type','',true);
DO $$ BEGIN
 IF EXISTS (SELECT FROM customers) THEN RAISE EXCEPTION 'Unscoped customer disclosure'; END IF;
END $$;
ROLLBACK;
