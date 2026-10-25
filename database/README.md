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
│   ├── 02_prescription_rls.sql     # Prescription grants and access policies
│   ├── 03_auth_rls.sql             # Auth role/policies; enforcement opt-in
│   ├── 04_auth_rls_rollback.sql    # Manual rollback, never called by master
│   └── 05_wishlist_rls.sql         # Enforced customer wishlist ownership
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
    └── wishlist_rls_test.sql       # Wishlist allow/deny checks, rolled back
```

`backups/` contains ignored local database dumps. Master initialization includes both prescription and auth security scripts. Auth role/policies are prepared automatically; account RLS enforcement stays off until dependent modules are ready. Read [Auth RLS rollout](#auth-rls-rollout) before activation. These bootstrap scripts do not track applied versions or update existing Docker volumes automatically.

## Docker Development Setup

From the repository root, copy `.env.example` to `.env` and `pharmatrace-vn-backend/.env.example` to `pharmatrace-vn-backend/.env`. Set `APP_DB_PASSWORD` in the root `.env`, then use the same password in the backend `DATABASE_URL` for `app_user`. If it contains URL-reserved characters, encode them in `DATABASE_URL`. Add your own Cloudinary credentials to the backend `.env`. Do not commit either `.env` file.

On a new database volume, `docker compose up -d db` creates the restricted `app_user` role, loads the schema and seed data, grants application table privileges, and applies prescription RLS through `00_master_init.sql`.

The PostgreSQL image runs initialization scripts only when its data directory is empty. Existing volumes do not rerun them. Keep the versioned schema and RLS files in Git so new clones receive the same database setup. Do not remove the volume to rerun initialization unless its data can be discarded.

Run the fixture checks on a freshly initialized database, then the RLS checks:

```powershell
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/development_seed_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/prescription_rls_test.sql
docker exec phartrace-vn-db psql -U postgres -d phartrace-vn-db -f /docker-entrypoint-initdb.d/tests/wishlist_rls_test.sql
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
7. `security/03_auth_rls.sql` prepares auth roles, column grants and policies. It does not enable account RLS unless explicitly invoked with `auth_rls_activate=true`. Master never runs the rollback script.
8. `security/05_wishlist_rls.sql` restricts `app_user` to SELECT/INSERT/DELETE and enables/forces customer ownership policies on `customer_wishlists`.

All tables must exist before importing the seed. Review grants are explicitly restricted after import so blanket or default privileges cannot add DELETE/TRUNCATE access. The SQL files are intended to run as `postgres` through `psql`.

---

## Maintenance Notes

- Keep schema changes consistent with `pharmatrace-vn-backend/prisma/schema.prisma`.
- Prescription RLS is scoped to the current prescription workflow; this setup does not provide database-wide tenant isolation.
- The seed contains synthetic account and personal fields alongside catalog and operational fixtures. Foreign-key triggers remain enabled during import. It is not a production provisioning script.
- Some seed text already contains corrupted characters. Repair it from a verified source rather than guessing replacements.
- Existing databases need an explicit upgrade procedure for schema changes, including the `REDEEM_REVERSAL` constraint and review grants. Editing bootstrap files alone does not update an existing Docker volume.

## Wishlist RLS

Wishlist RLS is enabled automatically on a new Docker database, independently of `AUTH_RLS_ENABLED`. Keep that auth flag false on the shared application database until the account-dependent modules are ready.

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

To verify compatibility with future account RLS, activate `security/03_auth_rls.sql` **on this disposable database only**, set `WISHLIST_RLS_TEST_AUTH_ENABLED=true` in the test shell, and rerun the same suite. No other integration suite should share this test database concurrently.

After testing:

```powershell
docker rm --force pharmatrace-wishlist-rls-test
Remove-Item Env:WISHLIST_RLS_TEST_DATABASE_URL, Env:WISHLIST_RLS_TEST_ADMIN_URL
Remove-Item Env:WISHLIST_RLS_TEST_AUTH_ENABLED -ErrorAction SilentlyContinue
```

## Auth RLS rollout

Nhánh triển khai: `feature/auth-rbac`. Ngày: 25/10/2026.

### Trạng thái rollout

**Docker tự chuẩn bị role và policy auth khi khởi tạo database mới**, qua `security/03_auth_rls.sql` được master gọi. Script mặc định không ENABLE/FORCE RLS trên hai bảng tài khoản. `AUTH_RLS_ENABLED` của backend vẫn mặc định là `false`.

Chuẩn bị policy và bật cưỡng chế là hai bước khác nhau. Prescription có thể bật ngay vì luồng tương ứng đã được chuyển đổi; customers/employees còn được nhiều module chưa có context sử dụng. Không xóa volume đang có dữ liệu để ép Docker chạy lại init.

