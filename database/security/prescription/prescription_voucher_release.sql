\set ON_ERROR_STOP on
BEGIN;

-- This trigger runs as its owner so the pharmacist never receives voucher-management privileges.
CREATE OR REPLACE FUNCTION public.release_rejected_prescription_voucher() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    IF NEW.voucher_id IS NOT NULL
        AND OLD.prescription_review_status IS DISTINCT FROM 'REJECTED'
        AND NEW.prescription_review_status = 'REJECTED'
        AND NEW.order_status = 'CANCELLED' THEN
        UPDATE public.vouchers
        SET used_quantity = used_quantity - 1
        WHERE id = NEW.voucher_id AND used_quantity > 0;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Voucher usage is inconsistent; prescription rejection rolled back';
        END IF;
    END IF;
    RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION public.release_rejected_prescription_voucher() FROM PUBLIC, app_user;

DROP TRIGGER IF EXISTS release_rejected_prescription_voucher ON public.orders;
CREATE TRIGGER release_rejected_prescription_voucher
AFTER UPDATE OF prescription_review_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.release_rejected_prescription_voucher();
COMMIT;
