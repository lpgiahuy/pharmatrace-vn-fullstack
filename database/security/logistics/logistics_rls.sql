\set ON_ERROR_STOP on
BEGIN;
ALTER TABLE public.logistics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.logistics_events FROM PUBLIC, app_user;
GRANT SELECT ON public.logistics_events TO app_user;
DROP POLICY IF EXISTS logistics_events_read ON public.logistics_events;
CREATE POLICY logistics_events_read ON public.logistics_events FOR SELECT TO app_user USING (
 (shipment_id IS NOT NULL AND EXISTS (SELECT FROM public.shipments s WHERE s.id = shipment_id)) OR
 (transfer_id IS NOT NULL AND EXISTS (SELECT FROM public.internal_transfers t WHERE t.id = transfer_id))
);
ALTER TABLE public.logistics_cod_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_cod_settlements FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.logistics_cod_settlements FROM PUBLIC, app_user;
GRANT SELECT ON public.logistics_cod_settlements TO app_user;
DROP POLICY IF EXISTS logistics_cod_read ON public.logistics_cod_settlements;
CREATE POLICY logistics_cod_read ON public.logistics_cod_settlements FOR SELECT TO app_user USING (
 current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER') AND
 EXISTS (SELECT FROM public.shipments s WHERE s.id = shipment_id)
);
REVOKE ALL ON FUNCTION public.log_logistics_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.collect_shipment_cod(integer), public.cancel_internal_transfer(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_shipment_cod(integer), public.cancel_internal_transfer(integer) TO app_user;
-- Minimal staff projection for dispatch; never grant access to private employee rows.
CREATE OR REPLACE FUNCTION public.transfer_transport_staff(target_transfer integer)
RETURNS TABLE(id integer, full_name varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT e.id, e.full_name FROM public.employees e
 JOIN public.internal_transfers t ON t.from_facility_id = e.facility_id
 WHERE t.id = target_transfer AND e.status = 'ACTIVE'
 AND current_setting('app.order_operation', true) IN ('transfer_read', 'dispatch')
 AND current_setting('app.current_user_type', true) = 'employee'
 AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF')
 AND public.order_staff(t.from_facility_id)
 ORDER BY e.full_name, e.id
$$;
REVOKE ALL ON FUNCTION public.transfer_transport_staff(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_transport_staff(integer) TO app_user;
-- Expose the actor of an authorized logistics event without exposing employee rows.
CREATE OR REPLACE FUNCTION public.logistics_event_actor(target_event bigint)
RETURNS TABLE(actor_name varchar, actor_role varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT employee.full_name,employee.role
 FROM public.logistics_events event
 JOIN public.employees employee ON employee.id=event.actor_id
 WHERE event.id=target_event AND (event.actor_type IS NULL OR event.actor_type = 'employee')
 AND (event.shipment_id IS NOT NULL OR (event.transfer_id IS NOT NULL AND event.new_status NOT IN ('REQUESTED','CANCELLED')))
 AND current_setting('app.order_operation',true) IN ('read','transfer_read')
 AND current_setting('app.current_user_type',true)='employee'
 AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST','WAREHOUSE_STAFF')
 AND NULLIF(current_setting('app.current_user_id',true),'') IS NOT NULL
 AND (EXISTS (SELECT FROM public.shipments shipment JOIN public.orders ord ON ord.id=shipment.order_id
       WHERE shipment.id=event.shipment_id AND public.order_staff(ord.export_facility_id))
      OR EXISTS (SELECT FROM public.internal_transfers transfer WHERE transfer.id=event.transfer_id
       AND (public.order_staff(transfer.from_facility_id) OR public.order_staff(transfer.to_facility_id))))
$$;
REVOKE ALL ON FUNCTION public.logistics_event_actor(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_event_actor(bigint) TO app_user;
COMMIT;
