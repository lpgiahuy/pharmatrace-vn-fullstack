-- Schema: 01_core_master_tables.sql
-- Modules: Categories, Packaging Units, Facilities, Users, Medicine Catalog

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Packaging Units
CREATE TABLE IF NOT EXISTS public.packaging_specifications (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT
);

-- Categories
CREATE TABLE IF NOT EXISTS public.categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    icon VARCHAR(100)
);

-- Facilities (Factories, Warehouses, Pharmacies)
CREATE TABLE IF NOT EXISTS public.facilities (
    id SERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('MANUFACTURER', 'CENTRAL_WAREHOUSE', 'BRANCH_WAREHOUSE', 'PHARMACY')),
    address TEXT,
    phone VARCHAR(20),
    email VARCHAR(100),
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users
CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE,
    phone VARCHAR(20),
    role VARCHAR(50) NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER', 'SUPER_ADMIN', 'PHARMACIST', 'WAREHOUSE_STAFF', 'STORE_MANAGER')),
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE', 'LOCKED')),
    facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customers
CREATE TABLE IF NOT EXISTS public.customers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    membership_tier VARCHAR(50) DEFAULT 'BRONZE' CHECK (membership_tier IN ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND')),
    reward_points INTEGER DEFAULT 0,
    default_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Employees
CREATE TABLE IF NOT EXISTS public.employees (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    job_title VARCHAR(100),
    hire_date DATE DEFAULT CURRENT_DATE
);

-- Medicines Catalog
CREATE TABLE IF NOT EXISTS public.medicines (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    category_id INTEGER REFERENCES public.categories(id) ON DELETE SET NULL,
    packaging_id INTEGER REFERENCES public.packaging_specifications(id) ON DELETE SET NULL,
    registration_number VARCHAR(100),
    active_ingredients TEXT,
    dosage VARCHAR(100),
    manufacturer VARCHAR(150),
    country_of_origin VARCHAR(100),
    unit_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
    sale_price NUMERIC(15, 2),
    image_url TEXT,
    description TEXT,
    drug_details JSONB DEFAULT '{}'::jsonb,
    is_prescription_required BOOLEAN DEFAULT FALSE,
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISCONTINUED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
