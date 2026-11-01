# PharmaTrace VN - Database Architecture & Schema Specification

PostgreSQL schema, development seed data, application permissions, and RLS for **PharmaTrace VN**.

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
│   ├── 02_prescription_rls.sql     # Prescription grants and access policies
│   ├── 03_auth_rls.sql             # Auth role/policies; enforcement opt-in
│   ├── 04_auth_rls_rollback.sql    # Manual rollback, never called by master
│   ├── 05_wishlist_rls.sql         # Enforced customer wishlist ownership
│   ├── 06_cart_rls.sql             # Enforced customer cart ownership
│   ├── 07_review_rls.sql           # Review ownership, moderation, reports and audit
│   ├── 08_order_rls.sql            # Orders, fulfillment, transfers and loyalty ledger
│   ├── 09_voucher_rls.sql          # Voucher scopes and order-bound consumption
│   ├── 10_facility_rls.sql         # Facility access
│   ├── 11_employee_rls.sql         # Employee access
│   ├── 12_customer_rls.sql         # Customer access
│   ├── 13_catalog_rls.sql          # Product and category access
│   ├── 14_employee_facility_rls.sql # Facility-scoped employee management
│   ├── 15_manufacturer_rls.sql     # Manufacturer access and employee assignment guard
│   └── 16_prescription_voucher_release.sql # Release voucher usage when rejecting a prescription
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
    ├── prescription_rls_test.sql   # Manual RLS isolation checks
    ├── wishlist_rls_test.sql       # Wishlist allow/deny checks, rolled back
    ├── cart_rls_test.sql           # Cart ownership and column-grant checks
    ├── review_rls_test.sql         # Review visibility and write restrictions
    ├── order_rls_test.sql          # Customer/facility ownership and transfer projection
    ├── voucher_rls_test.sql        # Exact-code previews, management and consumption
    └── manufacturer_rls_test.sql   # Manufacturer permissions and facility assignment
```

`backups/` contains ignored local database dumps. Master initialization includes both prescription and auth security scripts. Auth roles and policies are prepared by 03; scripts 11 and 12 enable RLS on employees and customers. Backend authentication must use the corresponding RLS configuration. These bootstrap scripts do not track applied versions or update existing Docker volumes automatically.

## Docker Development Setup

From the repository root, copy `.env.example` to `.env` and `pharmatrace-vn-backend/.env.example` to `pharmatrace-vn-backend/.env`. Set `APP_DB_PASSWORD` in the root `.env`, then use the same password in the backend `DATABASE_URL` for `app_user`. If it contains URL-reserved characters, encode them in `DATABASE_URL`. Add your own Cloudinary credentials to the backend `.env`. Do not commit either `.env` file.

On a new database volume, `docker compose up -d db` creates the restricted `app_user` role, loads the schema and seed data, grants application table privileges, and applies prescription RLS through `00_master_init.sql`.

The PostgreSQL image runs initialization scripts only when its data directory is empty. Existing volumes do not rerun them. Keep the versioned schema and RLS files in Git so new clones receive the same database setup. Do not remove the volume to rerun initialization unless its data can be discarded.

Run the fixture checks on a freshly initialized database, then the RLS checks:

```powershell
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/prescription_rls_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/wishlist_rls_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/cart_rls_test.sql

docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/review_rls_test.sql
```

The test uses the IDs from the committed seed data and rolls back its test order.

Existing local databases do not rerun initialization automatically. To enable voucher usage release for prescription rejections, back up the database and apply the new script as the database owner:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/16_prescription_voucher_release.sql
```

The release is atomic with prescription rejection and applies only to that cancellation path. Other cancellation paths do not currently release voucher usage. Paid orders retain `PAID` until a manual refund is completed and recorded.

## Development Seed Accounts

### Interview demo setup

Use Docker and Node.js to start the project on a new machine. From the repository root:

```powershell
Copy-Item .env.example .env
Copy-Item pharmatrace-vn-backend/.env.example pharmatrace-vn-backend/.env
Copy-Item pharmatrace-vn-frontend/.env.example pharmatrace-vn-frontend/.env.local
```

Set `APP_DB_PASSWORD` in the root `.env` and configure the backend `DATABASE_URL` with the same password for `app_user`, the database name and port in the root `.env`. Set a local `JWT_SECRET` and `QR_SECRET_KEY` in the backend `.env`. Optional external services require their own credentials; do not commit `.env` files.

```powershell
docker compose up -d db
cd pharmatrace-vn-backend
npm ci
npm run start:dev
```

In a second terminal:

```powershell
cd pharmatrace-vn-frontend
npm ci
npm run dev
```

Open `http://localhost:3000`. The demo password below works for seeded accounts including super administrator `employee11@example.test`, store manager `employee12@example.test`, pharmacist `employee13@example.test`, and customer `customer1@example.test`. The seed is loaded only for a new database volume; it does not replace an existing local database. Verify the demo flows before an interview, especially optional image, map and AI integrations.

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
7. `security/03_auth_rls.sql` prepares auth roles, column grants and policies. It does not enable account RLS unless explicitly invoked with `auth_rls_activate=true`. Master never runs the rollback script.
8. `security/05_wishlist_rls.sql` restricts `app_user` to SELECT/INSERT/DELETE and enables/forces customer ownership policies on `customer_wishlists`.
9. `security/06_cart_rls.sql` enables/forces customer cart ownership; UPDATE is limited to quantity/variant, and sequence reset/TRUNCATE are not granted.
10. `security/07_review_rls.sql` enforces review/report/audit scopes.
11. `security/08_order_rls.sql` enforces order ownership, fulfillment scope and loyalty ledger access.
12. `security/09_voucher_rls.sql` adds order voucher references and enforces voucher scopes and consumption rules.

