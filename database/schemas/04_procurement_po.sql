-- Schema: 04_procurement_po.sql
-- Modules: Purchase Orders (PO) & PO Items

-- Purchase Orders
CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id SERIAL PRIMARY KEY,
    po_code VARCHAR(50) NOT NULL UNIQUE,
    supplier_id INTEGER NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
    destination_facility_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    created_by_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    total_amount NUMERIC(15, 2) DEFAULT 0 CHECK (total_amount >= 0),
    status VARCHAR(50) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'PARTIALLY_RECEIVED', 'COMPLETED', 'CANCELLED')),
    note TEXT,
    po_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Purchase Order Items
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
    id SERIAL PRIMARY KEY,
    purchase_order_id INTEGER NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES public.medicines(id) ON DELETE RESTRICT,
    batch_id INTEGER REFERENCES public.medicine_batches(id) ON DELETE SET NULL,
    packaging_id INTEGER REFERENCES public.packaging_specifications(id) ON DELETE SET NULL,
    ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
    received_quantity INTEGER DEFAULT 0 CHECK (received_quantity >= 0),
    unit_price NUMERIC(12, 2) NOT NULL CHECK (unit_price >= 0),
    total_price NUMERIC(15, 2) GENERATED ALWAYS AS (ordered_quantity * unit_price) STORED
);

CREATE INDEX IF NOT EXISTS idx_po_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_po_status ON public.purchase_orders(status);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_po_items_medicine ON public.purchase_order_items(medicine_id);