Chỉ bật trên database dùng chung sau khi các module còn lại đã chuyển sang context/role phù hợp. Không thêm policy mở toàn bảng để tránh lỗi: điều đó sẽ vô hiệu hóa cách ly dữ liệu cần triển khai.

#### Khi chưa bật

- Auth đã phân biệt customer/employee khi đọc/sửa hồ sơ và mật khẩu, kể cả khi trùng ID.
- JWT yêu cầu type/role hợp lệ và kiểm tra lại tài khoản trong database mỗi request; tài khoản khóa, role hoặc facility thay đổi làm token bị từ chối.
- `ADMIN` không còn vượt mọi danh sách role; `SUPER_ADMIN` cũng phải được liệt kê trên endpoint. Alias được chuẩn hóa theo danh sách role hỗ trợ.
- Cart, wishlist, customer order và các thao tác review của khách có guard kiểm tra đúng loại tài khoản.
- API `POST /admin/auth/setup` trả 410 và không ghi database. Quản trị ban đầu phải được tạo qua quy trình DBA; seed development đã có tài khoản demo.
- `JWT_SECRET` phải được cấu hình; không còn fallback secret trong code. Token thiếu type phải đăng nhập lại.
- Transaction auth truyền context nhưng vẫn dùng role kết nối cũ. Đây chưa phải RLS bảo vệ tài khoản ở tầng database.

#### Khi bật trên database đã cấu hình auth RLS

`withAuth()` kiểm tra role không phải superuser/BYPASSRLS/owner và hai bảng tài khoản đã ENABLE + FORCE RLS. Nếu chưa sẵn sàng, request trả 503, không âm thầm quay về truy cập rộng. Sau đó transaction dùng `SET LOCAL ROLE auth_runtime` và đặt đủ các trường context, kể cả giá trị rỗng khi thiếu.

| Thao tác | Quyền database của `auth_runtime` |
|---|---|
| Thiếu actor và không phải login/register | Không đọc được dòng tài khoản nào |
| Đăng nhập khách | Chỉ dòng khớp phone/email đang được kiểm tra |
| Đăng nhập nhân viên | Chỉ dòng khớp email đang được kiểm tra |
| Đăng ký | Chỉ insert năm cột hồ sơ/credential, đúng phone context; điểm/tier/status dùng default và bị CHECK policy giới hạn |
| Hồ sơ/mật khẩu | Chỉ tài khoản đúng type + ID; chỉ các cột hồ sơ/mật khẩu được cấp UPDATE |
| Role/facility/status/điểm/ID | Không có quyền tự sửa hoặc tự gán khi insert |
| Tạo/xóa nhân viên, xóa khách, TRUNCATE | Không được cấp |

Không dùng `SECURITY DEFINER` hoặc hàm database trả credential. Credential được backend đọc qua truy vấn login có tham số và scope; response HTTP không chứa hash. Role auth có SELECT cơ sở để dựng profile nhân viên; đây chưa phải thiết kế phân quyền toàn bộ module facility.

Các custom settings là context do server tin cậy truyền xuống, không phải bằng chứng danh tính độc lập. Không để người dùng cuối có credential database hoặc quyền gửi SQL tùy ý.

### Kiểm thử trên database riêng

Các lệnh sau dùng PowerShell tại root dự án. Database test là container/volume tạm riêng; không thay tên thành database đang dùng.

```powershell
docker run --detach --name pharmatrace-auth-rls-test --publish 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data -e POSTGRES_PASSWORD=auth_test_owner_only -e APP_DB_PASSWORD=auth_test_app_only -e POSTGRES_DB=pharmatrace_auth_rls_test --mount "type=bind,source=$($PWD.Path)\database,target=/docker-entrypoint-initdb.d,readonly" postgres:15-alpine
docker logs pharmatrace-auth-rls-test
```

Chờ thông báo `PostgreSQL init process complete; ready for start up.`. Chạy kiểm tra fixture trước khi các test tạo tài khoản:

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

E2E yêu cầu hai URL test riêng, chỉ chấp nhận localhost với database tên `pharmatrace_auth_rls_test`, không dùng `.env` làm target. Test dùng HTTP, Prisma và PostgreSQL thật; tạo/xóa fixture riêng, kiểm tra lookup, quyền dòng/cột, ID trùng nhau, token cũ, password, đăng ký, context sau rollback và request đồng thời. Nếu không có biến test, suite này được skip; đó không phải kết quả pass integration.

Không chạy các integration suite khác đồng thời trên cùng database này: test có bước chủ động thay FORCE RLS rồi khôi phục để kiểm tra fail-closed.

### Điều kiện trước khi kích hoạt trên database dùng chung

