-- Schema: 07_crm_loyalty_rma.sql
-- Modules: Customer Loyalty Points Ledger

CREATE TABLE IF NOT EXISTS public.loyalty_point_logs (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES public.orders(id) ON DELETE SET NULL,
    transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('EARN', 'REDEEM', 'RANK_BONUS', 'RMA_DEDUCTION', 'ADMIN_ADJUSTMENT')),
    points INTEGER NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_loyalty_customer ON public.loyalty_point_logs(customer_id);
CREATE INDEX IF NOT EXISTS idx_loyalty_order ON public.loyalty_point_logs(order_id);
