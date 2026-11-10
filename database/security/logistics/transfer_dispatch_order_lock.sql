\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.transfer_order_state(target_order integer)
RETURNS TABLE (order_status varchar, prescription_review_status varchar)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT o.order_status, o.prescription_review_status FROM public.orders o
    WHERE o.id = target_order AND current_setting('app.order_operation', true) = 'dispatch'
      AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF')
      AND EXISTS (SELECT FROM public.internal_transfers t WHERE t.order_id = o.id AND public.order_staff(t.from_facility_id))
    FOR UPDATE OF o
$$;
COMMIT;
