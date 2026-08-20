-- Schema: 02_inventory_tracking.sql
-- Modules: Batches, SSCC Packages, Box UIDs, Inventories, Transaction Logs

-- Medicine Batches
CREATE TABLE IF NOT EXISTS public.medicine_batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(100) NOT NULL UNIQUE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    manufacturer_id INTEGER REFERENCES public.facilities(id),
    manufacturing_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    initial_quantity INTEGER NOT NULL DEFAULT 0,
    current_quantity INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) DEFAULT 'NORMAL' CHECK (status IN ('NORMAL', 'QUARANTINED', 'RECALLED', 'EXPIRED')),
    co_cq_certificate TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_batch_dates CHECK (expiry_date > manufacturing_date)
);

-- SSCC Logistics Master Cartons
CREATE TABLE IF NOT EXISTS public.shipping_packages (
    id SERIAL PRIMARY KEY,
    sscc_code VARCHAR(50) NOT NULL UNIQUE,
    batch_id INTEGER REFERENCES public.medicine_batches(id) ON DELETE CASCADE,
    current_facility_id INTEGER REFERENCES public.facilities(id),
    status VARCHAR(50) DEFAULT 'PACKED' CHECK (status IN ('PACKED', 'IN_TRANSIT', 'RECEIVED', 'UNPACKED')),
    box_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Serialized Box UIDs (Public QR Code + Secret Master Code)
CREATE TABLE IF NOT EXISTS public.medicine_boxes (
    uid UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    batch_id INTEGER REFERENCES public.medicine_batches(id) ON DELETE CASCADE,
    shipping_package_id INTEGER REFERENCES public.shipping_packages(id) ON DELETE SET NULL,
    current_facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    secret_code_hash VARCHAR(255),
    status VARCHAR(50) DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK', 'IN_TRANSIT', 'DELIVERED', 'ACTIVATED', 'QUARANTINED', 'EXPIRED')),
    signature TEXT,
    public_key TEXT,
    activated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Facility Inventories Balance
CREATE TABLE IF NOT EXISTS public.facility_inventories (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER REFERENCES public.facilities(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    packaging_id INTEGER REFERENCES public.packaging_specifications(id),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    reserved_quantity INTEGER DEFAULT 0 CHECK (reserved_quantity >= 0),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_facility_inventory UNIQUE(facility_id, medicine_id, packaging_id)
);

-- Inventory Transaction History
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER REFERENCES public.facilities(id),
    medicine_id INTEGER REFERENCES public.medicines(id),
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('INBOUND', 'OUTBOUND', 'TRANSFER', 'DISPOSAL', 'ADJUSTMENT')),
    change_quantity INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    remaining_quantity INTEGER NOT NULL,
    reference_code VARCHAR(100),
    note TEXT,
    performed_by_id INTEGER REFERENCES public.users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
