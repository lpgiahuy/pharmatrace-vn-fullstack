\set ON_ERROR_STOP on
BEGIN;

-- In-transit boxes have no facility, so the facility-based policy hides them from every non-bypass staff member
-- and the destination manager cannot confirm receipt. This opens only the boxes of a transfer that is being received.
CREATE OR REPLACE FUNCTION public.transit_box_receivable(box_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
    SELECT current_setting('app.current_user_type', true) = 'employee'
      AND current_setting('app.order_operation', true) = 'receive'
      AND NULLIF(current_setting('app.current_unit_id', true), '') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.internal_transfers t
        JOIN public.order_items oi ON oi.order_id = t.order_id
        WHERE box_uid = ANY (oi.assigned_uids)
          AND ((t.status = 'DISPATCHED' AND t.to_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer)
            OR (t.status = 'RETURN_REQUESTED' AND t.from_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer)))
$$;
REVOKE ALL ON FUNCTION public.transit_box_receivable(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transit_box_receivable(uuid) TO app_user;

DROP POLICY IF EXISTS transit_box_receipt ON public.medicine_boxes;
CREATE POLICY transit_box_receipt ON public.medicine_boxes FOR ALL TO app_user
    USING (current_facility_id IS NULL AND status = 'IN_TRANSIT' AND public.transit_box_receivable(uid))
    WITH CHECK (public.transit_box_receivable(uid));
COMMIT;
