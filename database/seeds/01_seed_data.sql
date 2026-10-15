-- Seeds: 01_seed_data.sql
-- Default Initial Data for PharmaTrace VN Platform (Synchronized with Prisma Schema)

-- 1. Categories
INSERT INTO public.categories (id, category_name, slug, description, icon) VALUES
(1, 'Kháng sinh & Kháng khuẩn', 'khang-sinh-khang-khuan', 'Thuốc kê đơn kháng sinh, kháng khuẩn đường hô hấp, tiêu hóa', 'ShieldAlert'),
(2, 'Giảm đau & Hạ sốt', 'giam-dau-ha-sot', 'Các sản phẩm hạ sốt, giảm đau nhanh', 'HeartPulse'),
(3, 'Tim mạch & Huyết áp', 'tim-mach-huyet-ap', 'Thuốc điều trị tăng huyết áp và sức khỏe tim mạch', 'Activity'),
(4, 'Tiêu hóa & Dạ dày', 'tieu-hoa-da-day', 'Men vi sinh, thuốc kháng acid và điều trị viêm loét', 'Stomach'),
(5, 'Vitamin & Thực phẩm chức năng', 'vitamin-thuc-pham-chuc-nang', 'Viên uống bổ sung khoáng chất, vitamin tăng đề kháng', 'Sun')
ON CONFLICT (id) DO NOTHING;

-- 2. Facilities
INSERT INTO public.facilities (id, facility_name, facility_type, address, phone_number, email, latitude, longitude) VALUES
(1, 'PharmaTrace Central Manufacturing Plant', 'MANUFACTURER', 'Lot A1, Saigon Hi-Tech Park, District 9, Ho Chi Minh City', '02838901234', 'plant@pharmatrace.vn', 10.8544, 106.7850),
(2, 'Northern Central Logistics Hub', 'CENTRAL_WAREHOUSE', 'Km 12, Thang Long Boulevard, Hanoi', '02439876543', 'wh-north@pharmatrace.vn', 21.0023, 105.7489),
(3, 'Southern Logistics Warehouse', 'BRANCH_WAREHOUSE', 'Tan Binh Industrial Park, Ho Chi Minh City', '02837654321', 'wh-south@pharmatrace.vn', 10.8123, 106.6345),
(4, 'PharmaTrace Flagship Pharmacy #01', 'PHARMACY', '123 Nguyen Hue Boulevard, District 1, Ho Chi Minh City', '02839123456', 'store01@pharmatrace.vn', 10.7745, 106.7032)
ON CONFLICT (id) DO NOTHING;