All tables must exist before importing the seed. Review grants are explicitly restricted after import so blanket or default privileges cannot add DELETE/TRUNCATE access. The SQL files are intended to run as `postgres` through `psql`.

---

## Maintenance Notes

- Keep schema changes consistent with `pharmatrace-vn-backend/prisma/schema.prisma`.
- Prescription RLS is scoped to the current prescription workflow; this setup does not provide database-wide tenant isolation.
- The seed contains synthetic account and personal fields alongside catalog and operational fixtures. Foreign-key triggers remain enabled during import. It is not a production provisioning script.
- Some seed text already contains corrupted characters. Repair it from a verified source rather than guessing replacements.
- Existing databases need an explicit upgrade procedure for schema changes, including the `REDEEM_REVERSAL` constraint and review grants. Editing bootstrap files alone does not update an existing Docker volume.

## Cart RLS

Cart RLS is automatically enforced on new Docker databases through `security/06_cart_rls.sql`. It is independent of `AUTH_RLS_ENABLED`; configure authentication to match the account policies installed on the target database.

- Only customer context with matching customer ID can SELECT/INSERT/UPDATE/DELETE cart rows. Missing context and employee identities are denied, even if their numeric IDs match customers.
- Runtime may insert customer/variant/quantity/timestamp, update only variant/quantity, and use the cart sequence. It cannot change ownership/row IDs, TRUNCATE, or reset the sequence.
- Every cart operation, helper query and returned cart read uses the same actor transaction. Sync and variant switches do not start nested, unscoped transactions.
- Checkout now carries customer context for both prescription and non-prescription orders, so purchased cart rows are deleted only for the buyer.
- Existing quantity, sync-max, pricing and stock-display rules are retained. Variant switching still checks live stock minus reservations. This change does not implement inventory RLS or solve the existing concurrent read/modify/write quantity races.

For an existing database, deploy the new cart **and checkout** backend first, back up/review existing policies and grants, then apply only this file as owner. Docker will not rerun init scripts for existing volumes. Old unscoped code could return an empty cart or leave purchased cart rows behind.

```powershell
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/security/06_cart_rls.sql'
```

The script runs in a transaction, can be reapplied, refuses unknown cart policies and does not delete cart data. `tests/cart_rls_test.sql` verifies SQL allow/deny behavior using temporary fixtures and rolls them back; sequence increments are not rolled back. These changes do not automatically modify the developer's local database.

### Cart integration test

Run these PowerShell commands from the repository root, using a disposable database only:

```powershell
docker run --detach --name pharmatrace-cart-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=cart_test_owner_only -e APP_DB_PASSWORD=cart_test_app_only -e POSTGRES_DB=pharmatrace_cart_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-cart-rls-test
```

Wait for `PostgreSQL init process complete; ready for start up.`, then run:

```powershell
docker exec pharmatrace-cart-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_cart_rls_test -f /docker-entrypoint-initdb.d/tests/cart_rls_test.sql
$cartTestPort = (docker port pharmatrace-cart-rls-test 5432).Split(':')[-1]
$env:CART_RLS_TEST_DATABASE_URL = "postgresql://app_user:cart_test_app_only@127.0.0.1:$cartTestPort/pharmatrace_cart_rls_test"
$env:CART_RLS_TEST_ADMIN_URL = "postgresql://postgres:cart_test_owner_only@127.0.0.1:$cartTestPort/pharmatrace_cart_rls_test"
$env:CART_RLS_TEST_AUTH_ENABLED = 'false'
Push-Location pharmatrace-vn-backend
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/cart-rls.e2e-spec.ts
Pop-Location
```

The suite uses explicit localhost test URLs with that exact database name, never `.env` as a target. Without URLs it is skipped. It checks actual HTTP/JWT/Prisma/PostgreSQL behavior: ownership, same-ID employees, totals, quantities, sync, variant switch/merge/stock failures, clear/delete, forbidden direct writes, rollback and non-prescription checkout cart cleanup. Fixtures include synthetic accounts, products and stock, and are cleaned up after testing.

To test cart with account RLS, use a disposable database with the current auth, customer and employee policies, set `CART_RLS_TEST_AUTH_ENABLED=true` and rerun. Do not run suites concurrently against this database.

```powershell
docker rm --force pharmatrace-cart-rls-test
Remove-Item Env:CART_RLS_TEST_DATABASE_URL, Env:CART_RLS_TEST_ADMIN_URL, Env:CART_RLS_TEST_AUTH_ENABLED
```

## Wishlist RLS

Wishlist RLS is enabled automatically on a new Docker database, independently of `AUTH_RLS_ENABLED`. Configure the authentication flag to match the account policies installed on the target database.

`security/05_wishlist_rls.sql` permits only a customer context (`app.current_user_type=customer`, `app.current_user_role=CUSTOMER`) whose ID matches `customer_wishlists.customer_id`:

- SELECT/INSERT/DELETE apply only to that customer's rows. Missing context and employee context see no rows and cannot insert.
- UPDATE and TRUNCATE are not granted. Duplicate adds use INSERT with conflict-ignore rather than an UPDATE/upsert.
- List, count, search, pagination, single/batch checks and writes run through the same actor transaction in `WishlistService`. Medicine and packaging reads remain part of that transaction.
- No database superuser or `BYPASSRLS` connection may be used for these runtime queries. The bootstrap owner is separate from `app_user`.

