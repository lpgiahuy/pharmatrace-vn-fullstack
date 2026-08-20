-- Schema: 08_finance_ar_ap.sql
-- Modules: Cashbook Transactions, Customer Debts (AR), Supplier Debts (AP)

CREATE TABLE IF NOT EXISTS public.cash_flow_transactions (
    id SERIAL PRIMARY KEY,
    transaction_code VARCHAR(50) UNIQUE NOT NULL,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('INFLOW', 'OUTFLOW')),
    category VARCHAR(50) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    counterparty_type VARCHAR(30) DEFAULT 'OTHER' CHECK (counterparty_type IN ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER')),
    counterparty_name VARCHAR(255),
    order_id INTEGER REFERENCES public.orders(id) ON DELETE SET NULL,
    purchase_order_id INTEGER REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
    payment_method VARCHAR(50) DEFAULT 'BANK_TRANSFER' CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'CARD', 'E_WALLET')),
    note TEXT,
    transaction_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by_id INTEGER REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.customer_debts (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES public.orders(id) ON DELETE SET NULL,
    total_debt_amount NUMERIC(15, 2) NOT NULL CHECK (total_debt_amount >= 0),
    paid_amount NUMERIC(15, 2) DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_debt_amount NUMERIC(15, 2) GENERATED ALWAYS AS (total_debt_amount - paid_amount) STORED,
    due_date TIMESTAMP,
    debt_status VARCHAR(50) DEFAULT 'UNPAID' CHECK (debt_status IN ('UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'PAID')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.supplier_debts (
    id SERIAL PRIMARY KEY,
    supplier_name VARCHAR(255) NOT NULL,
    purchase_order_id INTEGER REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
    total_debt_amount NUMERIC(15, 2) NOT NULL CHECK (total_debt_amount >= 0),
    paid_amount NUMERIC(15, 2) DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_debt_amount NUMERIC(15, 2) GENERATED ALWAYS AS (total_debt_amount - paid_amount) STORED,
    due_date TIMESTAMP,
    debt_status VARCHAR(50) DEFAULT 'UNPAID' CHECK (debt_status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
