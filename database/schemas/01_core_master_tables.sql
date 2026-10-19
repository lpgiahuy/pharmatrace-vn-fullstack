-- Schema: 01_core_master_tables.sql
-- Modules: Categories, Facilities, Customers, Employees, Manufacturers, Medicines, Packaging Variants, Medicine Categories, Customer Wishlists

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Categories (Hierarchical Pharmaceutical Taxonomy)
CREATE TABLE IF NOT EXISTS public.categories (
    id SERIAL PRIMARY KEY,
    category_name VARCHAR(100) NOT NULL,
    slug VARCHAR(100) UNIQUE,
    description TEXT,
    icon VARCHAR(100),
    parent_id INTEGER REFERENCES public.categories(id) ON UPDATE NO ACTION ON DELETE SET NULL,
    display_order INTEGER DEFAULT 0,
    status VARCHAR(50) DEFAULT 'ACTIVE'
);

-- 2. Facilities (Factories, Warehouses, Pharmacies)
CREATE TABLE IF NOT EXISTS public.facilities (
    id SERIAL PRIMARY KEY,
    facility_name VARCHAR(150) NOT NULL,
    facility_type VARCHAR(50) NOT NULL,
    address TEXT,
    phone_number VARCHAR(20),
    email VARCHAR(100),
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Customers (Patient / Consumer Profiles & Auth)
CREATE TABLE IF NOT EXISTS public.customers (
    id SERIAL PRIMARY KEY,
    membership_tier VARCHAR(50) DEFAULT 'BRONZE' CHECK (membership_tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND')),
    reward_points INTEGER DEFAULT 0,
    default_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    full_name VARCHAR(100),
    phone_number VARCHAR(20) UNIQUE,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255),
    status VARCHAR(20) DEFAULT 'ACTIVE'
);

-- 4. Employees (Staff Profiles & Role-based Access)
CREATE TABLE IF NOT EXISTS public.employees (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER REFERENCES public.facilities(id) ON UPDATE NO ACTION ON DELETE SET NULL,
    job_title VARCHAR(100),
    joined_date DATE DEFAULT CURRENT_DATE,
    full_name VARCHAR(100),
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255),
    role VARCHAR(50),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Manufacturers (Pharmaceutical Brands & Master Records)
CREATE TABLE IF NOT EXISTS public.manufacturers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    slug VARCHAR(255) UNIQUE,
    country VARCHAR(100),
    logo_url VARCHAR(500),
    website VARCHAR(255),
    status VARCHAR(20) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 6. Medicines Catalog
CREATE TABLE IF NOT EXISTS public.medicines (
    id SERIAL PRIMARY KEY,
    medicine_name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100),
    active_ingredients TEXT,
    dosage VARCHAR(100),
    manufacturer VARCHAR(150),
    country_of_origin VARCHAR(100),
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    promotional_price NUMERIC(15, 2),
    image_url TEXT,
    short_description TEXT,
    details JSONB DEFAULT '{}'::jsonb,
    is_prescription BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    effective_price NUMERIC(15, 2) GENERATED ALWAYS AS (COALESCE(NULLIF(promotional_price, 0), unit_price)) STORED,
    slug VARCHAR(255),
    manufacturer_id INTEGER REFERENCES public.manufacturers(id) ON UPDATE NO ACTION ON DELETE SET NULL
);

-- 7. Packaging Variants (Stock Keeping Units by Unit: Box, Blister, Strip, Bottle)
CREATE TABLE IF NOT EXISTS public.packaging_variants (
    id SERIAL PRIMARY KEY,
    medicine_id INTEGER NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    unit_name VARCHAR(50) NOT NULL,
    price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    original_price NUMERIC(15, 2),
    discount_percent INTEGER DEFAULT 0,
    is_base_unit BOOLEAN DEFAULT FALSE,
    sale_start_date TIMESTAMPTZ,
    sale_end_date TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 8. Medicine Categories (Many-to-Many Taxonomy Mapping)
CREATE TABLE IF NOT EXISTS public.medicine_categories (
    medicine_id INTEGER NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    category_id INTEGER NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (medicine_id, category_id)
);

-- 9. Customer Wishlists
CREATE TABLE IF NOT EXISTS public.customer_wishlists (
    customer_id INTEGER NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customer_id, medicine_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_medicines_effective_price ON public.medicines(effective_price);
CREATE INDEX IF NOT EXISTS idx_medicines_manufacturer_id ON public.medicines(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_medicines_slug ON public.medicines(slug);
CREATE INDEX IF NOT EXISTS idx_packaging_variants_medicine ON public.packaging_variants(medicine_id);
CREATE INDEX IF NOT EXISTS idx_medicine_categories_cat_id ON public.medicine_categories(category_id);
CREATE INDEX IF NOT EXISTS idx_medicine_categories_med_id ON public.medicine_categories(medicine_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_customer ON public.customer_wishlists(customer_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_medicine ON public.customer_wishlists(medicine_id);
