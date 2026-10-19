-- Master database initialization script for PharmaTrace VN
-- Execution order: Schemas -> Seeds

-- 1. Schemas & Tables
\i /docker-entrypoint-initdb.d/schemas/01_core_master_tables.sql
\i /docker-entrypoint-initdb.d/schemas/02_inventory_tracking.sql
\i /docker-entrypoint-initdb.d/schemas/03_orders_prescriptions.sql
\i /docker-entrypoint-initdb.d/schemas/04_procurement_po.sql
\i /docker-entrypoint-initdb.d/schemas/05_logistics_cod.sql
\i /docker-entrypoint-initdb.d/schemas/06_qr_fraud_anomaly.sql
\i /docker-entrypoint-initdb.d/schemas/07_crm_loyalty_rma.sql
\i /docker-entrypoint-initdb.d/schemas/08_finance_ar_ap.sql

-- 2. Master Seed Data
\i /docker-entrypoint-initdb.d/seeds/01_seed_data.sql

