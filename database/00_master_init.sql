-- Master database initialization script for PharmaTrace VN
-- Execution order: Schemas -> Functions -> Procedures -> Triggers -> Views -> Seeds

-- 1. Schemas & Tables
\i /docker-entrypoint-initdb.d/schemas/01_core_master_tables.sql
\i /docker-entrypoint-initdb.d/schemas/02_inventory_tracking.sql
\i /docker-entrypoint-initdb.d/schemas/03_orders_prescriptions.sql
\i /docker-entrypoint-initdb.d/schemas/04_procurement_po.sql
\i /docker-entrypoint-initdb.d/schemas/05_logistics_cod.sql
\i /docker-entrypoint-initdb.d/schemas/06_qr_fraud_anomaly.sql
\i /docker-entrypoint-initdb.d/schemas/07_crm_loyalty_rma.sql
\i /docker-entrypoint-initdb.d/schemas/08_finance_ar_ap.sql

-- 2. Functions
\i /docker-entrypoint-initdb.d/functions/fn_haversine_distance.sql
\i /docker-entrypoint-initdb.d/functions/fn_calculate_shipping_fee.sql
\i /docker-entrypoint-initdb.d/functions/fn_check_qr_risk_score.sql

-- 3. Stored Procedures
\i /docker-entrypoint-initdb.d/procedures/sp_transfer_inventory.sql
\i /docker-entrypoint-initdb.d/procedures/sp_receive_new_batch.sql
\i /docker-entrypoint-initdb.d/procedures/sp_recall_medicine_batch.sql

-- 4. Triggers
\i /docker-entrypoint-initdb.d/triggers/trg_sync_order_to_shipment.sql
\i /docker-entrypoint-initdb.d/triggers/trg_auto_upgrade_customer_tier.sql

-- 5. Views
\i /docker-entrypoint-initdb.d/views/v_inventory_summary.sql
\i /docker-entrypoint-initdb.d/views/v_batch_management.sql

-- 6. Seed Data
\i /docker-entrypoint-initdb.d/seeds/01_seed_data.sql