The script does not change account or catalog RLS, product visibility, or existing stock display behavior. Its context comes from the authenticated server; it does not protect against someone who already holds backend database credentials and can send arbitrary SQL.

### Existing database

Docker does not rerun init scripts for existing volumes. Deploy the updated wishlist backend before applying the SQL; older code without actor context would receive empty results or denied writes. Back up the current policy/grants and test on a copy first. The script is transactional, can be reapplied, and refuses unknown wishlist policies rather than combining them with potentially broader access. It does not delete seed or customer rows.

After deploying the compatible backend, an owner can apply just this script without resetting the volume:

```powershell
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/security/05_wishlist_rls.sql'
```

Run `tests/wishlist_rls_test.sql` as owner for standalone allow/deny checks. It creates temporary customer fixtures, uses the runtime role for assertions and rolls back the data. Sequence advancement is not rolled back. This work does not apply the SQL to the developer's existing database automatically.

### Wishlist HTTP integration test

Use a separate disposable database. These PowerShell commands start at the repository root:

```powershell
docker run --detach --name pharmatrace-wishlist-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=wishlist_test_owner_only -e APP_DB_PASSWORD=wishlist_test_app_only -e POSTGRES_DB=pharmatrace_wishlist_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-wishlist-rls-test
```

Wait for `PostgreSQL init process complete; ready for start up.`, then:

```powershell
$wishlistTestPort = (docker port pharmatrace-wishlist-rls-test 5432).Split(':')[-1]
$env:WISHLIST_RLS_TEST_DATABASE_URL = "postgresql://app_user:wishlist_test_app_only@127.0.0.1:$wishlistTestPort/pharmatrace_wishlist_rls_test"
$env:WISHLIST_RLS_TEST_ADMIN_URL = "postgresql://postgres:wishlist_test_owner_only@127.0.0.1:$wishlistTestPort/pharmatrace_wishlist_rls_test"
$env:WISHLIST_RLS_TEST_AUTH_ENABLED = 'false'
Push-Location pharmatrace-vn-backend
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/wishlist-rls.e2e-spec.ts
Pop-Location
```

The suite requires those explicit localhost URLs and the database name above; it never uses `.env` as a test target. Without test URLs the suite is skipped, not verified. It tests HTTP, JWT, Prisma, cross-customer isolation, employee rejection, product relations, pagination/search/count, batch checks, duplicate-add concurrency, delete idempotence, forbidden database writes and context cleanup after rollback.

To test wishlist with account RLS, use a disposable database with the current auth, customer and employee policies, set `WISHLIST_RLS_TEST_AUTH_ENABLED=true`, and rerun. No other integration suite should share this test database concurrently.

After testing:

```powershell
docker rm --force pharmatrace-wishlist-rls-test
Remove-Item Env:WISHLIST_RLS_TEST_DATABASE_URL, Env:WISHLIST_RLS_TEST_ADMIN_URL
Remove-Item Env:WISHLIST_RLS_TEST_AUTH_ENABLED -ErrorAction SilentlyContinue
```

## Auth RLS rollout

Implementation branch: `feature/auth-rbac`. Date: 2026-10-25.

### Rollout status

**Docker automatically prepares auth roles and policies for new databases** through `security/03_auth_rls.sql`, called by master initialization. The 03 script alone does not ENABLE/FORCE account RLS by default; master initialization later applies scripts 11 and 12, which enable it. Configure the backend authentication flag for the deployed database policies.

Policy preparation and enforcement activation are separate steps. Prescription enforcement can run because its workflow has been adapted; customers/employees are still used by modules without the required context. Do not delete an existing data volume to force Docker initialization to run again.

Activate enforcement on the shared database only after the remaining modules use the appropriate context and roles. Do not add unrestricted table policies to avoid errors, as that would defeat the intended isolation.

#### Before enforcement is enabled

- Auth distinguishes customers from employees when reading/updating profiles and passwords, including accounts with matching numeric IDs.
- JWTs require valid type/role claims and accounts are checked in the database on every request. Locked accounts or role/facility changes cause existing tokens to be rejected.
- `ADMIN` no longer bypasses endpoint role lists; `SUPER_ADMIN` must also be listed explicitly. Aliases are normalized against the supported roles.
- Cart, wishlist, customer order and customer review operations have guards that enforce the correct account type.
- `POST /admin/auth/setup` returns 410 without writing to the database. Provision the initial administrator through the DBA process; the development seed provides demo accounts.
- `JWT_SECRET` is required; the code has no fallback secret. Tokens without a type claim require the user to log in again.
- Auth transactions carry context but still use the existing connection role. Account RLS is not yet enforced at the database layer.

#### After enforcement is enabled on a configured database

`withAuth()` verifies that the role is not a superuser, does not have BYPASSRLS, does not own the tables, and that both account tables have ENABLE + FORCE RLS. Incomplete setup returns 503 instead of reverting to broader access. The transaction then uses `SET LOCAL ROLE auth_runtime` and sets every context field, including empty values for missing fields.

| Operation | Database access for `auth_runtime` |
|---|---|
| No actor and not a login/register operation | No account rows are visible |
| Customer login | Only the row matching the phone/email being checked |
| Employee login | Only the row matching the email being checked |
| Registration | Insert only five profile/credential columns with matching phone context; points/tier/status use defaults and are restricted by CHECK policies |
| Profile/password | Only the matching account type + ID; UPDATE is granted only for profile/password columns |
| Role/facility/status/points/ID | No permission to change these fields or assign them during insertion |
| Create/delete employees, delete customers, TRUNCATE | Not granted |

