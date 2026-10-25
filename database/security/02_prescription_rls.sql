-- Override broad default privileges inherited when the review table is created.
REVOKE ALL PRIVILEGES ON public.order_prescription_reviews FROM app_user;
REVOKE ALL PRIVILEGES ON SEQUENCE public.order_prescription_reviews_id_seq FROM app_user;
GRANT SELECT, INSERT, UPDATE ON public.order_prescription_reviews TO app_user;
GRANT USAGE, SELECT ON SEQUENCE public.order_prescription_reviews_id_seq TO app_user;

ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_prescription_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_prescription_reviews FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prescription_order_scope_select ON public.orders;
CREATE POLICY prescription_order_scope_select ON public.orders FOR SELECT TO app_user
USING (
    current_setting('app.current_user_type', true) = 'employee'
    AND current_setting('app.current_user_role', true) IN ('PHARMACIST', 'SUPER_ADMIN')
    AND (
        current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
        OR export_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer
    )
);

DROP POLICY IF EXISTS prescription_order_scope_update ON public.orders;
CREATE POLICY prescription_order_scope_update ON public.orders FOR UPDATE TO app_user
USING (
    current_setting('app.current_user_type', true) = 'employee'
    AND current_setting('app.current_user_role', true) IN ('PHARMACIST', 'SUPER_ADMIN')
    AND (
        current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
        OR export_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer
    )
)
WITH CHECK (
    current_setting('app.current_user_type', true) = 'employee'
    AND current_setting('app.current_user_role', true) IN ('PHARMACIST', 'SUPER_ADMIN')
    AND (
        current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
        OR export_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer
    )
);

DROP POLICY IF EXISTS p_prescriptions ON public.prescriptions;

DROP POLICY IF EXISTS prescription_customer_insert ON public.prescriptions;
CREATE POLICY prescription_customer_insert ON public.prescriptions FOR INSERT TO app_user
WITH CHECK (
    current_setting('app.current_user_type', true) = 'customer'
    AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
);

DROP POLICY IF EXISTS prescription_scoped_select ON public.prescriptions;
CREATE POLICY prescription_scoped_select ON public.prescriptions FOR SELECT TO app_user
USING (
    (
        current_setting('app.current_user_type', true) = 'customer'
        AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
    )
    OR (
        current_setting('app.current_user_type', true) = 'employee'
        AND current_setting('app.current_user_role', true) IN ('PHARMACIST', 'SUPER_ADMIN')
        AND EXISTS (
            SELECT 1 FROM public.order_prescription_reviews review
            JOIN public.orders order_record ON order_record.id = review.order_id
            WHERE review.prescription_id = prescriptions.id
              AND (
                  current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
                  OR order_record.export_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer
              )
        )
    )
);

DROP POLICY IF EXISTS prescription_review_select ON public.order_prescription_reviews;
CREATE POLICY prescription_review_select ON public.order_prescription_reviews FOR SELECT TO app_user
USING (
    (
        current_setting('app.current_user_type', true) = 'customer'
        AND EXISTS (
            SELECT 1 FROM public.orders order_record
            WHERE order_record.id = order_id
              AND order_record.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
        )
    )
    OR (
        current_setting('app.current_user_type', true) = 'employee'
        AND current_setting('app.current_user_role', true) IN ('PHARMACIST', 'SUPER_ADMIN')
        AND (
            current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
            OR EXISTS (
                SELECT 1 FROM public.orders order_record
                WHERE order_record.id = order_id
                  AND order_record.export_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer
            )
        )
    )
);

DROP POLICY IF EXISTS prescription_review_customer_insert ON public.order_prescription_reviews;
CREATE POLICY prescription_review_customer_insert ON public.order_prescription_reviews FOR INSERT TO app_user
WITH CHECK (
    current_setting('app.current_user_type', true) = 'customer'
    AND status = 'PENDING_APPROVAL'
    AND EXISTS (
        SELECT 1 FROM public.orders order_record
        WHERE order_record.id = order_id
          AND order_record.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
          AND order_record.export_facility_id = facility_id
          AND order_record.prescription_id = order_prescription_reviews.prescription_id
    )
);

DROP POLICY IF EXISTS prescription_review_pharmacist_update ON public.order_prescription_reviews;
CREATE POLICY prescription_review_pharmacist_update ON public.order_prescription_reviews FOR UPDATE TO app_user
USING (
    current_setting('app.current_user_type', true) = 'employee'
    AND current_setting('app.current_user_role', true) IN ('PHARMACIST', 'SUPER_ADMIN')
    AND status = 'PENDING_APPROVAL'
    AND (
        current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
        OR EXISTS (
            SELECT 1 FROM public.orders order_record
            WHERE order_record.id = order_id
              AND order_record.export_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer
        )
    )
)
WITH CHECK (
    current_setting('app.current_user_type', true) = 'employee'
    AND status IN ('APPROVED', 'REJECTED')
    AND pharmacist_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
    AND (
        current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
        OR EXISTS (
            SELECT 1 FROM public.orders order_record
            WHERE order_record.id = order_id
              AND order_record.export_facility_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer
        )
    )
);
