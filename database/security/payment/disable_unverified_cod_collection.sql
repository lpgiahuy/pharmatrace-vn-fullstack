\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install COD controls as a trusted superuser';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.collect_shipment_cod(target_id integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE receipt integer;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER') THEN
    RAISE EXCEPTION 'COD collection is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT c.cashbook_id INTO receipt FROM public.logistics_cod_settlements c
    JOIN public.shipments s ON s.id = c.shipment_id JOIN public.orders o ON o.id = s.order_id
    WHERE s.id = target_id AND public.order_staff(o.export_facility_id) AND s.cod_settlement_status = 'SETTLED';
  IF receipt IS NULL THEN
    RAISE EXCEPTION 'Carrier statement and actual remittance evidence are required' USING ERRCODE = '22023';
  END IF;
  RETURN receipt;
END $$;
COMMIT;