Auth does not use `SECURITY DEFINER` or database functions that return credentials. The backend reads credentials through parameterized, scoped login queries; HTTP responses do not contain hashes. The auth role can SELECT facility data to build employee profiles; this does not implement authorization for the entire facility module.

Custom settings are context supplied by the trusted server, not independent proof of identity. End users must not receive database credentials or permission to execute arbitrary SQL.

### Testing on a separate database

Run the following PowerShell commands from the repository root. The test database uses a separate temporary container/volume; do not substitute the application database name.

```powershell
docker run --detach --name pharmatrace-auth-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=auth_test_owner_only -e APP_DB_PASSWORD=auth_test_app_only -e POSTGRES_DB=pharmatrace_auth_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-auth-rls-test
```

Wait for `PostgreSQL init process complete; ready for start up.`. Check the fixtures before the tests create accounts:

```powershell
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_activate=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/03_auth_rls.sql

$authTestPort = (docker port pharmatrace-auth-rls-test 5432).Split(':')[-1]
$env:AUTH_RLS_TEST_DATABASE_URL = "postgresql://app_user:auth_test_app_only@127.0.0.1:$authTestPort/pharmatrace_auth_rls_test"
$env:AUTH_RLS_TEST_ADMIN_URL = "postgresql://postgres:auth_test_owner_only@127.0.0.1:$authTestPort/pharmatrace_auth_rls_test"

Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand --runTestsByPath src/common/guards/roles.guard.spec.ts src/modules/auth/strategies/jwt.strategy.spec.ts src/prisma/prisma.service.spec.ts
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/auth-rls.e2e-spec.ts
Pop-Location
```

E2E requires two explicit test URLs and accepts only localhost with the database name `pharmatrace_auth_rls_test`; it does not use `.env` as the target. Tests use real HTTP, Prisma and PostgreSQL, create/delete their own fixtures, and check lookups, row/column access, matching account IDs, stale tokens, passwords, registration, rollback context and concurrent requests. Without test variables, the suite is skipped; this is not a passing integration result.

Do not run other integration suites concurrently against this database: the tests temporarily change FORCE RLS and restore it to verify fail-closed behavior.

### Prerequisites for shared-database activation

- [ ] Finalize roles and business permissions; changing `ADMIN` does not complete authorization for every service.
- [ ] Move customer/employee queries in checkout, customer/employee management, reviews, facilities, cron and remaining modules to their designed access paths.
- [ ] Inspect the shared runtime role: it still has broad baseline grants. The auth script does not revoke all of them. A shared role with arbitrary actor context is not a replacement for operation-specific authorization.
- [ ] Inventory ownership, grants and policies on the target database. The script rejects unmanaged account policies, RLS enabled outside the script, and unexpectedly broad auth-role privileges.
- [ ] Establish a tracked SQL upgrade process for existing databases. Docker initialization does not upgrade existing volumes, and the script does not write `_prisma_migrations` records.
- [ ] Back up and test restoration; record the RLS/policy baseline. The rollback script supports only the pre-auth baseline with account RLS disabled.
- [ ] Run all regression and E2E suites for dependent modules on a copy of the target database.
- [ ] Configure a dedicated `JWT_SECRET`, not a sample value. Users must log in again to receive valid claims.

**Setting `AUTH_RLS_ENABLED=true` does not enable table RLS by itself. Running SQL alone does not migrate every module to the new role/context. Deploy both using the verified procedure.**

### Apply and roll back

Run `security/03_auth_rls.sql` as owner/DBA. Without the activation flag, it prepares only the NOLOGIN role, column grants and policies. With `-v auth_rls_activate=true`, it also enables/forces RLS. There is no unrestricted compatibility policy. On reapplication, it checks and replaces only its own policies; it does not replace unknown policies or disable existing enforcement.

Proceed only after completing the checklist, during a controlled deployment. Monitor errors and unexpected empty results, since RLS can filter rows without producing SQL errors.

The rollback script is `security/04_auth_rls_rollback.sql`, requires `-v auth_rls_rollback=true`, and is never called by master. It restores disabled RLS on the two account tables without deleting data or accounts. **Rollback restores broader baseline access**; it is not an automatic fallback and must not be used on a database with a different RLS design. The script refuses unknown policies and retains the NOLOGIN role to preserve dependencies.

To roll back: stop relevant traffic/jobs, set `AUTH_RLS_ENABLED=false`, apply the rollback script against the saved baseline, restart, and smoke test. Setting the flag to false alone does not disable database RLS; running the rollback while the flag remains true makes auth return 503.

Test rollback/reactivation on the test container, not the local application database:

```powershell
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_rollback=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/04_auth_rls_rollback.sql
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_activate=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/03_auth_rls.sql
```

After testing:

```powershell
docker rm --force pharmatrace-auth-rls-test
Remove-Item Env:AUTH_RLS_TEST_DATABASE_URL, Env:AUTH_RLS_TEST_ADMIN_URL
```

### Limitations and follow-up work

- This provides independently tested auth/RBAC foundations and account policies, not end-to-end authorization for the entire application.
- Password changes do not revoke every issued JWT. Logout requires the client to discard its token; this rollout has no token blacklist or token versioning. Account locks and role/facility changes are checked on every request.
- Employee details in public facility APIs, customer-management scope and dedicated admin-order context require work in their respective branches.
- Employee administration must not use the auth role intended for personal profile updates; the employee module needs its own principal/permission design.
- Keep `database/*.sh` files at LF through `.gitattributes` so Windows checkout does not break Linux initialization.

## Review RLS

