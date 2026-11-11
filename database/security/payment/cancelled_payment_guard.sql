\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_cancelled_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.payment_status = 'PAID' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status
    AND NEW.order_status IN ('CANCELLED','CANCELED') THEN
    RAISE EXCEPTION 'Cancelled orders cannot be marked paid; reconcile late payments separately' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_cancelled_payment ON public.orders;
CREATE TRIGGER guard_cancelled_payment BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_cancelled_payment();
COMMIT;
