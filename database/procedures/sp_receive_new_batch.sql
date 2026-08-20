-- Procedure: sp_receive_new_batch
-- Inbounds new medicine batch and generates individual serialized box UIDs

CREATE OR REPLACE PROCEDURE public.sp_receive_new_batch(
    p_batch_number VARCHAR(100),
    p_medicine_id INTEGER,
    p_manufacturer_id INTEGER,
    p_mfg_date DATE,
    p_exp_date DATE,
    p_quantity INTEGER,
    p_facility_id INTEGER,
    p_co_cq TEXT DEFAULT NULL
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_batch_id INTEGER;
    i INTEGER;
BEGIN
    INSERT INTO public.medicine_batches (
        batch_number, medicine_id, manufacturer_id,
        manufacturing_date, expiry_date, initial_quantity,
        current_quantity, co_cq_certificate
    ) VALUES (
        p_batch_number, p_medicine_id, p_manufacturer_id,
        p_mfg_date, p_exp_date, p_quantity,
        p_quantity, p_co_cq
    ) RETURNING id INTO v_batch_id;

    -- Generate individual serialized box UIDs
    FOR i IN 1..p_quantity LOOP
        INSERT INTO public.medicine_boxes (
            uid, batch_id, current_facility_id, status
        ) VALUES (
            uuid_generate_v4(), v_batch_id, p_facility_id, 'IN_STOCK'
        );
    END LOOP;

    -- Update inventory balance
    INSERT INTO public.facility_inventories (facility_id, medicine_id, stock_quantity)
    VALUES (p_facility_id, p_medicine_id, p_quantity)
    ON CONFLICT (facility_id, medicine_id, packaging_id)
    DO UPDATE SET stock_quantity = facility_inventories.stock_quantity + EXCLUDED.stock_quantity;

END;
$$;
