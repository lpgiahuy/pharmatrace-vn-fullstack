-- Seeds: 01_seed_data.sql
-- Default Initial Data for PharmaTrace VN Platform

-- 1. Packaging Specifications
INSERT INTO public.packaging_specifications (id, name, description) VALUES
(1, 'Box of 30 Tablets', 'Standard blister pack with 3 strips of 10 tablets'),
(2, 'Bottle of 100ml', 'Liquid syrup in dark glass bottle'),
(3, 'Strip of 10 Capsules', 'Hard gelatin capsule blister strip'),
(4, 'Tube of 20g', 'Topical cream in aluminum tube')
ON CONFLICT (id) DO NOTHING;

-- 2. Categories
INSERT INTO public.categories (id, name, description, icon) VALUES
(1, 'Antibiotics & Anti-infectives', 'Prescription antibiotics and antimicrobial medications', 'ShieldAlert'),
(2, 'Analgesics & Antipyretics', 'Pain relief and fever reducing medications', 'HeartPulse'),
(3, 'Cardiovascular & Blood Pressure', 'Cardiovascular health and hypertension treatments', 'Activity'),
(4, 'Gastrointestinal & Digestive', 'Digestive enzymes, antacids and ulcer treatments', 'Stomach'),
(5, 'Vitamins & Dietary Supplements', 'Essential multivitamins and mineral supplements', 'Sun')
ON CONFLICT (id) DO NOTHING;

-- 3. Facilities
INSERT INTO public.facilities (id, name, type, address, phone, email, latitude, longitude) VALUES
(1, 'PharmaTrace Central Manufacturing Plant', 'MANUFACTURER', 'Lot A1, Saigon Hi-Tech Park, District 9, Ho Chi Minh City', '02838901234', 'plant@pharmatrace.vn', 10.8544, 106.7850),
(2, 'Northern Central Logistics Hub', 'CENTRAL_WAREHOUSE', 'Km 12, Thang Long Boulevard, Hanoi', '02439876543', 'wh-north@pharmatrace.vn', 21.0023, 105.7489),
(3, 'Southern Logistics Warehouse', 'BRANCH_WAREHOUSE', 'Tan Binh Industrial Park, Ho Chi Minh City', '02837654321', 'wh-south@pharmatrace.vn', 10.8123, 106.6345),
(4, 'PharmaTrace Flagship Pharmacy #01', 'PHARMACY', '123 Nguyen Hue Boulevard, District 1, Ho Chi Minh City', '02839123456', 'store01@pharmatrace.vn', 10.7745, 106.7032)
ON CONFLICT (id) DO NOTHING;

-- 4. Users (Password: password123)
-- Hash: $2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm
INSERT INTO public.users (id, username, password, full_name, email, phone, role, status, facility_id) VALUES
(1, 'superadmin', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'System Administrator', 'admin@pharmatrace.vn', '0901234567', 'SUPER_ADMIN', 'ACTIVE', 1),
(2, 'pharmacist1', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'Head Pharmacist', 'pharmacist@pharmatrace.vn', '0912345678', 'PHARMACIST', 'ACTIVE', 4),
(3, 'warehouse1', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'Logistics Supervisor', 'warehouse@pharmatrace.vn', '0923456789', 'WAREHOUSE_STAFF', 'ACTIVE', 3),
(4, 'customer1', '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6xNekdHgTGmrpHEfIoxm', 'Nguyen Van A', 'customer@pharmatrace.vn', '0934567890', 'CUSTOMER', 'ACTIVE', NULL)
ON CONFLICT (id) DO NOTHING;

-- 5. Customers & Employees
INSERT INTO public.customers (id, user_id, membership_tier, reward_points, default_address) VALUES
(1, 4, 'GOLD', 1250, '456 Le Loi, District 1, Ho Chi Minh City')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.employees (id, user_id, facility_id, job_title) VALUES
(1, 2, 4, 'Chief Pharmacist'),
(2, 3, 3, 'Warehouse Manager')
ON CONFLICT (id) DO NOTHING;

