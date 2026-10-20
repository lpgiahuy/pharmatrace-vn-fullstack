-- Schema: 03_orders_prescriptions.sql
-- Modules: Prescriptions, Vouchers, Orders, Order Items, Cart Items, Reviews, Moderation Reports & Audit Logs, Articles

-- 1. Electronic Prescriptions
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    prescribing_doctor VARCHAR(100),
    medical_facility VARCHAR(150),
    diagnosis TEXT,
    prescription_image_url TEXT,
    status VARCHAR(50) DEFAULT 'PENDING_APPROVAL',
    pharmacist_note TEXT,
    approved_by_pharmacist_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    prescribed_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Discount Vouchers
CREATE TABLE IF NOT EXISTS public.vouchers (
    id SERIAL PRIMARY KEY,
    voucher_code VARCHAR(50) NOT NULL UNIQUE,
    discount_type VARCHAR(20) DEFAULT 'PERCENT' CHECK (discount_type IN ('PERCENT', 'FIXED')),
    discount_value NUMERIC(15, 2) NOT NULL CHECK (discount_value > 0),
    min_order_value NUMERIC(15, 2) DEFAULT 0,
    max_discount_amount NUMERIC(15, 2),
    total_quantity INTEGER NOT NULL DEFAULT 100 CHECK (total_quantity > 0),
    used_quantity INTEGER DEFAULT 0 CHECK (used_quantity >= 0),
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACTIVE'
);

-- 3. Customer Orders
CREATE TABLE IF NOT EXISTS public.orders (
    id SERIAL PRIMARY KEY,
    order_code VARCHAR(50) NOT NULL UNIQUE,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,
    export_facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    prescription_id INTEGER REFERENCES public.prescriptions(id) ON DELETE SET NULL,
    subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    shipping_fee NUMERIC(15, 2) DEFAULT 0,
    discount_amount NUMERIC(15, 2) DEFAULT 0,
    used_points INTEGER DEFAULT 0,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(50) DEFAULT 'COD',
    payment_status VARCHAR(50) DEFAULT 'UNPAID',
    order_status VARCHAR(50) DEFAULT 'PENDING',
    shipping_address TEXT,
    recipient_phone VARCHAR(20),
    recipient_name VARCHAR(100),
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Order Items
CREATE TABLE IF NOT EXISTS public.order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES public.orders(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE SET NULL,
    variant_id INTEGER REFERENCES public.packaging_variants(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    assigned_uids UUID[] DEFAULT '{}'::uuid[],
    inventory_reserved BOOLEAN NOT NULL DEFAULT FALSE,
    medicine_name VARCHAR(255),
    unit_name VARCHAR(50)
);

-- 5. Shopping Cart Items
CREATE TABLE IF NOT EXISTS public.cart_items (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    variant_id INTEGER REFERENCES public.packaging_variants(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_cart_item UNIQUE(customer_id, variant_id)
);

-- 6. Product Reviews & Ratings
CREATE TABLE IF NOT EXISTS public.reviews (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    rating_stars INTEGER CHECK (rating_stars >= 1 AND rating_stars <= 5),
    comment TEXT,
    images TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) DEFAULT 'APPROVED',
    is_verified_purchase BOOLEAN DEFAULT FALSE,
    helpful_count INTEGER DEFAULT 0,
    admin_reply TEXT,
    replied_at TIMESTAMPTZ,
    replied_by_name VARCHAR(150)
);

-- 7. Moderation Reports (Customer / Staff flag abusive reviews)
CREATE TABLE IF NOT EXISTS public.moderation_reports (
    id SERIAL PRIMARY KEY,
    review_id INTEGER REFERENCES public.reviews(id) ON DELETE CASCADE,
    reporter_customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,
    reporter_employee_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    reason_category VARCHAR(50) NOT NULL,
    details TEXT,
    status VARCHAR(50) DEFAULT 'PENDING',
    resolved_by_employee_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    resolver_note TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
);

-- 8. Moderation Audit Logs
CREATE TABLE IF NOT EXISTS public.moderation_audit_logs (
    id SERIAL PRIMARY KEY,
    review_id INTEGER REFERENCES public.reviews(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    performed_by_employee_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    performed_by_customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,
    performed_by_role VARCHAR(50),
    reason TEXT,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 9. Healthcare Articles
CREATE TABLE IF NOT EXISTS public.articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    summary TEXT,
    content TEXT NOT NULL,
    cover_image_url TEXT,
    author_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    view_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'PUBLISHED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_code ON public.orders(order_code);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_cart_customer ON public.cart_items(customer_id);
CREATE INDEX IF NOT EXISTS idx_reviews_medicine ON public.reviews(medicine_id);
CREATE INDEX IF NOT EXISTS idx_reviews_customer ON public.reviews(customer_id);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_review ON public.moderation_reports(review_id);
CREATE INDEX IF NOT EXISTS idx_moderation_audit_review ON public.moderation_audit_logs(review_id);
