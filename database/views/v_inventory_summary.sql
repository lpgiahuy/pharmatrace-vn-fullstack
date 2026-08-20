-- View: v_inventory_summary
-- Summarizes real-time stock levels across all facilities

CREATE OR REPLACE VIEW public.v_inventory_summary AS
SELECT 
    f.id AS facility_id,
    f.name AS facility_name,
    f.type AS facility_type,
    m.id AS medicine_id,
    m.name AS medicine_name,
    m.registration_number,
    c.name AS category_name,
    ps.name AS packaging_name,
    fi.stock_quantity,
    fi.reserved_quantity,
    (fi.stock_quantity - fi.reserved_quantity) AS available_quantity,
    fi.updated_at
FROM public.facility_inventories fi
JOIN public.facilities f ON fi.facility_id = f.id
JOIN public.medicines m ON fi.medicine_id = m.id
LEFT JOIN public.categories c ON m.category_id = c.id
LEFT JOIN public.packaging_specifications ps ON fi.packaging_id = ps.id;
