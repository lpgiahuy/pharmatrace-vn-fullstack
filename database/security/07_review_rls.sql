\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('reviews', 'moderation_reports', 'moderation_audit_logs')
        AND policyname NOT IN ('review_read', 'review_insert', 'review_update', 'review_delete',
            'review_report_read', 'review_report_insert', 'review_report_update', 'review_audit_read', 'review_audit_insert')) THEN
        RAISE EXCEPTION 'Existing review policies need manual review';
    END IF;
    IF EXISTS (SELECT FROM pg_constraint WHERE conrelid = 'public.moderation_audit_logs'::regclass
        AND confrelid = 'public.reviews'::regclass AND contype = 'f'
        AND conname <> 'moderation_audit_logs_review_id_fkey') THEN
        RAISE EXCEPTION 'Audit foreign key needs manual review';
    END IF;
END $$;
-- Preserve review eligibility while retiring legacy order-status spellings.
UPDATE public.orders
SET order_status = CASE WHEN upper(btrim(order_status)) = 'HOANTHANH' THEN 'COMPLETED'
    ELSE upper(btrim(order_status)) END
WHERE upper(btrim(order_status)) IN ('HOANTHANH', 'DELIVERED', 'COMPLETED')
    AND order_status NOT IN ('DELIVERED', 'COMPLETED');
ALTER TABLE public.moderation_audit_logs DROP CONSTRAINT IF EXISTS moderation_audit_logs_review_id_fkey;
ALTER TABLE public.moderation_audit_logs ADD CONSTRAINT moderation_audit_logs_review_id_fkey
    FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE SET NULL;

REVOKE ALL ON public.reviews, public.moderation_reports, public.moderation_audit_logs FROM PUBLIC, app_user;
GRANT SELECT, DELETE ON public.reviews TO app_user;
GRANT INSERT (customer_id, medicine_id, rating_stars, comment, images, status, is_verified_purchase, helpful_count, created_at)
    ON public.reviews TO app_user;
GRANT UPDATE (rating_stars, comment, images, status, helpful_count, admin_reply, replied_at, replied_by_name)
    ON public.reviews TO app_user;
GRANT SELECT ON public.moderation_reports, public.moderation_audit_logs TO app_user;
GRANT INSERT (review_id, reporter_customer_id, reporter_employee_id, reason, description, status, created_at)
    ON public.moderation_reports TO app_user;
GRANT UPDATE (status, resolved_by_employee_id, resolver_note, resolved_at) ON public.moderation_reports TO app_user;
GRANT INSERT (review_id, action, performed_by_employee_id, performed_by_customer_id, performed_by_role, reason, meta, created_at)
    ON public.moderation_audit_logs TO app_user;
REVOKE ALL ON SEQUENCE public.reviews_id_seq, public.moderation_reports_id_seq, public.moderation_audit_logs_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.reviews_id_seq, public.moderation_reports_id_seq, public.moderation_audit_logs_id_seq TO app_user;

CREATE OR REPLACE FUNCTION public.review_context(required_scope text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT current_setting('app.review_scope', true) = required_scope
      AND NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
      AND CASE required_scope
        WHEN 'customer' THEN current_setting('app.current_user_type', true) = 'customer'
            AND current_setting('app.current_user_role', true) = 'CUSTOMER'
        WHEN 'staff' THEN current_setting('app.current_user_type', true) = 'employee'
            AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER', 'SALES_STAFF', 'PHARMACIST')
        WHEN 'moderator' THEN current_setting('app.current_user_type', true) = 'employee'
            AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'ADMIN')
        ELSE false END
$$;
REVOKE ALL ON FUNCTION public.review_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_context(text) TO app_user;

CREATE OR REPLACE FUNCTION public.guard_review_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE allowed_columns text[];
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN RETURN NEW; END IF;
    IF public.review_context('customer') AND OLD.customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer THEN
        allowed_columns := ARRAY['rating_stars', 'comment', 'images', 'status'];
        IF OLD.status IS DISTINCT FROM 'APPROVED' AND NEW.status = 'APPROVED' THEN
            RAISE EXCEPTION 'A moderated review needs staff approval' USING ERRCODE = '42501';
        END IF;
    ELSIF public.review_context('staff') THEN
        allowed_columns := ARRAY['admin_reply', 'replied_at', 'replied_by_name'];
    ELSIF public.review_context('moderator') THEN
        allowed_columns := ARRAY['status', 'admin_reply', 'replied_at', 'replied_by_name'];
    ELSIF current_setting('app.review_scope', true) = 'helpful' THEN
        allowed_columns := ARRAY['helpful_count'];
    ELSE
        RAISE EXCEPTION 'Review update context is missing' USING ERRCODE = '42501';
    END IF;
    IF (to_jsonb(NEW) - allowed_columns) IS DISTINCT FROM (to_jsonb(OLD) - allowed_columns) THEN
        RAISE EXCEPTION 'Review update touches protected columns' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_review_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_review_update() TO app_user;
