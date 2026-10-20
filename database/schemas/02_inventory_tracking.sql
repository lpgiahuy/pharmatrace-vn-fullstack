-- Schema: 02_inventory_tracking.sql
-- Modules: Batches, SSCC Cartons, Serialized Box UIDs, Inventories, Inventory Transaction Logs

-- 1. Medicine Batches (Production Lots)
CREATE TABLE IF NOT EXISTS public.batches (
    id SERIAL PRIMARY KEY,
    batch_number VARCHAR(100) NOT NULL UNIQUE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    manufacturer_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    production_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    initial_quantity INTEGER NOT NULL DEFAULT 0,
    remaining_quantity INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    certificate_co_cq TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_batch_dates CHECK (expiry_date > production_date)
);

-- 2. SSCC Logistics Master Cartons
CREATE TABLE IF NOT EXISTS public.sscc_cartons (
    id SERIAL PRIMARY KEY,
    sscc_code VARCHAR(50) NOT NULL UNIQUE,
    batch_id INTEGER REFERENCES public.batches(id) ON DELETE CASCADE,
    current_facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'PACKAGED',
    box_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Serialized Medicine Boxes (Unit Traceability with Public QR & Digital Signature)
CREATE TABLE IF NOT EXISTS public.medicine_boxes (
    uid UUID PRIMARY KEY DEFAULT public.uuid_generate_v4(),
    batch_id INTEGER REFERENCES public.batches(id) ON DELETE CASCADE,
    carton_id INTEGER REFERENCES public.sscc_cartons(id) ON DELETE SET NULL,
    current_facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'IN_STOCK',
    signature TEXT,
    public_key TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Facility Inventories (Real-time stock balance per Facility, Medicine, and Variant)
CREATE TABLE IF NOT EXISTS public.inventories (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER REFERENCES public.facilities(id) ON DELETE CASCADE,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE CASCADE,
    variant_id INTEGER REFERENCES public.packaging_variants(id) ON DELETE CASCADE,
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    reserved_quantity INTEGER DEFAULT 0 CHECK (reserved_quantity >= 0),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_facility_medicine_variant UNIQUE(facility_id, medicine_id, variant_id)
);

-- 5. Inventory Transaction Logs (Audit movements: Inbound, Outbound, Transfer, Adjustment)
CREATE TABLE IF NOT EXISTS public.inventory_logs (
    id SERIAL PRIMARY KEY,
    facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    medicine_id INTEGER REFERENCES public.medicines(id) ON DELETE SET NULL,
    transaction_type VARCHAR(50) NOT NULL,
    quantity_changed INTEGER NOT NULL,
    previous_quantity INTEGER NOT NULL,
    new_quantity INTEGER NOT NULL,
    reference_code VARCHAR(100),
    note TEXT,
    performed_by_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_batches_medicine ON public.batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_sscc_cartons_batch ON public.sscc_cartons(batch_id);
CREATE INDEX IF NOT EXISTS idx_medicine_boxes_batch ON public.medicine_boxes(batch_id);
CREATE INDEX IF NOT EXISTS idx_medicine_boxes_carton ON public.medicine_boxes(carton_id);
CREATE INDEX IF NOT EXISTS idx_medicine_boxes_facility ON public.medicine_boxes(current_facility_id);
CREATE INDEX IF NOT EXISTS idx_inventories_facility ON public.inventories(facility_id);
CREATE INDEX IF NOT EXISTS idx_inventories_medicine ON public.inventories(medicine_id);
CREATE INDEX IF NOT EXISTS idx_inventories_variant ON public.inventories(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_logs_facility ON public.inventory_logs(facility_id);
