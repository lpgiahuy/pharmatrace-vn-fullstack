\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE IF NOT EXISTS public.shipment_return_items (
  shipment_id integer NOT NULL REFERENCES public.shipments(id),
  variant_id integer NOT NULL REFERENCES public.packaging_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  box_uids uuid[] NOT NULL DEFAULT '{}',
  received_by integer NOT NULL REFERENCES public.employees(id),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, variant_id),
  CHECK (cardinality(box_uids) = 0 OR cardinality(box_uids) = quantity)
);
ALTER TABLE public.shipment_return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_return_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.shipment_return_items FROM PUBLIC, app_user;
GRANT SELECT, INSERT ON public.shipment_return_items TO app_user;
DROP POLICY IF EXISTS return_item_read ON public.shipment_return_items;
CREATE POLICY return_item_read ON public.shipment_return_items FOR SELECT TO app_user USING (
  EXISTS (SELECT FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = shipment_id AND public.order_staff(o.export_facility_id))
);
DROP POLICY IF EXISTS return_item_insert ON public.shipment_return_items;
CREATE POLICY return_item_insert ON public.shipment_return_items FOR INSERT TO app_user WITH CHECK (
  current_setting('app.order_operation', true) = 'receive'
  AND received_by = nullif(current_setting('app.current_user_id', true), '')::integer
  AND EXISTS (SELECT FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
    JOIN public.order_items i ON i.order_id = o.id AND i.variant_id = shipment_return_items.variant_id
    WHERE s.id = shipment_return_items.shipment_id AND public.order_staff(o.export_facility_id)
      AND s.shipping_status IN ('RETURN_REQUESTED', 'RETURN_IN_TRANSIT')
      AND shipment_return_items.quantity <= i.quantity
      AND ((cardinality(i.assigned_uids) = 0 AND cardinality(shipment_return_items.box_uids) = 0)
        OR (cardinality(shipment_return_items.box_uids) = shipment_return_items.quantity
          AND shipment_return_items.box_uids <@ i.assigned_uids)))
);
COMMIT;
