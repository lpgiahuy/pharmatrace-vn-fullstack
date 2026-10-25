-- Master database initialization script for PharmaTrace VN
-- Execution order: Base schemas -> Base grants -> Prescription schema -> Seed -> RLS
\set ON_ERROR_STOP on

-- 1. Schemas & Tables
\i /docker-entrypoint-initdb.d/schemas/01_core_master_tables.sql
\i /docker-entrypoint-initdb.d/schemas/02_inventory_tracking.sql
\i /docker-entrypoint-initdb.d/schemas/03_orders_prescriptions.sql
\i /docker-entrypoint-initdb.d/schemas/04_procurement_po.sql
\i /docker-entrypoint-initdb.d/schemas/05_logistics_cod.sql
\i /docker-entrypoint-initdb.d/schemas/06_qr_fraud_anomaly.sql
\i /docker-entrypoint-initdb.d/schemas/07_crm_loyalty_rma.sql
\i /docker-entrypoint-initdb.d/schemas/08_finance_ar_ap.sql

-- 2. Base application permissions (before the restricted review table exists)
\i /docker-entrypoint-initdb.d/security/01_app_permissions.sql

-- 3. Prescription review schema
\i /docker-entrypoint-initdb.d/schemas/09_prescription_management.sql

-- 4. Development seed (all referenced tables must exist)
\i /docker-entrypoint-initdb.d/seeds/01_seed_data.sql

-- 5. Prescription review security
\i /docker-entrypoint-initdb.d/security/02_prescription_rls.sql