DROP TRIGGER IF EXISTS review_update_columns ON public.reviews;
CREATE TRIGGER review_update_columns BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.guard_review_update();

DROP POLICY IF EXISTS review_read ON public.reviews;
CREATE POLICY review_read ON public.reviews FOR SELECT TO app_user USING (
    status = 'APPROVED' OR public.review_context('staff') OR public.review_context('moderator')
    OR (public.review_context('customer') AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer));
DROP POLICY IF EXISTS review_insert ON public.reviews;
CREATE POLICY review_insert ON public.reviews FOR INSERT TO app_user WITH CHECK (
    public.review_context('customer') AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
    AND status IN ('APPROVED', 'PENDING', 'SPAM') AND is_verified_purchase AND helpful_count = 0
    AND EXISTS (SELECT FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
        WHERE oi.medicine_id = reviews.medicine_id AND o.customer_id = reviews.customer_id
        AND o.order_status IN ('DELIVERED', 'COMPLETED')));
DROP POLICY IF EXISTS review_update ON public.reviews;
CREATE POLICY review_update ON public.reviews FOR UPDATE TO app_user
USING (public.review_context('staff') OR public.review_context('moderator')
    OR (public.review_context('customer') AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer)
    OR (current_setting('app.review_scope', true) = 'helpful' AND status = 'APPROVED'))
WITH CHECK (status IN ('APPROVED', 'PENDING', 'HIDDEN', 'SPAM') AND helpful_count >= 0
    AND (public.review_context('staff') OR public.review_context('moderator')
    OR (public.review_context('customer') AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer)
    OR (current_setting('app.review_scope', true) = 'helpful' AND status = 'APPROVED')));
DROP POLICY IF EXISTS review_delete ON public.reviews;
CREATE POLICY review_delete ON public.reviews FOR DELETE TO app_user USING (public.review_context('moderator')
    OR (public.review_context('customer') AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer));

DROP POLICY IF EXISTS review_report_read ON public.moderation_reports;
CREATE POLICY review_report_read ON public.moderation_reports FOR SELECT TO app_user USING (public.review_context('moderator')
    OR (public.review_context('customer') AND reporter_customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer));
DROP POLICY IF EXISTS review_report_insert ON public.moderation_reports;
CREATE POLICY review_report_insert ON public.moderation_reports FOR INSERT TO app_user WITH CHECK (
    public.review_context('customer') AND reporter_customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
    AND reporter_employee_id IS NULL AND status = 'PENDING' AND resolved_by_employee_id IS NULL AND resolved_at IS NULL
    AND EXISTS (SELECT FROM public.reviews r WHERE r.id = review_id));
DROP POLICY IF EXISTS review_report_update ON public.moderation_reports;
CREATE POLICY review_report_update ON public.moderation_reports FOR UPDATE TO app_user
USING (public.review_context('moderator')) WITH CHECK (public.review_context('moderator')
    AND resolved_by_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer AND status IN ('RESOLVED', 'DISMISSED'));

DROP POLICY IF EXISTS review_audit_read ON public.moderation_audit_logs;
CREATE POLICY review_audit_read ON public.moderation_audit_logs FOR SELECT TO app_user USING (public.review_context('moderator'));
DROP POLICY IF EXISTS review_audit_insert ON public.moderation_audit_logs;
CREATE POLICY review_audit_insert ON public.moderation_audit_logs FOR INSERT TO app_user WITH CHECK (
    performed_by_role = current_setting('app.current_user_role', true)
    AND ((public.review_context('customer') AND performed_by_customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
        AND performed_by_employee_id IS NULL
        AND action IN ('AUTO_APPROVE', 'AUTO_FLAG_PENDING', 'AUTO_FLAG_SPAM', 'CUSTOMER_EDIT', 'CUSTOMER_DELETE', 'USER_REPORT'))
      OR ((public.review_context('staff') OR public.review_context('moderator'))
        AND performed_by_employee_id = NULLIF(current_setting('app.current_user_id', true), '')::integer AND performed_by_customer_id IS NULL
        AND (action = 'ADMIN_REPLY' OR (public.review_context('moderator')
            AND (action LIKE 'ADMIN_STATUS_%' OR action IN ('ADMIN_DELETE', 'RESOLVE_REPORT', 'DISMISS_REPORT'))))))
    AND EXISTS (SELECT FROM public.reviews r WHERE r.id = review_id));

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.moderation_audit_logs FORCE ROW LEVEL SECURITY;
COMMIT;
