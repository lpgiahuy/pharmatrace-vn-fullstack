-- Master database initialization script for PharmaTrace VN
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

-- 6. Prepare auth role/policies without enabling account RLS during module rollout.
\i /docker-entrypoint-initdb.d/security/03_auth_rls.sql

-- 7. Wishlist ownership: only the current customer can read/add/remove their rows.
\i /docker-entrypoint-initdb.d/security/05_wishlist_rls.sql

-- 8. Cart ownership, including checkout cleanup.
\i /docker-entrypoint-initdb.d/security/06_cart_rls.sql

-- 9. Review/moderation ownership, write-column guards and retained audit history.
\i /docker-entrypoint-initdb.d/security/07_review_rls.sql

-- Order ownership, fulfillment facility scope, transfer projection and loyalty ledger.
\i /docker-entrypoint-initdb.d/security/08_order_rls.sql

-- Voucher management, exact-code previews and order-bound consumption.
\i /docker-entrypoint-initdb.d/security/09_voucher_rls.sql

-- Facility public reads and administrator-only management.
\i /docker-entrypoint-initdb.d/security/10_facility_rls.sql

-- Employee management and private employee rows.
\i /docker-entrypoint-initdb.d/security/11_employee_rls.sql

-- Customer ownership, facility administration and loyalty integration.
\i /docker-entrypoint-initdb.d/security/12_customer_rls.sql
