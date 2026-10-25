# PharmaTrace VN - Database Architecture & Schema Specification

PostgreSQL schema, development seed data, application permissions, and prescription RLS for **PharmaTrace VN**.

---

## Directory Structure

```text
database/
├── 00_create_app_user.sh           # Docker entrypoint: creates the runtime role
├── 00_master_init.sql              # Docker entrypoint: orchestrates SQL scripts
├── README.md
├── security/
│   ├── 00_create_app_user.sql      # Role creation with an environment-provided password
│   ├── 01_app_permissions.sql      # Base table grants and default privileges
│   └── 02_prescription_rls.sql     # Prescription grants and access policies
├── schemas/                        # Table DDL, constraints, primary & foreign keys
│   ├── 01_core_master_tables.sql   # Categories, facilities, customers, employees, manufacturers, medicines, packaging_variants, medicine_categories, customer_wishlists
│   ├── 02_inventory_tracking.sql   # Batches, sscc_cartons, medicine_boxes, inventories, inventory_logs
│   ├── 03_orders_prescriptions.sql # Prescriptions, vouchers, orders, order_items, cart_items, reviews, moderation_reports, moderation_audit_logs, articles
│   ├── 04_procurement_po.sql       # Purchase orders (PO) and PO line items
│   ├── 05_logistics_cod.sql        # Shipments and COD reconciliation
│   ├── 06_qr_fraud_anomaly.sql     # QR scan verification logs and anti-fraud anomaly alerts
│   ├── 07_crm_loyalty_rma.sql      # Customer loyalty points ledger
│   ├── 08_finance_ar_ap.sql        # Cashbook logs, accounts receivable (AR), accounts payable (AP)
│   └── 09_prescription_management.sql # Prescription review table, column, and indexes
├── seeds/                          # Development catalog and sample transactions
│   └── 01_seed_data.sql
└── tests/
    ├── development_seed_test.sql   # Fresh-database fixtures, sequences, and grants
    └── prescription_rls_test.sql   # Manual RLS isolation checks
```

`backups/` contains ignored local database dumps. `migrations/` is currently unused; the scripts above bootstrap a new database and do not track applied versions.

## Docker Development Setup

From the repository root, copy `.env.example` to `.env` and `pharmatrace-vn-backend/.env.example` to `pharmatrace-vn-backend/.env`. Set `APP_DB_PASSWORD` in the root `.env`, then use the same password in the backend `DATABASE_URL` for `app_user`. If it contains URL-reserved characters, encode them in `DATABASE_URL`. Add your own Cloudinary credentials to the backend `.env`. Do not commit either `.env` file.

On a new database volume, `docker compose up -d db` creates the restricted `app_user` role, loads the schema and seed data, grants application table privileges, and applies prescription RLS through `00_master_init.sql`.

The PostgreSQL image runs initialization scripts only when its data directory is empty. Existing volumes do not rerun them. Keep the versioned schema and RLS files in Git so new clones receive the same database setup. Do not remove the volume to rerun initialization unless its data can be discarded.

Run the fixture checks on a freshly initialized database, then the RLS checks:

```powershell
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/prescription_rls_test.sql
```

The test uses the IDs from the committed seed data and rolls back its test order.

## Development Seed Accounts

The seed is derived from a local export, with application IDs, relationships, stock, and transaction amounts retained. It excludes `_prisma_migrations` and the two legacy medicine backup tables. Personal contact fields, prescription text/image references, customer free text, and QR location/client data are replaced or removed. It is a development fixture, not an exact backup of the local database.

- Customers: `customer<ID>@example.test`, phone `09` followed by the ID padded to eight digits; for example, customer 1 uses `0900000001`.
- Employees: `employee<ID>@example.test`; existing role and facility assignments are retained.
- All seeded account passwords: `PharmaTraceDemo2026!` (bcrypt hashes; development only).
- Prescription images use `example.invalid` placeholders and review images are removed. Image display and real image moderation require separate synthetic uploads.
- Legacy `REDEEMED` is normalized to `REDEEM`. `REDEEM_REVERSAL` remains a separate transaction type supported by the schema and backend.

Do not overwrite this file with an unfiltered local dump. Keep raw exports in the ignored `backups/` directory. New exports require schema, privacy, and clean-import checks before replacing fixtures.

---

## Database Tables Overview (34 Tables)

### 1. Core Master Data (`schemas/01_core_master_tables.sql`)
* `categories`: Hierarchical pharmaceutical categories with recursive parent-child taxonomy.
* `facilities`: Physical organization units (Manufacturers, Central Warehouses, Branch Warehouses, Pharmacies).
* `customers`: Customer profiles, authentication credentials (`password_hash`), tiers (`BRONZE` to `DIAMOND`), and reward points.
* `employees`: Employee staff profiles, credentials, assigned facility, and system roles.
* `manufacturers`: Master pharmaceutical brand records and origin information.
* `medicines`: Comprehensive pharmaceutical catalog with pricing, active ingredients, dosage, prescription flags, and computed `effective_price`.
* `packaging_variants`: Multi-tier packaging units (Box, Bottle, Strip, Tube) with custom unit pricing and discounts.
* `medicine_categories`: Many-to-Many mapping table between medicines and categories.
* `customer_wishlists`: Customer bookmarked and saved medicines.

