\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS public.shipment_return_authorizations (
  shipment_id integer NOT NULL REFERENCES public.shipments(id),
  variant_id integer NOT NULL REFERENCES public.packaging_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  approved_by integer NOT NULL REFERENCES public.employees(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, variant_id)
);
ALTER TABLE public.shipment_return_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_return_authorizations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_return_authorizations FROM PUBLIC, app_user;
GRANT SELECT, INSERT ON public.shipment_return_authorizations TO app_user;
DROP POLICY IF EXISTS return_authorization_read ON public.shipment_return_authorizations;
CREATE POLICY return_authorization_read ON public.shipment_return_authorizations FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = shipment_id AND public.order_staff(o.export_facility_id))
);
DROP POLICY IF EXISTS return_authorization_insert ON public.shipment_return_authorizations;
CREATE POLICY return_authorization_insert ON public.shipment_return_authorizations FOR INSERT TO app_user WITH CHECK (
  current_setting('app.order_operation', true) = 'status'
  AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST')
  AND approved_by = nullif(current_setting('app.current_user_id', true), '')::integer
  AND EXISTS (SELECT FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    JOIN public.order_items i ON i.order_id = o.id AND i.variant_id = shipment_return_authorizations.variant_id
    WHERE s.id = shipment_return_authorizations.shipment_id AND s.shipping_status = 'DELIVERED'
      AND public.order_staff(o.export_facility_id) AND shipment_return_authorizations.quantity <= i.quantity)
);
CREATE OR REPLACE FUNCTION public.guard_return_authorization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.shipping_status = 'DELIVERED' AND NEW.shipping_status = 'RETURN_REQUESTED'
    AND (NEW.return_category IS DISTINCT FROM 'POST_DELIVERY_RMA'
      OR NOT EXISTS (SELECT FROM public.shipment_return_authorizations a WHERE a.shipment_id = NEW.id)) THEN
    RAISE EXCEPTION 'Post-delivery returns require authorized item quantities' USING ERRCODE = '42501';
  END IF;
  IF OLD.shipping_status IN ('RETURN_REQUESTED','RETURN_IN_TRANSIT') AND NEW.shipping_status = 'RETURNED_TO_WAREHOUSE' THEN
    IF NOT EXISTS (SELECT FROM public.shipment_return_items r WHERE r.shipment_id = NEW.id)
      OR (OLD.return_category = 'POST_DELIVERY_RMA' AND EXISTS (
        SELECT FROM public.shipment_return_items r LEFT JOIN public.shipment_return_authorizations a
          ON a.shipment_id = r.shipment_id AND a.variant_id = r.variant_id
        WHERE r.shipment_id = NEW.id AND (a.variant_id IS NULL OR r.quantity > a.quantity))) THEN
      RAISE EXCEPTION 'Received items must be recorded and within approved quantities' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_return_authorization() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS guard_return_authorization ON public.shipments;
CREATE TRIGGER guard_return_authorization BEFORE UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.guard_return_authorization();
COMMIT;
