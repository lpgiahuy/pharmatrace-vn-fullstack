-- Function: fn_calculate_shipping_fee
-- Calculates dynamic shipping fee based on distance and order value

CREATE OR REPLACE FUNCTION public.fn_calculate_shipping_fee(
    p_distance_km DOUBLE PRECISION,
    p_subtotal NUMERIC(15, 2)
)
RETURNS NUMERIC(15, 2)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    -- Free shipping for orders above 500,000 VND
    IF p_subtotal >= 500000 THEN
        RETURN 0;
    END IF;

    IF p_distance_km IS NULL OR p_distance_km <= 5 THEN
        RETURN 15000;
    ELSIF p_distance_km <= 15 THEN
        RETURN 25000;
    ELSIF p_distance_km <= 30 THEN
        RETURN 35000;
    ELSE
        RETURN 35000 + ((p_distance_km - 30) * 1000);
    END IF;
END;
$$;
