-- View: v_batch_management
-- Provides expiration and quarantine monitoring for medicine batches

CREATE OR REPLACE VIEW public.v_batch_management AS
SELECT 
    b.id AS batch_id,
    b.batch_number,
    m.id AS medicine_id,
    m.name AS medicine_name,
    f.name AS manufacturer_name,
    b.manufacturing_date,
    b.expiry_date,
    b.initial_quantity,
    b.current_quantity,
    b.status AS batch_status,
    (b.expiry_date - CURRENT_DATE) AS days_until_expiry,
    CASE 
        WHEN b.expiry_date < CURRENT_DATE THEN 'EXPIRED'
        WHEN b.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'EXPIRING_SOON'
        ELSE 'VALID'
    END AS shelf_life_status
FROM public.medicine_batches b
JOIN public.medicines m ON b.medicine_id = m.id
LEFT JOIN public.facilities f ON b.manufacturer_id = f.id;