### 2. Inventory & Traceability (`schemas/02_inventory_tracking.sql`)
* `batches`: Production lot batches with manufacturing and expiration dates and CO/CQ certification.
* `sscc_cartons`: GS1 SSCC logistics cartons and master shipping containers.
* `medicine_boxes`: Serialized unit-level boxes (UUID primary key, cryptographic signature, and public key).
* `inventories`: Real-time stock balances per facility, medicine, and packaging variant.
* `inventory_logs`: Audit trail of stock movements (Inbound, Outbound, Transfer, Disposal, Adjustment).

### 3. Orders & Prescriptions (`schemas/03_orders_prescriptions.sql`)
* `prescriptions`: Uploaded doctor prescriptions with pharmacist approval status.
* `vouchers`: Promotional discount codes and usage tracking.
* `orders`: Customer orders, payment status (`UNPAID`, `PAID`), and order status.
* `order_items`: Purchased line items linked to variants, with assigned serial box UUIDs.
* `cart_items`: Active customer shopping carts uniquely keyed by `(customer_id, variant_id)`.
* `reviews`: Customer product ratings, reviews, replies, and verified purchase status.
* `moderation_reports`: Abuse and content violation reporting on reviews.
* `moderation_audit_logs`: Audit trail of administrative moderation actions.
* `articles`: Health and pharmaceutical knowledge articles.

### 4. Procurement (`schemas/04_procurement_po.sql`)
* `purchase_orders`: Supplier purchase orders (PO) and fulfillment lifecycle.
* `purchase_order_items`: PO line items, unit costs, and generated total price.

### 5. Logistics & COD (`schemas/05_logistics_cod.sql`)
* `shipments`: Courier tracking numbers, shipping status, and COD settlement reconciliation.
* `internal_transfers`: Facility-to-facility fulfillment transfers linked to an order.

### 6. Fraud & Anomaly (`schemas/06_qr_fraud_anomaly.sql`)
* `qr_scan_logs`: Audit trail of all consumer QR scans with geolocation, IP, and risk scoring.
* `fraud_alerts`: Real-time anomaly alerts for velocity fraud (distance/time > realistic travel speed) and counterfeit clones.

### 7. CRM & Loyalty (`schemas/07_crm_loyalty_rma.sql`)
* `loyalty_point_logs`: Customer points ledger (`EARN`, `REDEEM`, `REDEEM_REVERSAL`, `RANK_BONUS`, `RMA_DEDUCTION`, `ADMIN_ADJUSTMENT`).

### 8. Finance (`schemas/08_finance_ar_ap.sql`)
* `cashbook_logs`: Inflow and outflow cashbook journal entries.
* `accounts_receivable`: Accounts Receivable (AR) ledger for customer orders.
* `accounts_payable`: Accounts Payable (AP) ledger for supplier procurement orders.

### 9. Prescription Review (`schemas/09_prescription_management.sql`)
* `orders.prescription_review_status`: Review workflow state on an order.
* `order_prescription_reviews`: Per-order pharmacist assignments and decisions. Grants and facility-scoped RLS are defined in `security/02_prescription_rls.sql`.

---

## Execution Order

Docker runs only the top-level `.sh` and `.sql` entrypoints, in filename order. SQL files in subdirectories are included explicitly:

1. `00_create_app_user.sh` runs `security/00_create_app_user.sql` to create `app_user`.
2. `00_master_init.sql` loads `schemas/01` through `schemas/08` (33 base tables).
3. `security/01_app_permissions.sql` grants base table access and configures default privileges for tables created by `postgres`.
4. `schemas/09_prescription_management.sql` creates the prescription review table and adds the order review column.
5. `seeds/01_seed_data.sql` imports all development data in a transaction with foreign-key and CHECK constraints enabled, restores exported sequence values, and advances any sequence that would collide with imported IDs.
6. `security/02_prescription_rls.sql` revokes inherited review-table privileges, grants the permitted review operations, and applies prescription policies.

All tables must exist before importing the seed. Review grants are explicitly restricted after import so blanket or default privileges cannot add DELETE/TRUNCATE access. The SQL files are intended to run as `postgres` through `psql`.

---

## Maintenance Notes

- Keep schema changes consistent with `pharmatrace-vn-backend/prisma/schema.prisma`.
- Prescription RLS is scoped to the current prescription workflow; this setup does not provide database-wide tenant isolation.
- The seed contains synthetic account and personal fields alongside catalog and operational fixtures. Foreign-key triggers remain enabled during import. It is not a production provisioning script.
- Some seed text already contains corrupted characters. Repair it from a verified source rather than guessing replacements.
- Existing databases need an explicit upgrade procedure for schema changes, including the `REDEEM_REVERSAL` constraint and review grants. Editing bootstrap files alone does not update an existing Docker volume.