`security/07_review_rls.sql` enables/forces RLS on `reviews`, `moderation_reports` and `moderation_audit_logs`. Master calls it automatically when Docker initializes a new volume. The backend continues using `app_user`, without new role memberships or `SECURITY DEFINER` functions.

| User | Access |
|---|---|
| Public | Read APPROVED reviews, statistics and product-detail reviews; helpful operations update only APPROVED review counters |
| Customer | Read own history; create reviews for matching DELIVERED/COMPLETED purchases; edit/delete own reviews; submit reports and read only own reports |
| STORE_MANAGER / PHARMACIST | Read all review statuses and reply; cannot change status, delete reviews, or view reports/audit; list responses omit customer email/phone |
| ADMIN / SUPER_ADMIN | Read, reply, approve/hide/mark spam/delete reviews; view and resolve reports; read audit logs |
| Other employee roles | Cannot access review administration or use matching customer IDs to access customer history |

Staff permissions apply system-wide, preserving the scope declared in the controllers; reviews do not have facility assignments. Public access can read APPROVED reviews without context; all writes and moderation reads require the appropriate scope. `withReview()` sets transaction-local context with `set_config(..., true)`, verifies that runtime is not a superuser/BYPASSRLS/table owner, and checks RLS on all three tables. Incomplete setup returns 503. Custom settings remain trusted backend context and do not protect against someone with `app_user` credentials or arbitrary SQL access.

Column grants and an invoker trigger prevent customers from modifying staff replies, ordinary staff from changing review status, and helpful operations from modifying content. Customer edits to reviews that are not APPROVED still require administrator approval; safe new reviews can still be approved by the existing automated moderation pipeline. Review/report mutations and audit writes share one transaction; audit failure rolls back the mutation. The app cannot UPDATE/DELETE/TRUNCATE audit logs. Deleting a review preserves audit rows with `review_id = NULL` and the original ID in `meta.reviewId`; old audit metadata is retained, and previously cascade-deleted records are not recovered.

### Existing database

The seed and review eligibility checks use uppercase `DELIVERED`/`COMPLETED`. The review RLS script does not update order statuses; legacy data found in other environments must be reconciled and normalized separately before deployment.

Do not rerun master/seed or delete the volume. Back up the database, test restoration, and try the script on a copy first. Stop relevant backend/jobs, apply the following file as owner/DBA, then start the backend with code from the same branch and smoke test the access matrix above:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/07_review_rls.sql
```

Use container/database names matching your environment. The script is transactional, can be reapplied, and rejects unknown policies or audit foreign keys for manual review. Changing the audit FK to SET NULL may wait for table locks; allow an appropriate maintenance window. Rolling back only the code is unsafe because old code does not supply review write context. If rollback is needed, stop traffic and restore matching code/grants/FKs/policies from the saved baseline; do not disable RLS automatically on errors.

Use the backend authentication configuration that matches the deployed account policies and test review visibility on a disposable database.

### Review-specific testing

Run from the repository root and wait for `PostgreSQL init process complete` before testing:

```powershell
docker run --detach --name pharmatrace-review-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=review_test_owner_only -e APP_DB_PASSWORD=review_test_app_only -e POSTGRES_DB=pharmatrace_review_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-review-rls-test

docker exec pharmatrace-review-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_review_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql -f /docker-entrypoint-initdb.d/tests/review_rls_test.sql
$reviewTestPort = (docker port pharmatrace-review-rls-test 5432).Split(':')[-1]
$env:REVIEW_RLS_TEST_DATABASE_URL = "postgresql://app_user:review_test_app_only@127.0.0.1:$reviewTestPort/pharmatrace_review_rls_test"
$env:REVIEW_RLS_TEST_ADMIN_URL = "postgresql://postgres:review_test_owner_only@127.0.0.1:$reviewTestPort/pharmatrace_review_rls_test"
Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/review-rls.e2e-spec.ts
Pop-Location