-- 6. Medicines
INSERT INTO public.medicines (id, name, category_id, packaging_id, registration_number, active_ingredients, dosage, manufacturer, country_of_origin, unit_price, sale_price, image_url, description, is_prescription_required) VALUES
(1, 'Paracetamol Extra 500mg', 2, 1, 'VD-24501-22', 'Paracetamol 500mg, Caffeine 65mg', '500mg', 'PharmaTrace Pharma Joint Stock Co', 'Vietnam', 45000, 42000, '/medicines/paracetamol.png', 'Fast acting pain relief and fever reducing tablets for headaches, body aches, and fever.', FALSE),
(2, 'Amoxicillin Trihydrate 500mg', 1, 3, 'VN-18234-20', 'Amoxicillin 500mg', '500mg', 'GlaxoSmithKline (GSK)', 'United Kingdom', 95000, 89000, '/medicines/amoxicillin.png', 'Broad-spectrum antibiotic used to treat bacterial infections of the respiratory tract, ear, nose, and throat.', TRUE),
(3, 'Omeprazole Delayed-Release 20mg', 4, 1, 'VD-31205-23', 'Omeprazole 20mg', '20mg', 'AstraZeneca', 'Sweden', 120000, 110000, '/medicines/omeprazole.png', 'Proton pump inhibitor that decreases the amount of acid produced in the stomach.', TRUE),
(4, 'Effervescent Vitamin C 1000mg + Zinc', 5, 2, 'VD-11029-21', 'Ascorbic Acid 1000mg, Zinc Sulfate 10mg', '1000mg', 'Bayer Healthcare', 'Germany', 85000, 78000, '/medicines/vitaminc.png', 'High strength effervescent tablets providing immune support and reducing fatigue.', FALSE),
(5, 'Atorvastatin Calcium 20mg', 3, 1, 'VN-29012-21', 'Atorvastatin 20mg', '20mg', 'Pfizer Inc.', 'United States', 210000, 195000, '/medicines/atorvastatin.png', 'Statin medication used to prevent cardiovascular disease and treat abnormal lipid levels.', TRUE)
ON CONFLICT (id) DO NOTHING;

-- 7. Batches
INSERT INTO public.medicine_batches (id, batch_number, medicine_id, manufacturer_id, manufacturing_date, expiry_date, initial_quantity, current_quantity, status) VALUES
(1, 'LOT-PARA-202601', 1, 1, '2026-01-10', '2028-01-10', 5000, 4850, 'NORMAL'),
(2, 'LOT-AMOX-202602', 2, 1, '2026-02-15', '2028-02-15', 3000, 2900, 'NORMAL'),
(3, 'LOT-OMEP-202603', 3, 1, '2026-03-01', '2028-03-01', 2000, 2000, 'NORMAL')
ON CONFLICT (id) DO NOTHING;

-- 8. Sample Box UIDs
INSERT INTO public.medicine_boxes (uid, batch_id, current_facility_id, status) VALUES
('b1029cf3-0246-4e38-8159-7c2422b0a001', 1, 4, 'IN_STOCK'),
('b1029cf3-0246-4e38-8159-7c2422b0a002', 1, 4, 'IN_STOCK'),
('b1029cf3-0246-4e38-8159-7c2422b0a003', 2, 3, 'IN_STOCK')
ON CONFLICT (uid) DO NOTHING;

-- 9. Facility Inventory Balances
INSERT INTO public.facility_inventories (facility_id, medicine_id, packaging_id, stock_quantity, reserved_quantity) VALUES
(4, 1, 1, 250, 10),
(4, 2, 3, 120, 5),
(4, 3, 1, 80, 0),
(3, 1, 1, 2000, 50),
(3, 2, 3, 1500, 0),
(3, 4, 2, 800, 0)
ON CONFLICT (facility_id, medicine_id, packaging_id) DO UPDATE 
SET stock_quantity = EXCLUDED.stock_quantity;

-- Reset sequence IDs
SELECT setval(pg_get_serial_sequence('public.categories', 'id'), coalesce(max(id), 1)) FROM public.categories;
SELECT setval(pg_get_serial_sequence('public.packaging_specifications', 'id'), coalesce(max(id), 1)) FROM public.packaging_specifications;
SELECT setval(pg_get_serial_sequence('public.facilities', 'id'), coalesce(max(id), 1)) FROM public.facilities;
SELECT setval(pg_get_serial_sequence('public.users', 'id'), coalesce(max(id), 1)) FROM public.users;
SELECT setval(pg_get_serial_sequence('public.medicines', 'id'), coalesce(max(id), 1)) FROM public.medicines;
SELECT setval(pg_get_serial_sequence('public.medicine_batches', 'id'), coalesce(max(id), 1)) FROM public.medicine_batches;
