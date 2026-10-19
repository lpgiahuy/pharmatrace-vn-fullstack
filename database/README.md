# PharmaTrace VN - Database Architecture & Schema Specification

This directory contains the Enterprise PostgreSQL database scripts for **PharmaTrace VN**, powering supply chain traceability, anti-counterfeit verification, warehouse logistics (WMS), electronic prescriptions, and e-commerce transactions.

---

## Directory Structure

```text
database/
├── 00_master_init.sql              # Master initialization entrypoint
├── README.md                       # Database architecture documentation
├── schemas/                        # Table DDL, constraints, primary & foreign keys
│   ├── 01_core_master_tables.sql   # Categories, facilities, customers, employees, manufacturers, medicines, packaging_variants, medicine_categories, customer_wishlists
│   ├── 02_inventory_tracking.sql   # Batches, sscc_cartons, medicine_boxes, inventories, inventory_logs
│   ├── 03_orders_prescriptions.sql # Prescriptions, vouchers, orders, order_items, cart_items, reviews, moderation_reports, moderation_audit_logs, articles
│   ├── 04_procurement_po.sql       # Purchase orders (PO) and PO line items
│   ├── 05_logistics_cod.sql        # Shipments and COD reconciliation
│   ├── 06_qr_fraud_anomaly.sql     # QR scan verification logs and anti-fraud anomaly alerts
│   ├── 07_crm_loyalty_rma.sql      # Customer loyalty points ledger
│   └── 08_finance_ar_ap.sql        # Cashbook logs, accounts receivable (AR), accounts payable (AP)
└── seeds/                          # Master catalog & initial data
    └── 01_seed_data.sql            # Core categories, facilities, users, medicines, packaging variants, batches
```

---

## Database Tables Overview (32 Tables Synchronized with Prisma Schema)

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

### 6. Fraud & Anomaly (`schemas/06_qr_fraud_anomaly.sql`)
* `qr_scan_logs`: Audit trail of all consumer QR scans with geolocation, IP, and risk scoring.
* `fraud_alerts`: Real-time anomaly alerts for velocity fraud (distance/time > realistic travel speed) and counterfeit clones.

### 7. CRM & Loyalty (`schemas/07_crm_loyalty_rma.sql`)
* `loyalty_point_logs`: Double-entry ledger of customer points (`EARN`, `REDEEM`, `RANK_BONUS`, `ADMIN_ADJUSTMENT`).

### 8. Finance (`schemas/08_finance_ar_ap.sql`)
* `cashbook_logs`: Inflow and outflow cashbook journal entries.
* `accounts_receivable`: Accounts Receivable (AR) ledger for customer orders.
* `accounts_payable`: Accounts Payable (AP) ledger for supplier procurement orders.

---

## Execution Order

When running `00_master_init.sql`, scripts are executed in strict dependency order:
1. `schemas/*`: Table definitions, primary/foreign keys, check constraints, indexes (32 tables).
2. `seeds/*`: Comprehensive master catalog (543 medicines, 250 facilities, 624 packaging variants, serialized boxes, demo orders).

---

> [!NOTE]
> **Application Architecture (Dumb Database, Smart Application)**:
> Following modern clean architecture principles, business workflows, spatial routing (Haversine distance calculation), dynamic shipping fee evaluation, and transactional state mutations are managed 100% within the NestJS application layer (`pharmatrace-vn-backend`) via **Prisma ORM**. The PostgreSQL layer is dedicated purely to reliable ACID storage, relational integrity, and constraint enforcement.