docker rm --force pharmatrace-review-rls-test
Remove-Item Env:REVIEW_RLS_TEST_DATABASE_URL, Env:REVIEW_RLS_TEST_ADMIN_URL
```

E2E accepts only the disposable localhost database named `pharmatrace_review_rls_test`; missing environment variables skip the suite rather than verify integration. It checks public/customer access, same-ID employees, moderators, purchase eligibility, reports/APPROVE, helpful votes, audit retention after deletion, rollback on audit failure, pooled connection context and 503 responses when FORCE RLS is missing. Do not run another suite concurrently against this database because the tests temporarily disable and restore FORCE. SQL tests use a transaction and ROLLBACK fixture data.

Helpful votes and rate limits still use IP/process-local memory; they do not provide vote-fraud prevention or synchronization across backend instances. Cloudinary image upload remains unchanged and is not called by this integration suite.

## Order / checkout RLS

`security/08_order_rls.sql` enables/forces RLS on `orders`, `order_items`, `shipments`, `internal_transfers` and `loyalty_point_logs`. It adds no logins/memberships and uses neither `BYPASSRLS` nor `app.bypass_rls`. `withOrder()` checks the runtime role and protection on all five tables; incomplete setup returns 503. Each transaction sets operation, user ID/type/role and facility through local settings, which are cleared at commit/rollback.

| Actor | Scope |
|---|---|
| Customer | Read own orders/items/shipments/transfers/points; checkout creates own orders; cancel only PENDING or WAITING_INTERNAL_TRANSFER orders |
| STORE_MANAGER / PHARMACIST / WAREHOUSE_STAFF | Read orders assigned to their `export_facility_id` |
| STORE_MANAGER / PHARMACIST | Change order status at the assigned facility according to the state machine; only pharmacists or SUPER_ADMIN can decide prescription reviews |
| STORE_MANAGER / PHARMACIST / WAREHOUSE_STAFF | Pack at the fulfillment facility and confirm UIDs for serialized medicine packages |
| STORE_MANAGER / WAREHOUSE_STAFF | Dispatch at the source; receive/reject damaged goods and create replacement transfers at the destination |
| SUPER_ADMIN | Perform order administration across the system under existing guards |
| Internal loyalty job | Read COMPLETED orders for eligibility and write the correct EARN amount; cannot modify orders or delete ledger rows |

`ADMIN` is not listed in the current order guards; its name does not grant global access. Review moderator scope does not grant order administration rights.

Source warehouses cannot read orders fulfilled by another facility or their prescriptions. Transfer list/dispatch responses omit nested `orders`. Two `SECURITY DEFINER` functions provide narrow projections: `transfer_order_state()` returns order/review statuses needed to dispatch the warehouse's own transfer; `product_has_order_history()` returns a boolean to prevent hard deletion of medicines with order history at other facilities. Both use a fixed search_path, check context, fully qualify table names, and revoke PUBLIC execution. Create them as a trusted DBA (the commands below use postgres); do not transfer ownership to app_user.

Column grants and triggers block changes to customer/facility, prices, totals, payment status through cancellation, and prescription status through the order API. The app cannot DELETE/TRUNCATE order tables or UPDATE/DELETE ledger rows. Point redemption/refunds/awards share a transaction with their associated operation; order locks and a unique EARN index per order prevent duplicate cron awards. Conditional transfer receipt prevents duplicate stock movements, and packing locks the order to prevent duplicate shipments.

The ledger constraint adds `EARN_REVERSAL`, which the backend already uses for returns. If the target contains multiple EARN/EARNED records for one order or unsupported transaction types, the script stops and rolls back. Reconcile those records first; do not delete ledger entries automatically.

Dependent queries also carry identity: customer-management order history/statistics, prescription decisions and medicine-deletion history checks. GET order details no longer creates prescription review rows; legacy orders missing reviews require a verified DBA backfill before rollout. Checkout continues creating prescription reviews within its transaction.

### Applying to an existing database

Back up and test restoration, then run tests against a copy. Stop relevant backend/jobs, apply as owner/DBA, then start matching backend code and smoke test checkout, cancellation, packing, transfers, prescriptions and cron:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/08_order_rls.sql
```

Use container/database names matching your environment. The script is transactional, refuses unknown policies and can be reapplied. It replaces the two earlier prescription order policies with shared order policies; do not rerun only `02_prescription_rls.sql` after this rollout. Do not rerun master/seed or delete the volume to upgrade. New volumes receive script 08 from master after the preceding scripts.

This script does not enable RLS for inventories/medicine boxes, vouchers or account/point balances; checkout still needs their existing baseline grants. Context is supplied by the trusted server and does not protect against someone holding app_user credentials or executing arbitrary SQL. This is not complete database-wide authorization. To roll back, stop traffic/jobs and restore matching code/policies/grants/constraints from the saved baseline; do not disable RLS automatically to bypass errors.

### Testing on a separate database

From the repository root, create a temporary container and wait for `PostgreSQL init process complete`:

```powershell
docker run --detach --name pharmatrace-order-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=order_test_owner_only -e APP_DB_PASSWORD=order_test_app_only -e POSTGRES_DB=pharmatrace_order_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-order-rls-test
docker exec pharmatrace-order-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_order_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql -f /docker-entrypoint-initdb.d/tests/order_rls_test.sql

$orderTestPort = (docker port pharmatrace-order-rls-test 5432).Split(':')[-1]
$env:ORDER_RLS_TEST_DATABASE_URL = "postgresql://app_user:order_test_app_only@127.0.0.1:$orderTestPort/pharmatrace_order_rls_test"
$env:ORDER_RLS_TEST_ADMIN_URL = "postgresql://postgres:order_test_owner_only@127.0.0.1:$orderTestPort/pharmatrace_order_rls_test"
Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/order-rls.e2e-spec.ts
Pop-Location

docker rm --force pharmatrace-order-rls-test
Remove-Item Env:ORDER_RLS_TEST_DATABASE_URL, Env:ORDER_RLS_TEST_ADMIN_URL
```

The suite accepts only the localhost database named `pharmatrace_order_rls_test`; missing test variables skip the suite rather than verify integration. Do not run another suite concurrently on the same database: tests temporarily revoke ledger grants or disable FORCE to check rollback/fail-closed behavior, restoring them in finally blocks. Tests use GPS fixtures and do not call external geocoding/Cloudinary services. SQL tests roll back fixture data; HTTP tests clean up their own fixtures.

## Voucher RLS

`security/09_voucher_rls.sql` enables and forces RLS on `vouchers`, independently of `AUTH_RLS_ENABLED`. It uses the existing `app_user`, invoker functions and an update trigger; no additional login, role membership or `SECURITY DEFINER` function is introduced.

| Actor / operation | Access |
|---|---|
| Public `POST /vouchers/validate` | Read only the exact supplied code, case-insensitively; the service checks status, dates, capacity and subtotal and returns the discount preview without consuming usage |
| SUPER_ADMIN / STORE_MANAGER | List, create and edit global vouchers; delete only unused vouchers without order history; never directly edit the usage counter |
| PHARMACIST | Read-only voucher administration |
| Other employee roles, ADMIN, customers | No voucher administration under the current endpoint role lists |
| Customer checkout | Lock the selected voucher, create an owned order, and increment only its usage counter within the same transaction |