-- 3. Customers (Password: password123)
INSERT INTO public.customers (id, full_name, email, phone_number, password_hash, membership_tier, reward_points, default_address, status) VALUES
(1, 'Customer Demo', 'customer@pharmatrace.vn', '0934567890', '$2b$10$ezRZa8qqG9LRh3.t0he14eSqbI5A7SIrpBXXB3FSwF8.d5vlU5k9W', 'GOLD', 1250, '456 Le Loi, District 1, Ho Chi Minh City', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 4. Employees (Password: password123)
INSERT INTO public.employees (id, full_name, email, password_hash, role, facility_id, job_title, status) VALUES
(1, 'Admin User', 'admin@pharmatrace.vn', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'SUPER_ADMIN', 1, 'SuperAdmin', 'ACTIVE'),
(2, 'Store Manager', 'storemanager@pharmatrace.vn', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'STORE_MANAGER', 4, 'Store Manager', 'ACTIVE'),
(3, 'Pharmacist', 'pharmacist@pharmatrace.vn', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'PHARMACIST', 4, 'Pharmacist', 'ACTIVE'),
(4, 'Warehouse Staff', 'warehouse@pharmatrace.vn', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'WAREHOUSE_STAFF', 3, 'Warehouse Staff', 'ACTIVE'),
(5, 'Factory Warehouse Staff', 'factorywarehouse@pharmatrace.vn', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'FACTORY_WAREHOUSE_STAFF', 1, 'Factory Warehouse Staff', 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 5. Medicines Catalog
INSERT INTO public.medicines (id, medicine_name, slug, registration_number, active_ingredients, dosage, manufacturer, country_of_origin, unit_price, promotional_price, image_url, short_description, is_prescription, status) VALUES
(1, 'Paracetamol Extra 500mg', 'paracetamol-extra-500mg', 'VD-24501-22', 'Paracetamol 500mg, Caffeine 65mg', '500mg', 'PharmaTrace Pharma Joint Stock Co', 'Vietnam', 45000, 42000, '/medicines/paracetamol.png', 'Giảm đau nhanh, hạ sốt hiệu quả cho người lớn và trẻ em trên 12 tuổi.', FALSE, 'ACTIVE'),
(2, 'Amoxicillin Trihydrate 500mg', 'amoxicillin-trihydrate-500mg', 'VN-18234-20', 'Amoxicillin 500mg', '500mg', 'GlaxoSmithKline (GSK)', 'United Kingdom', 95000, 89000, '/medicines/amoxicillin.png', 'Kháng sinh phổ rộng điều trị nhiễm khuẩn đường hô hấp, tai mũi họng.', TRUE, 'ACTIVE'),
(3, 'Omeprazole Delayed-Release 20mg', 'omeprazole-delayed-release-20mg', 'VD-31205-23', 'Omeprazole 20mg', '20mg', 'AstraZeneca', 'Sweden', 120000, 110000, '/medicines/omeprazole.png', 'Thuốc ức chế bơm proton giảm tiết acid dịch vị dạ dày.', TRUE, 'ACTIVE'),
(4, 'Effervescent Vitamin C 1000mg + Zinc', 'effervescent-vitamin-c-1000mg-zinc', 'VD-11029-21', 'Ascorbic Acid 1000mg, Zinc Sulfate 10mg', '1000mg', 'Bayer Healthcare', 'Germany', 85000, 78000, '/medicines/vitaminc.png', 'Viên sủi tăng cường hệ miễn dịch và giảm mệt mỏi.', FALSE, 'ACTIVE'),
(5, 'Atorvastatin Calcium 20mg', 'atorvastatin-calcium-20mg', 'VN-29012-21', 'Atorvastatin 20mg', '20mg', 'Pfizer Inc.', 'United States', 210000, 195000, '/medicines/atorvastatin.png', 'Điều trị rối loạn lipid máu và phòng ngừa bệnh tim mạch.', TRUE, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 6. Packaging Variants
INSERT INTO public.packaging_variants (id, medicine_id, unit_name, price, original_price, is_base_unit) VALUES
(1, 1, 'Box', 42000, 45000, TRUE),
(2, 1, 'Blister', 15000, 15000, FALSE),
(3, 2, 'Box', 89000, 95000, TRUE),
(4, 3, 'Box', 110000, 120000, TRUE),
(5, 4, 'Tube', 78000, 85000, TRUE),
(6, 5, 'Box', 195000, 210000, TRUE)
ON CONFLICT (id) DO NOTHING;

-- 7. Medicine Categories Mapping
INSERT INTO public.medicine_categories (medicine_id, category_id, is_primary) VALUES
(1, 2, TRUE),
(2, 1, TRUE),
(3, 4, TRUE),
(4, 5, TRUE),
(5, 3, TRUE)
ON CONFLICT (medicine_id, category_id) DO NOTHING;

-- 8. Batches
INSERT INTO public.batches (id, batch_number, medicine_id, manufacturer_id, production_date, expiry_date, initial_quantity, remaining_quantity, status) VALUES
(1, 'LOT-PARA-202601', 1, 1, '2026-01-10', '2028-01-10', 5000, 4850, 'ACTIVE'),
(2, 'LOT-AMOX-202602', 2, 1, '2026-02-15', '2028-02-15', 3000, 2900, 'ACTIVE'),
(3, 'LOT-OMEP-202603', 3, 1, '2026-03-01', '2028-03-01', 2000, 2000, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;

-- 9. Sample Box UIDs
INSERT INTO public.medicine_boxes (uid, batch_id, current_facility_id, status) VALUES
('b1029cf3-0246-4e38-8159-7c2422b0a001', 1, 4, 'IN_STOCK'),
('b1029cf3-0246-4e38-8159-7c2422b0a002', 1, 4, 'IN_STOCK'),
('b1029cf3-0246-4e38-8159-7c2422b0a003', 2, 3, 'IN_STOCK')
ON CONFLICT (uid) DO NOTHING;

-- 10. Facility Inventory Balances
INSERT INTO public.inventories (facility_id, medicine_id, variant_id, stock_quantity, reserved_quantity) VALUES
(4, 1, 1, 250, 10),
(4, 2, 3, 120, 5),
(4, 3, 4, 80, 0),
(3, 1, 1, 2000, 50),
(3, 2, 3, 1500, 0),
(3, 4, 5, 800, 0)
ON CONFLICT (facility_id, medicine_id, variant_id) DO UPDATE 
SET stock_quantity = EXCLUDED.stock_quantity;

-- Reset sequence IDs
SELECT setval(pg_get_serial_sequence('public.categories', 'id'), coalesce(max(id), 1)) FROM public.categories;
SELECT setval(pg_get_serial_sequence('public.facilities', 'id'), coalesce(max(id), 1)) FROM public.facilities;
SELECT setval(pg_get_serial_sequence('public.customers', 'id'), coalesce(max(id), 1)) FROM public.customers;
SELECT setval(pg_get_serial_sequence('public.employees', 'id'), coalesce(max(id), 1)) FROM public.employees;
SELECT setval(pg_get_serial_sequence('public.medicines', 'id'), coalesce(max(id), 1)) FROM public.medicines;
SELECT setval(pg_get_serial_sequence('public.packaging_variants', 'id'), coalesce(max(id), 1)) FROM public.packaging_variants;
SELECT setval(pg_get_serial_sequence('public.batches', 'id'), coalesce(max(id), 1)) FROM public.batches;