- [ ] Chốt role và các quyền nghiệp vụ liên quan; thay đổi `ADMIN` không được xem là phân quyền xong mọi service.
- [ ] Chuyển các truy vấn customers/employees của checkout, quản lý khách/nhân viên, review, facility, cron và các module còn lại sang đường truy cập được thiết kế.
- [ ] Kiểm tra role runtime chung: nó vẫn có các grants nền rộng từ trước; script auth không tuyên bố thu hồi toàn bộ quyền đó. Không dùng role chung với actor tùy ý để thay thế phân quyền theo chức năng.
- [ ] Kiểm kê ownership, grants và policy trên database đích. Script từ chối policy tài khoản không thuộc nó, RLS đã bật ngoài script và role auth có quyền rộng hơn dự kiến.
- [ ] Với database hiện hữu, có quy trình cập nhật SQL được theo dõi. Docker init không tự nâng cấp volume cũ và script không tự ghi `_prisma_migrations`.
- [ ] Backup và thử restore; lưu trạng thái RLS/policy trước thay đổi. Rollback script chỉ dành cho baseline trước auth có RLS tài khoản tắt.
- [ ] Chạy toàn bộ regression và E2E của các module phụ thuộc trên bản sao database đích.
- [ ] Cấu hình `JWT_SECRET` riêng, không dùng giá trị mẫu. Người dùng đăng nhập lại để có claim hợp lệ.

**Chỉ đổi `AUTH_RLS_ENABLED=true` không tự bật RLS trên bảng. Chỉ chạy SQL cũng không chuyển toàn bộ module sang role/context mới. Phải triển khai cả hai theo hướng dẫn đã được kiểm chứng.**

### Áp dụng và quay lui

Script `security/03_auth_rls.sql` chạy bằng owner/DBA. Không có cờ kích hoạt thì chỉ chuẩn bị role không login, grants theo cột và policy. Có `-v auth_rls_activate=true` thì thêm bước ENABLE/FORCE RLS. Không có policy compatibility mở toàn bảng. Nếu chạy lại, nó kiểm tra và thay lại các policy do chính script quản lý; không thay policy lạ và không tự tắt RLS đang bật.

Chỉ thực hiện sau khi checklist trên hoàn tất, trong đợt triển khai có kiểm soát. Theo dõi cả lỗi lẫn dữ liệu rỗng bất thường, vì RLS có thể lọc dòng mà không phát sinh lỗi SQL.

Rollback script: `security/04_auth_rls_rollback.sql`, yêu cầu `-v auth_rls_rollback=true` và không được master gọi. Nó khôi phục baseline RLS tắt trên hai bảng, không xóa dữ liệu/tài khoản. **Quay lui làm mở lại phạm vi truy cập nền**, không dùng như fallback tự động và không chạy nếu database có thiết kế RLS khác. Script từ chối policy lạ và giữ role không login để không phá dependency.

Để quay lui: ngừng traffic/job liên quan, đặt `AUTH_RLS_ENABLED=false`, áp dụng rollback script theo baseline đã lưu, khởi động lại và smoke test. Chỉ đặt flag false không tắt RLS trong database; chỉ chạy rollback trong khi flag true sẽ làm auth trả 503.

Thử rollback/kích hoạt lại trên container test, không trên database local:

```powershell
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_rollback=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/04_auth_rls_rollback.sql
docker exec pharmatrace-auth-rls-test psql -X -v ON_ERROR_STOP=1 -v auth_rls_activate=true -U postgres -d pharmatrace_auth_rls_test -f /docker-entrypoint-initdb.d/security/03_auth_rls.sql
```

Sau kiểm thử:

```powershell
docker rm --force pharmatrace-auth-rls-test
Remove-Item Env:AUTH_RLS_TEST_DATABASE_URL, Env:AUTH_RLS_TEST_ADMIN_URL
```

### Giới hạn và công việc nối tiếp

- Đây là nền auth/RBAC và policy tài khoản đã kiểm thử độc lập, chưa phải phân quyền end-to-end toàn ứng dụng.
- Password change chưa thu hồi mọi JWT đã cấp; logout yêu cầu client bỏ token, không có blacklist/token-version trong đợt này. Khóa tài khoản và thay role/facility được kiểm tra mỗi request.
- Thông tin nhân viên trong API facility public, scope quản lý khách hàng và context riêng của admin order vẫn cần được xử lý ở các nhánh tương ứng.
- Quyền quản trị nhân viên không đi qua role auth chỉ sửa hồ sơ cá nhân; cần thiết kế principal/quyền riêng trong module employee.
- Giữ `database/*.sh` ở LF theo `.gitattributes` để checkout Windows không làm hỏng bootstrap Linux.

