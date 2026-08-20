-- Schema: 07_crm_loyalty_rma.sql
-- Modules: Loyalty Points Log & Return Merchandise Authorization (RMA)

CREATE TABLE IF NOT EXISTS public.loyalty_point_logs (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES public.orders(id) ON DELETE SET NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('EARNED', 'REDEEMED', 'TIER_BONUS', 'RMA_DEDUCTED', 'ADMIN_ADJUSTED')),
    points INTEGER NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.return_orders (
    id SERIAL PRIMARY KEY,
    rma_code VARCHAR(50) NOT NULL UNIQUE,
    order_id INTEGER NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    return_status VARCHAR(50) DEFAULT 'PENDING' CHECK (return_status IN ('PENDING', 'APPROVED', 'RECEIVED', 'REFUNDED', 'REJECTED')),
    refund_amount NUMERIC(15, 2) DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.return_order_items (
    id SERIAL PRIMARY KEY,
    return_order_id INTEGER NOT NULL REFERENCES public.return_orders(id) ON DELETE CASCADE,
    medicine_id INTEGER NOT NULL REFERENCES public.medicines(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_point_logs_customer ON public.loyalty_point_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_return_orders_order ON public.return_orders(order_id);
