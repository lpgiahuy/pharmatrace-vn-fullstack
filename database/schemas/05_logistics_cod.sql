-- Schema: 05_logistics_cod.sql
-- Modules: Logistics Shipments & COD Reconciliation

CREATE TABLE IF NOT EXISTS public.shipments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE CASCADE,
    tracking_number VARCHAR(50) NOT NULL UNIQUE,
    courier_name VARCHAR(100) NOT NULL DEFAULT 'EXPRESS_LOGISTICS',
    shipping_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_PICKUP',
    picked_up_at TIMESTAMP,
    estimated_delivery_at TIMESTAMP,
    actual_delivery_at TIMESTAMP,
    cod_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
    cod_settlement_status VARCHAR(50) NOT NULL DEFAULT 'UNSETTLED',
    cod_settled_at TIMESTAMP,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_shipments_order ON public.shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_shipments_tracking ON public.shipments(tracking_number);
CREATE INDEX IF NOT EXISTS idx_shipments_cod_status ON public.shipments(cod_settlement_status);

-- Internal transfers between fulfillment facilities
CREATE TABLE IF NOT EXISTS public.internal_transfers (
    id SERIAL PRIMARY KEY,
    transfer_code VARCHAR(50) NOT NULL UNIQUE,
    order_id INTEGER NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    from_facility_id INTEGER NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
    to_facility_id INTEGER NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL DEFAULT 'REQUESTED',
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    tracking_code VARCHAR(100),
    distance_km NUMERIC(10, 2),
    estimated_hours INTEGER DEFAULT 24,
    notes TEXT,
    dispatched_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_internal_transfers_order_id ON public.internal_transfers(order_id);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_from ON public.internal_transfers(from_facility_id);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_to ON public.internal_transfers(to_facility_id);
CREATE INDEX IF NOT EXISTS idx_internal_transfers_status ON public.internal_transfers(status);
