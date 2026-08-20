-- Trigger: trg_sync_order_to_shipment
-- Automatically creates a shipment record when an order is confirmed

CREATE OR REPLACE FUNCTION public.fn_sync_order_to_shipment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.order_status = 'PROCESSING' AND OLD.order_status = 'PENDING' THEN
        INSERT INTO public.shipments (
            order_id,
            tracking_number,
            courier_name,
            cod_amount,
            cod_status
        ) VALUES (
            NEW.id,
            'TRK-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 10)),
            'GiaoHangNhanh',
            CASE WHEN NEW.payment_method = 'COD' AND NEW.payment_status = 'UNPAID' THEN NEW.total_amount ELSE 0 END,
            CASE WHEN NEW.payment_method = 'COD' AND NEW.payment_status = 'UNPAID' THEN 'UNRECONCILED' ELSE 'SETTLED' END
        )
        ON CONFLICT (order_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_to_shipment ON public.orders;
CREATE TRIGGER trg_sync_order_to_shipment
AFTER UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_order_to_shipment();
