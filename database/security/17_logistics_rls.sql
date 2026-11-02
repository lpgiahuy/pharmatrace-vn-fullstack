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
COMMIT;
