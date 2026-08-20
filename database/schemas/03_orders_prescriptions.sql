-- Schema: 03_orders_prescriptions.sql
-- Modules: Prescriptions, Vouchers, Orders, Order Items, Cart Items, Reviews, Articles

-- Electronic Prescriptions
CREATE TABLE IF NOT EXISTS public.prescriptions (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    doctor_name VARCHAR(100),
    hospital_clinic VARCHAR(150),
    diagnosis TEXT,
    prescription_image_url TEXT,
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    pharmacist_note TEXT,
    approved_by_pharmacist_id INTEGER REFERENCES public.users(id),
    issued_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Discount Vouchers
CREATE TABLE IF NOT EXISTS public.vouchers (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,
    discount_type VARCHAR(20) DEFAULT 'PERCENT' CHECK (discount_type IN ('PERCENT', 'FIXED')),
    discount_value NUMERIC(15, 2) NOT NULL CHECK (discount_value > 0),
    min_order_value NUMERIC(15, 2) DEFAULT 0,
    max_discount_amount NUMERIC(15, 2),
    total_quantity INTEGER DEFAULT 100,
    used_quantity INTEGER DEFAULT 0,
    start_date TIMESTAMP,
    end_date TIMESTAMP,
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'DISABLED'))
);

-- Orders
CREATE TABLE IF NOT EXISTS public.orders (
    id SERIAL PRIMARY KEY,
    order_code VARCHAR(50) NOT NULL UNIQUE,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,
    source_facility_id INTEGER REFERENCES public.facilities(id),
    prescription_id INTEGER REFERENCES public.prescriptions(id) ON DELETE SET NULL,
    subtotal_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    shipping_fee NUMERIC(15, 2) DEFAULT 0,
    discount_amount NUMERIC(15, 2) DEFAULT 0,
    reward_points_used INTEGER DEFAULT 0,
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    payment_method VARCHAR(50) DEFAULT 'COD' CHECK (payment_method IN ('COD', 'BANK_TRANSFER', 'E_WALLET')),
    payment_status VARCHAR(50) DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PAID', 'REFUNDED')),
    order_status VARCHAR(50) DEFAULT 'PENDING' CHECK (order_status IN ('PENDING', 'PROCESSING', 'SHIPPING', 'COMPLETED', 'CANCELLED', 'PARTIALLY_RETURNED')),
    shipping_address TEXT,
    recipient_phone VARCHAR(20),
    recipient_name VARCHAR(100),
    bank_transaction_code VARCHAR(100) UNIQUE,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order Items
CREATE TABLE IF NOT EXISTS public.order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES public.orders(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id),
    packaging_id INTEGER REFERENCES public.packaging_specifications(id),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    total_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    box_uids UUID[] DEFAULT '{}'::uuid[]
);

-- Shopping Cart Items
CREATE TABLE IF NOT EXISTS public.cart_items (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    packaging_id INTEGER REFERENCES public.packaging_specifications(id),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_cart_item UNIQUE(customer_id, medicine_id, packaging_id)
);

-- Product Reviews
CREATE TABLE IF NOT EXISTS public.product_reviews (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES public.customers(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    rating INTEGER CHECK (rating BETWEEN 1 AND 5),
    content TEXT,
    images TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Healthcare Articles
CREATE TABLE IF NOT EXISTS public.articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    summary TEXT,
    content TEXT NOT NULL,
    cover_image_url TEXT,
    author_id INTEGER REFERENCES public.users(id),
    view_count INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED', 'DRAFT')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
