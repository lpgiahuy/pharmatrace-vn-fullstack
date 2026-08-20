# PharmaTrace VN - Database Architecture & Schema Specification

This directory contains the Enterprise PostgreSQL database scripts for **PharmaTrace VN**, powering supply chain traceability, anti-counterfeit verification, warehouse logistics (WMS), electronic prescriptions, and e-commerce transactions.

---

## Directory Structure

```text
database/
├── 00_master_init.sql              # Master initialization entrypoint
├── README.md                       # Database architecture documentation
├── schemas/                        # Table DDL, constraints, primary & foreign keys
│   ├── 01_core_master_tables.sql   # Categories, packaging, facilities, users, customers, employees, medicines
│   ├── 02_inventory_tracking.sql   # Batches, serialized box UIDs, SSCC packages, facility inventories, transactions
│   ├── 03_orders_prescriptions.sql # Prescriptions, vouchers, orders, order items, cart, reviews, articles
│   ├── 04_procurement_po.sql       # Purchase orders (PO) and PO items
│   ├── 05_logistics_cod.sql        # Shipments and COD reconciliation
│   ├── 06_qr_fraud_anomaly.sql     # Verification scan logs and fraud anomaly alerts
│   ├── 07_crm_loyalty_rma.sql      # Loyalty point logs, return orders (RMA), return items
│   └── 08_finance_ar_ap.sql        # Cash flow transactions, customer debts (AR), supplier debts (AP)
├── functions/                      # Business calculation & geospatial functions
│   ├── fn_haversine_distance.sql   # Computes geographic distance in km between lat/lng points
│   ├── fn_calculate_shipping_fee.sql # Calculates dynamic shipping fees based on distance & order value
│   └── fn_check_qr_risk_score.sql  # Calculates scan risk score and triggers velocity fraud alerts
├── procedures/                     # Atomic transactional stored procedures
│   ├── sp_transfer_inventory.sql  # Atomic inter-facility stock transfer with row-level locking
│   ├── sp_receive_new_batch.sql    # Inbounds new batch and generates serialized box UIDs
│   └── sp_recall_medicine_batch.sql # Quarantines defective or recalled medicine batches
├── triggers/                       # Automated trigger handlers & validation hooks
│   ├── trg_sync_order_to_shipment.sql # Auto-creates shipment record on order confirmation
│   └── trg_auto_upgrade_customer_tier.sql # Auto-upgrades customer membership tier based on points
├── views/                          # Analytical SQL views
│   ├── v_inventory_summary.sql    # Real-time stock levels across all facilities
│   └── v_batch_management.sql     # Expiration monitoring and batch status analysis
└── seeds/                          # Master catalog & initial data
    └── 01_seed_data.sql            # Core categories, packaging, facilities, default users, medicines, batches
```

---

## Database Tables Overview (30 Tables)

### 1. Core Master Data (`schemas/01_core_master_tables.sql`)
* `packaging_specifications`: Packaging units (Box, Bottle, Strip, Tube).
* `categories`: Pharmaceutical categories (Antibiotics, Analgesics, Cardiovascular, etc.).
* `facilities`: Physical organization units (Manufacturers, Central Warehouses, Branch Warehouses, Pharmacies).
* `users`: System user accounts and role-based access control (`SUPER_ADMIN`, `PHARMACIST`, `WAREHOUSE_STAFF`, `STORE_MANAGER`, `CUSTOMER`).
* `customers`: Customer profiles, membership tiers (`BRONZE`, `SILVER`, `GOLD`, `PLATINUM`, `DIAMOND`), and loyalty points.
* `employees`: Employee staff profiles linked to facilities.
* `medicines`: Pharmaceutical catalog with active ingredients, dosage, pricing, and prescription requirements.

### 2. Inventory & Traceability (`schemas/02_inventory_tracking.sql`)
* `medicine_batches`: Production lot batches with manufacturing and expiration dates.
* `shipping_packages`: SSCC logistics cartons and master containers.
* `medicine_boxes`: Serialized UIDs for unit-level packages (Public QR + Secret OTP).
* `facility_inventories`: Real-time stock balances per facility and medicine.
* `inventory_transactions`: Audit log of stock movements (Inbound, Outbound, Transfer, Disposal).

### 3. Orders & Prescriptions (`schemas/03_orders_prescriptions.sql`)
* `prescriptions`: Uploaded doctor prescriptions and pharmacist review status.
* `vouchers`: Promotional discount codes and usage tracking.
* `orders`: Customer orders, payment status (`UNPAID`, `PAID`), and order status (`PENDING`, `PROCESSING`, `SHIPPING`, `COMPLETED`, `CANCELLED`).
* `order_items`: Purchased line items and assigned box UIDs.
* `cart_items`: Active customer shopping cart items.
* `product_reviews`: Customer product ratings and reviews.
* `articles`: Health and medical news articles.

### 4. Procurement (`schemas/04_procurement_po.sql`)
* `purchase_orders`: Supplier purchase orders (PO) and fulfillment status.
* `purchase_order_items`: PO line items and received quantities.

### 5. Logistics & COD (`schemas/05_logistics_cod.sql`)
* `shipments`: Courier tracking numbers, shipping status, and COD reconciliation.

### 6. Fraud & Anomaly (`schemas/06_qr_fraud_anomaly.sql`)
* `verification_logs`: Audit trail of all public QR scans with geolocation and IP address.
* `fraud_alerts`: Real-time alerts for velocity anomalies (speed > 1000 km/h) and duplicate activations.

### 7. CRM & Returns (`schemas/07_crm_loyalty_rma.sql`)
* `loyalty_point_logs`: Ledger of earned and redeemed customer loyalty points.
* `return_orders`: Customer return requests (RMA) and refund status.
* `return_order_items`: Returned line items and reasons.

### 8. Finance (`schemas/08_finance_ar_ap.sql`)
* `cash_flow_transactions`: Cashbook inflow and outflow journal entries.
* `customer_debts`: Accounts Receivable (AR) ledger for customer orders.
* `supplier_debts`: Accounts Payable (AP) ledger for supplier POs.

---

## Execution Order

When running `00_master_init.sql`, scripts are executed in strict dependency order:
1. `schemas/*`: Table definitions, primary/foreign keys, check constraints.
2. `functions/*`: Spatial and business calculation functions.
3. `procedures/*`: Transactional stored procedures.
4. `triggers/*`: Automated triggers.
5. `views/*`: Reporting views.
6. `seeds/*`: Initial master data and demo records.
