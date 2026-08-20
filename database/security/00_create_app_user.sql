-- Create app_user role and grant permissions for backend service connection
DO $$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'app_user') THEN
      CREATE USER app_user WITH PASSWORD 'HuyLe@574406';
   ELSE
      ALTER USER app_user WITH PASSWORD 'HuyLe@574406';
   END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE "pharmatrace-vn-db" TO app_user;
GRANT ALL ON SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;
