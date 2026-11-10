\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_cancellation_safeguards() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  actor_role text := current_setting('app.current_user_role', true);
  actor_type text := current_setting('app.current_user_type', true);
BEGIN
  IF current_user = 'app_user' AND current_setting('app.order_operation', true) = 'status'
    AND NEW.payment_status = 'REFUNDED' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    RAISE EXCEPTION 'Refunds require a separate financial approval and payment record' USING ERRCODE = '42501';
  END IF;
  IF current_user <> 'app_user' OR NEW.order_status IS NOT DISTINCT FROM OLD.order_status OR NEW.order_status <> 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  IF OLD.prescription_id IS NOT NULL AND OLD.prescription_review_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved prescription cancellation requires pharmacist confirmation' USING ERRCODE = '42501';
  END IF;
  IF actor_type = 'customer' AND OLD.order_status NOT IN ('PENDING', 'WAITING_INTERNAL_TRANSFER') THEN
    RAISE EXCEPTION 'Customer cancellation is not allowed in this state' USING ERRCODE = '42501';
  END IF;
  IF actor_type = 'employee' AND current_setting('app.order_operation', true) = 'status' THEN
    IF nullif(btrim(NEW.note), '') IS NULL OR NEW.note IS NOT DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = '42501';
    END IF;
    IF OLD.order_status = 'PROCESSING' AND coalesce(actor_role, '') NOT IN ('STORE_MANAGER', 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'Export facility manager approval is required' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_cancellation_safeguards ON public.orders;
CREATE TRIGGER guard_cancellation_safeguards BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_cancellation_safeguards();
COMMIT;