Vouchers have no facility ownership column, so management remains global. No facility or per-customer eligibility model is inferred from the employee role. `withVoucher()` validates the actor and scope, verifies ENABLE/FORCE and the restricted runtime role, and sets transaction-local code/scope/identity context. Missing protection returns 503. Public previews cannot list other codes or modify rows. Invalid or inactive codes keep the existing 404/400 responses.

`POST /vouchers/apply` now returns **410 Gone**. The checkout page already uses `/vouchers/validate`; its unused standalone-consumption helper has been removed. Consumers outside this repository must preview through validate and place orders through `POST /orders`.

`orders.voucher_id` records the voucher used by new orders, with a RESTRICT foreign key. Existing orders keep NULL because their original voucher cannot be inferred reliably from a discount amount. The trigger permits checkout to change only `used_quantity`, by exactly +1, for a matching owned PENDING/WAITING_INTERNAL_TRANSFER order with the correct subtotal and discount. Checkout rejects unavailable or changed voucher terms and rolls back stock, points, cart cleanup, the order and consumption together when any write fails. Concurrent checkouts cannot exceed the usage limit. Cancellation continues to retain the consumed use, as before; this change does not add per-customer limits or make order placement idempotent.

Every voucher requires a start and end date in chronological order; percentage discounts also require a positive maximum discount. Fixed discounts do not require a cap. Before applying 09 to an existing database, reconcile vouchers missing dates or a positive percentage cap; the script fails without modifying data if any are invalid. Management validates percentage bounds, dates and capacity, cannot reduce the limit below existing usage, and cannot reset the counter. Deactivate used vouchers instead of deleting them. A normalized-code unique index prevents duplicate codes differing only in case or surrounding spaces. Existing duplicate codes or invalid terms stop the script for reconciliation rather than being silently rewritten. Runtime cannot TRUNCATE vouchers, change IDs, or reset their sequence.

### Existing-database deployment

Back up and test restoration, inspect existing policies/data, and run the suites on a copy first. Stop the backend/jobs, apply the SQL as owner/DBA, generate the Prisma client, then start the matching backend and smoke test preview, administration and checkout:

```powershell
docker exec phartrace-vn-db psql -X -v ON_ERROR_STOP=1 -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/security/09_voucher_rls.sql
Push-Location pharmatrace-vn-backend
npx prisma generate
Pop-Location
```

Use the correct container/database names. Deploy this script after 08: it also grants order insertion of `voucher_id`, which the earlier order grant list does not include. The script is transactional, can be reapplied, and refuses unknown voucher policies or an incompatible existing voucher FK. Do not rerun master/seed or reset the volume. New volumes receive 09 automatically from master. Old code performs unscoped voucher queries and must not serve traffic after enforcement; new code requires the new column and policies. Roll back code/schema/grants/policies together from a saved baseline rather than automatically disabling RLS. Configure backend authentication to match the deployed account policies.

### Isolated voucher tests

Run from the repository root and wait for `PostgreSQL init process complete` before testing:

```powershell
docker run --detach --name pharmatrace-voucher-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=voucher_test_owner_only -e APP_DB_PASSWORD=voucher_test_app_only -e POSTGRES_DB=pharmatrace_voucher_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-voucher-rls-test
docker exec pharmatrace-voucher-rls-test psql -X -v ON_ERROR_STOP=1 -U postgres -d pharmatrace_voucher_rls_test -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql -f /docker-entrypoint-initdb.d/tests/voucher_rls_test.sql

$voucherTestPort = (docker port pharmatrace-voucher-rls-test 5432).Split(':')[-1]
$env:VOUCHER_RLS_TEST_DATABASE_URL = "postgresql://app_user:voucher_test_app_only@127.0.0.1:$voucherTestPort/pharmatrace_voucher_rls_test"
$env:VOUCHER_RLS_TEST_ADMIN_URL = "postgresql://postgres:voucher_test_owner_only@127.0.0.1:$voucherTestPort/pharmatrace_voucher_rls_test"
Push-Location pharmatrace-vn-backend
npm.cmd test -- --runInBand
npm.cmd run test:e2e -- --runInBand --runTestsByPath test/voucher-rls.e2e-spec.ts
Pop-Location

docker rm --force pharmatrace-voucher-rls-test
Remove-Item Env:VOUCHER_RLS_TEST_DATABASE_URL, Env:VOUCHER_RLS_TEST_ADMIN_URL
```

The suite requires explicit localhost URLs and the exact database name `pharmatrace_voucher_rls_test`; it does not use `.env` as a target. Without test URLs it skips rather than verifies integration. It covers role boundaries, exact-code reads, standalone-consumption rejection, terms, duplicate codes, capped discounts, last-use concurrency, stale configuration, atomic rollback, order linkage, protected columns and fail-closed behavior. Do not run another suite on the same database concurrently: one test temporarily revokes ledger grants and another temporarily disables FORCE, restoring both in finally blocks.

Securability notes: **Confidentiality** limits public reads to a supplied code; **Integrity** binds consumption to checkout and protects counters; **Testability** verifies both allowed and denied paths with the real runtime role. Context remains trusted server data, not independent authentication against someone with backend database credentials or arbitrary SQL access.

## Facility RLS

`security/10_facility_rls.sql` enables and forces RLS on `facilities`. Existing public facility reads remain available to the application and auth runtime. Facility creation, update and deletion require an authenticated SUPER_ADMIN through transaction-local context; the application checks that RLS is enabled and forced before writes. The runtime cannot truncate facilities, reset the ID sequence or update IDs. Context relies on a trusted backend and is not a defense against arbitrary SQL using app_user credentials.

