-- Schema: 08_finance_ar_ap.sql
-- Modules: Cashbook Transactions, Customer Debts (AR), Supplier Debts (AP)

-- 1. Cashbook Transactions (Double-entry Cash Flow)
CREATE TABLE IF NOT EXISTS public.cashbook_logs (
    id SERIAL PRIMARY KEY,
    transaction_code VARCHAR(50) NOT NULL UNIQUE,
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('INCOME', 'EXPENSE')),
    category VARCHAR(50) NOT NULL,
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    party_type VARCHAR(30) DEFAULT 'OTHER' CHECK (party_type IN ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER')),
    party_name VARCHAR(255),
    order_id INTEGER REFERENCES public.orders(id) ON DELETE SET NULL,
    po_id INTEGER REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
    payment_method VARCHAR(50) DEFAULT 'BANK_TRANSFER' CHECK (payment_method IN ('CASH', 'BANK_TRANSFER', 'DEBIT_CARD', 'E_WALLET')),
    note TEXT,
    transaction_date TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    created_by_user_id INTEGER REFERENCES public.employees(id) ON DELETE SET NULL
);

-- 2. Accounts Receivable (AR - Customer Debts / Installments)
CREATE TABLE IF NOT EXISTS public.accounts_receivable (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES public.orders(id) ON DELETE SET NULL,
    total_due_amount NUMERIC(15, 2) NOT NULL CHECK (total_due_amount >= 0),
    paid_amount NUMERIC(15, 2) DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_balance NUMERIC(15, 2) GENERATED ALWAYS AS ((total_due_amount - paid_amount)) STORED,
    due_date TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'OVERDUE', 'PAID')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Accounts Payable (AP - Supplier Procurement Payables)
CREATE TABLE IF NOT EXISTS public.accounts_payable (
    id SERIAL PRIMARY KEY,
    supplier_name VARCHAR(255) NOT NULL,
    supplier_id INTEGER REFERENCES public.facilities(id) ON DELETE SET NULL,
    po_id INTEGER REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
    total_due_amount NUMERIC(15, 2) NOT NULL CHECK (total_due_amount >= 0),
    paid_amount NUMERIC(15, 2) DEFAULT 0 CHECK (paid_amount >= 0),
    remaining_balance NUMERIC(15, 2) GENERATED ALWAYS AS ((total_due_amount - paid_amount)) STORED,
    due_date TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'UNPAID' CHECK (status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cashbook_code ON public.cashbook_logs(transaction_code);
CREATE INDEX IF NOT EXISTS idx_ar_customer ON public.accounts_receivable(customer_id);
CREATE INDEX IF NOT EXISTS idx_ar_order ON public.accounts_receivable(order_id);
CREATE INDEX IF NOT EXISTS idx_ap_supplier ON public.accounts_payable(supplier_id);
CREATE INDEX IF NOT EXISTS idx_ap_po ON public.accounts_payable(po_id);
