\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.guard_transfer_payment() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.status = 'DISPATCHED' AND OLD.status IS DISTINCT FROM NEW.status AND EXISTS (
    SELECT FROM public.orders o WHERE o.id = NEW.order_id
      AND o.payment_method IN ('BANK_TRANSFER', 'E_WALLET') AND o.payment_status IS DISTINCT FROM 'PAID'
  ) THEN
    RAISE EXCEPTION 'Online payment must be completed before internal transfer dispatch' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_transfer_payment() FROM PUBLIC;
DROP TRIGGER IF EXISTS guard_transfer_payment ON public.internal_transfers;
CREATE TRIGGER guard_transfer_payment BEFORE UPDATE ON public.internal_transfers
FOR EACH ROW EXECUTE FUNCTION public.guard_transfer_payment();
CREATE OR REPLACE FUNCTION public.guard_packing_payment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.order_status = 'PENDING_PICKUP' AND OLD.order_status IS DISTINCT FROM NEW.order_status
    AND NEW.payment_method IN ('BANK_TRANSFER', 'E_WALLET') AND NEW.payment_status IS DISTINCT FROM 'PAID' THEN
    RAISE EXCEPTION 'Online payment must be completed before packing' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_packing_payment ON public.orders;
CREATE TRIGGER guard_packing_payment BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_packing_payment();
COMMIT;
