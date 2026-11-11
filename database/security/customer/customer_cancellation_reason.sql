\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS public.order_cancellation_reasons (
  order_id integer PRIMARY KEY REFERENCES public.orders(id),
  customer_id integer NOT NULL REFERENCES public.customers(id),
  reason_code text NOT NULL CHECK (reason_code IN ('CHANGED_MIND', 'ADDRESS_CHANGE', 'OTHER')),
  reason_details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reason_code <> 'OTHER' OR nullif(btrim(reason_details), '') IS NOT NULL)
);
ALTER TABLE public.order_cancellation_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_cancellation_reasons FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_cancellation_reasons FROM PUBLIC, app_user;
GRANT SELECT, INSERT ON public.order_cancellation_reasons TO app_user;
DROP POLICY IF EXISTS customer_cancellation_reason ON public.order_cancellation_reasons;
CREATE POLICY customer_cancellation_reason ON public.order_cancellation_reasons TO app_user
  USING (public.order_customer(customer_id))
  WITH CHECK (current_setting('app.order_operation', true) = 'cancel' AND public.order_customer(customer_id)
    AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_cancellation_reasons.order_id AND o.customer_id = order_cancellation_reasons.customer_id
      AND o.order_status IN ('PENDING', 'WAITING_INTERNAL_TRANSFER')));
CREATE OR REPLACE FUNCTION public.require_customer_cancellation_reason() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'app_user' AND current_setting('app.order_operation', true) = 'cancel'
    AND NEW.order_status = 'CANCELLED' AND OLD.order_status IS DISTINCT FROM NEW.order_status
    AND NOT EXISTS (SELECT FROM public.order_cancellation_reasons r WHERE r.order_id = OLD.id AND r.customer_id = OLD.customer_id) THEN
    RAISE EXCEPTION 'Customer cancellation reason is required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS require_customer_cancellation_reason ON public.orders;
CREATE TRIGGER require_customer_cancellation_reason BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.require_customer_cancellation_reason();
COMMIT;
