-- Schema: 05_logistics_cod.sql
-- Modules: Logistics Shipments & COD Tracking

CREATE TABLE IF NOT EXISTS public.shipments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    tracking_number VARCHAR(50) NOT NULL UNIQUE,
    courier_name VARCHAR(100) NOT NULL DEFAULT 'GiaoHangNhanh',
    shipment_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_PICKUP' CHECK (shipment_status IN ('PENDING_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED')),
    pickup_date TIMESTAMP,
    estimated_delivery_date TIMESTAMP,
    actual_delivery_date TIMESTAMP,
    cod_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    cod_status VARCHAR(50) NOT NULL DEFAULT 'UNRECONCILED' CHECK (cod_status IN ('UNRECONCILED', 'RECONCILED', 'SETTLED')),
    cod_reconciled_at TIMESTAMP,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON public.shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_cod_status ON public.shipments(cod_status);
