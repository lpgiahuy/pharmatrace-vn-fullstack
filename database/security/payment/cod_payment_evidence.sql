\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.require_cod_payment_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF coalesce(NEW.payment_method,'COD') = 'COD' AND NEW.payment_status = 'PAID'
    AND OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NOT EXISTS (
      SELECT FROM public.shipments s JOIN public.logistics_cod_settlements c ON c.shipment_id = s.id
        WHERE s.order_id = NEW.id AND s.cod_settlement_status = 'SETTLED' AND c.discrepancy_status = 'NONE'
    ) THEN RAISE EXCEPTION 'COD reconciliation evidence is required' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_cod_payment_evidence() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS require_cod_payment_evidence ON public.orders;
CREATE TRIGGER require_cod_payment_evidence BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.require_cod_payment_evidence();
COMMIT;
