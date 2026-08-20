-- Procedure: sp_transfer_inventory
-- Atomically transfers stock between two facilities

CREATE OR REPLACE PROCEDURE public.sp_transfer_inventory(
    p_from_facility_id INTEGER,
    p_to_facility_id INTEGER,
    p_medicine_id INTEGER,
    p_packaging_id INTEGER,
    p_quantity INTEGER,
    p_performed_by_id INTEGER,
    p_note TEXT DEFAULT 'Inter-facility transfer'
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_source_stock INTEGER;
    v_dest_stock INTEGER;
BEGIN
    IF p_quantity <= 0 THEN
        RAISE EXCEPTION 'Transfer quantity must be greater than zero';
    END IF;

    -- Lock source inventory row
    SELECT stock_quantity INTO v_source_stock
    FROM public.facility_inventories
    WHERE facility_id = p_from_facility_id
      AND medicine_id = p_medicine_id
      AND packaging_id = p_packaging_id
    FOR UPDATE;

    IF v_source_stock IS NULL OR v_source_stock < p_quantity THEN
        RAISE EXCEPTION 'Insufficient stock in source facility. Available: %, Requested: %', COALESCE(v_source_stock, 0), p_quantity;
    END IF;

    -- Deduct from source
    UPDATE public.facility_inventories
    SET stock_quantity = stock_quantity - p_quantity,
        updated_at = CURRENT_TIMESTAMP
    WHERE facility_id = p_from_facility_id
      AND medicine_id = p_medicine_id
      AND packaging_id = p_packaging_id;

    -- Add to destination
    INSERT INTO public.facility_inventories (facility_id, medicine_id, packaging_id, stock_quantity, updated_at)
    VALUES (p_to_facility_id, p_medicine_id, p_packaging_id, p_quantity, CURRENT_TIMESTAMP)
    ON CONFLICT (facility_id, medicine_id, packaging_id)
    DO UPDATE SET stock_quantity = facility_inventories.stock_quantity + EXCLUDED.stock_quantity,
                  updated_at = CURRENT_TIMESTAMP;

    -- Record transaction history
    INSERT INTO public.inventory_transactions (
        facility_id, medicine_id, transaction_type, change_quantity,
        previous_quantity, remaining_quantity, note, performed_by_id
    ) VALUES (
        p_from_facility_id, p_medicine_id, 'TRANSFER', -p_quantity,
        v_source_stock, v_source_stock - p_quantity, p_note, p_performed_by_id
    );

END;
$$;
