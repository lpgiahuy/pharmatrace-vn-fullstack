\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install voucher release as a trusted superuser';
  END IF;
END $$;
DROP TRIGGER IF EXISTS release_rejected_prescription_voucher ON public.orders;
CREATE OR REPLACE FUNCTION public.release_cancelled_order_voucher() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.voucher_id IS NOT NULL AND NEW.order_status = 'CANCELLED'
    AND OLD.order_status IS DISTINCT FROM NEW.order_status THEN
    UPDATE public.vouchers SET used_quantity = used_quantity - 1 WHERE id = NEW.voucher_id AND used_quantity > 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'Voucher usage is inconsistent; cancellation rolled back'; END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.release_cancelled_order_voucher() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS release_cancelled_order_voucher ON public.orders;
CREATE TRIGGER release_cancelled_order_voucher AFTER UPDATE OF order_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.release_cancelled_order_voucher();
COMMIT;