This policy covers facilities only: inventories, batches and related stock data are not protected by this script. Product and cart stock reads and checkout/transfer writes require a separate cross-module authorization design. Existing public facility detail responses also include employee information and counts from other tables; facility RLS does not protect those joined records. Review that endpoint and employee authorization separately.

For an existing database, back up and test a copy, stop backend traffic, apply 10 after 03 and 09 with an owner connection, then deploy matching backend code. The script is transactional and refuses unknown facility policies. New Docker volumes apply it through master init; existing volumes do not automatically rerun initialization. Roll back policies, grants and code together from a saved baseline.

`database/tests/facility_rls_test.sql` tests public reads, role boundaries and restricted privileges. The HTTP integration test requires explicit localhost URLs `FACILITY_RLS_TEST_DATABASE_URL` and `FACILITY_RLS_TEST_ADMIN_URL` for a disposable database named exactly `pharmatrace_facility_rls_test`. It temporarily disables FORCE and restores it in a finally block; do not run other suites on that database concurrently.

## Employee RLS

`security/11_employee_rls.sql` enables and forces RLS on employees after the auth policies in 03 and facility security in 10. SUPER_ADMIN manages all employees through transaction-local management context. After applying security/14_employee_facility_rls.sql, STORE_MANAGER may manage PHARMACIST and WAREHOUSE_STAFF accounts only at their assigned facility; managers cannot assign elevated roles or move staff across facilities. Other staff retain self profile and exact-email login access through the existing auth policies. Profile writes cannot change roles, facilities, status or other protected columns. Public unscoped facility queries no longer expose employee rows; facility administration can count employees before deletion. Employee management fails closed until the facility-scoped policy is present.

Apply 11 and then 14 with an owner connection to a backed-up test copy first, stop traffic, then deploy matching backend and policies together. Configure backend authentication to match the deployed account policies; employee RLS is enforced independently. Never rerun base grants after restricted scripts. Context trusts the backend; app_user credentials and arbitrary SQL must remain private. Rollback requires restoring the saved policies/grants and matching code. Existing 03 policy preflight intentionally rejects rerunning auth setup over additional employee policies.

SQL checks: `tests/employee_rls_test.sql` and `tests/employee_facility_rls_test.sql`. HTTP tests require explicit localhost EMPLOYEE_RLS_TEST_DATABASE_URL and EMPLOYEE_RLS_TEST_ADMIN_URL targeting only the disposable database pharmatrace_employee_rls_test. They cover login, administration, profile writes, privilege escalation and missing FORCE. Do not run other suites on that database concurrently.

## Customer RLS

`security/12_customer_rls.sql` enables and forces RLS for customers after the existing auth, order, review and employee policies. Customers can access their own account through the auth context. SUPER_ADMIN manages customers globally; STORE_MANAGER can access and change status only for customers with an order visible at their facility; PHARMACIST has read-only access to the same scope. Account profiles cannot directly change status or reward points. Existing order operations handle loyalty changes within their scoped transactions. Review moderators can access customers attached to reviews; staff remain limited by customer facility scope. Public review responses may show the existing anonymous-name fallback because public sessions cannot read customer rows.

Apply 12 on a tested backup with an owner connection, while backend traffic is stopped, before starting matching code. New Docker volumes apply it through master initialization; existing volumes do not automatically rerun it. Do not rerun base grants after security scripts. Configure backend authentication to match the deployed account policies. Context relies on the trusted backend and does not protect against arbitrary SQL executed with app_user credentials. Back up policies, grants and code together for rollback. The auth setup script's preflight rejects later policies if rerun.

`tests/customer_rls_test.sql` and `test/customer-rls.e2e-spec.ts` use disposable databases. The integration test requires explicit localhost CUSTOMER_RLS_TEST_DATABASE_URL and CUSTOMER_RLS_TEST_ADMIN_URL for a database named exactly pharmatrace_customer_rls_test.

## Catalog RLS

`security/13_catalog_rls.sql` enables and forces RLS on medicines, categories, packaging_variants and medicine_categories. Existing app_user catalog reads remain public; SUPER_ADMIN and STORE_MANAGER can manage catalog rows through transaction-local context. Runtime cannot truncate tables, update IDs or reset sequences. Product and category writes run in transactions so related writes roll back together on failure. Inventory tables are outside this policy. Existing public read behavior, including status filtering in the API, is not changed by this script.

Test a backup first and stop application traffic before applying 13 with an owner connection and deploying matching backend code. New Docker volumes apply it through master init; existing volumes do not rerun initialization. Do not reapply base broad grants after restricted scripts. Database context is supplied by a trusted backend; arbitrary SQL using app_user credentials can forge it. Restore policies, grants and code together from a saved baseline for rollback.

Run `tests/catalog_rls_test.sql` and `test/catalog-rls.e2e-spec.ts` against disposable databases. The HTTP test requires explicit localhost CATALOG_RLS_TEST_DATABASE_URL and CATALOG_RLS_TEST_ADMIN_URL targeting exactly pharmatrace_catalog_rls_test.

## Manufacturer RLS and Existing Databases

`security/15_manufacturer_rls.sql` applies manufacturer policies and prevents employee assignment to external manufacturer records. New databases receive it through master initialization. `tests/manufacturer_rls_test.sql` checks permitted and denied access in a rolled-back transaction.

Existing volumes do not update automatically. For an older database, prepare and test a data-specific upgrade after backing up and reviewing existing relationships. Applying the RLS script alone does not upgrade the schema or clean historical data.
