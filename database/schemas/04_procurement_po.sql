-- Schema: 04_procurement_po.sql
-- Modules: Purchase Orders (PO) & PO Line Items

-- 1. Purchase Orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id SERIAL PRIMARY KEY,
    po_code VARCHAR(50) NOT NULL UNIQUE,
    supplier_id INTEGER NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
    created_by_employee_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL,
    total_amount NUMERIC(15, 2) DEFAULT 0 CHECK (total_amount >= 0),
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'RECEIVED', 'CANCELLED')),
    note TEXT,
    received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 2. Purchase Order Items
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id SERIAL PRIMARY KEY,
    po_id INTEGER NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES public.medicines(id) ON DELETE RESTRICT,
    batch_id INTEGER REFERENCES public.batches(id) ON DELETE SET NULL,
    variant_id INTEGER REFERENCES public.packaging_variants(id) ON DELETE SET NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(15, 2) GENERATED ALWAYS AS ((quantity::numeric * unit_price)) STORED
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_po_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items(po_id);
CREATE INDEX IF NOT EXISTS idx_po_items_medicine ON public.purchase_order_items(medicine_id);
