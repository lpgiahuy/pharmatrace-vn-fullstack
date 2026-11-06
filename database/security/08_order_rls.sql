\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
    IF EXISTS (SELECT FROM pg_policies WHERE schemaname = 'public'
        AND tablename IN ('orders', 'order_items', 'shipments', 'internal_transfers', 'loyalty_point_logs')
        AND policyname NOT IN ('prescription_order_scope_select', 'prescription_order_scope_update',
            'order_read', 'order_insert', 'order_update', 'item_read', 'item_insert', 'item_update',
            'shipment_read', 'shipment_insert', 'shipment_update', 'transfer_read', 'transfer_insert', 'transfer_update', 'points_read', 'points_insert')) THEN
        RAISE EXCEPTION 'Existing order policies need manual review';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public.order_customer(owner_id integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT current_setting('app.current_user_type', true) = 'customer'
      AND current_setting('app.current_user_role', true) = 'CUSTOMER'
      AND owner_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
$$;
CREATE OR REPLACE FUNCTION public.order_staff(unit_id integer) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT current_setting('app.current_user_type', true) = 'employee'
      AND NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
      AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF')
      AND (current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
        OR unit_id = NULLIF(current_setting('app.current_unit_id', true), '')::integer)
$$;
CREATE OR REPLACE FUNCTION public.order_job() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT current_setting('app.order_operation', true) = 'loyalty'
      AND coalesce(current_setting('app.current_user_id', true), '') = ''
      AND coalesce(current_setting('app.current_user_type', true), '') = ''
      AND coalesce(current_setting('app.current_user_role', true), '') = ''
$$;
REVOKE ALL ON FUNCTION public.order_customer(integer), public.order_staff(integer), public.order_job() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_customer(integer), public.order_staff(integer), public.order_job() TO app_user;

CREATE OR REPLACE FUNCTION public.order_operation_allowed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
    SELECT CASE
      WHEN public.order_job() THEN true
      WHEN current_setting('app.order_operation', true) IN ('checkout', 'cancel') THEN
        public.order_customer(NULLIF(current_setting('app.current_user_id', true), '')::integer)
      WHEN current_setting('app.current_user_type', true) = 'employee' THEN
        CASE current_setting('app.order_operation', true)
          WHEN 'status' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST')
          WHEN 'pack' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF')
          WHEN 'dispatch' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF')
          WHEN 'receive' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF')
          WHEN 'replace' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF')
          WHEN 'prescription' THEN current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'PHARMACIST')
          ELSE false END
      ELSE false END
$$;
REVOKE ALL ON FUNCTION public.order_operation_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.order_operation_allowed() TO app_user;

CREATE OR REPLACE FUNCTION public.transfer_order_state(target_order integer)
RETURNS TABLE (order_status varchar, prescription_review_status varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT o.order_status, o.prescription_review_status FROM public.orders o
    WHERE o.id = target_order AND current_setting('app.order_operation', true) = 'dispatch'
      AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF')
      AND EXISTS (SELECT FROM public.internal_transfers t WHERE t.order_id = o.id AND public.order_staff(t.from_facility_id))
$$;
CREATE OR REPLACE FUNCTION public.product_has_order_history(target_medicine integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT CASE WHEN current_setting('app.order_operation', true) = 'read'
        AND current_setting('app.current_user_type', true) = 'employee'
        AND NULLIF(current_setting('app.current_user_id', true), '') IS NOT NULL
        AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER')
      THEN EXISTS (SELECT FROM public.order_items WHERE medicine_id = target_medicine) ELSE false END
$$;
REVOKE ALL ON FUNCTION public.transfer_order_state(integer), public.product_has_order_history(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_order_state(integer), public.product_has_order_history(integer) TO app_user;

REVOKE ALL ON public.orders, public.order_items, public.shipments, public.internal_transfers, public.loyalty_point_logs FROM PUBLIC, app_user;
GRANT SELECT ON public.orders, public.order_items, public.shipments, public.internal_transfers, public.loyalty_point_logs TO app_user;
GRANT INSERT (order_code, customer_id, export_facility_id, prescription_id, prescription_review_status,
    subtotal_amount, shipping_fee, discount_amount, used_points, total_amount, payment_method, payment_status,
    order_status, shipping_address, recipient_phone, recipient_name, note, created_at) ON public.orders TO app_user;
GRANT UPDATE (order_status, payment_status, note, prescription_review_status) ON public.orders TO app_user;
GRANT INSERT (order_id, medicine_id, variant_id, quantity, unit_price, total_price, assigned_uids,
    inventory_reserved, medicine_name, unit_name, source_facility_id) ON public.order_items TO app_user;
GRANT UPDATE (assigned_uids, inventory_reserved, source_facility_id) ON public.order_items TO app_user;
GRANT INSERT (order_id, tracking_number, courier_name, shipping_status, cod_amount, cod_settlement_status, note, created_at, updated_at) ON public.shipments TO app_user;
GRANT UPDATE (shipping_status, picked_up_at, actual_delivery_at, cod_settlement_status, cod_settled_at, updated_at, courier_name, tracking_number, carrier_confirmed_at) ON public.shipments TO app_user;
GRANT INSERT (transfer_code, order_id, from_facility_id, to_facility_id, status, items, distance_km, estimated_hours, notes, created_at, updated_at)
    ON public.internal_transfers TO app_user;
GRANT UPDATE (status, tracking_code, dispatched_at, received_at, notes, updated_at, transport_mode, transport_employee_id, transport_employee_name, courier_name) ON public.internal_transfers TO app_user;
GRANT INSERT (customer_id, order_id, transaction_type, points, description, created_at) ON public.loyalty_point_logs TO app_user;
REVOKE ALL ON SEQUENCE public.orders_id_seq, public.order_items_id_seq, public.shipments_id_seq,
    public.internal_transfers_id_seq, public.loyalty_point_logs_id_seq FROM PUBLIC, app_user;
GRANT USAGE ON SEQUENCE public.orders_id_seq, public.order_items_id_seq, public.shipments_id_seq,
    public.internal_transfers_id_seq, public.loyalty_point_logs_id_seq TO app_user;

CREATE OR REPLACE FUNCTION public.guard_order_write() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE op text := current_setting('app.order_operation', true); allowed text[];
BEGIN
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN RETURN NEW; END IF;
    IF public.order_operation_allowed() IS NOT TRUE THEN
        RAISE EXCEPTION 'Order operation is not authorized' USING ERRCODE = '42501';
    END IF;
    IF TG_TABLE_NAME = 'orders' THEN
        IF op = 'cancel' AND public.order_customer(OLD.customer_id)
            AND OLD.order_status IN ('PENDING', 'WAITING_INTERNAL_TRANSFER') AND NEW.order_status = 'CANCELLED' THEN
            allowed := ARRAY['order_status'];
        ELSIF op = 'status' AND public.order_staff(OLD.export_facility_id)
            AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST') THEN
            allowed := ARRAY['order_status', 'payment_status', 'note'];
            IF NEW.order_status = 'COMPLETED' AND OLD.order_status IS DISTINCT FROM NEW.order_status THEN
                RAISE EXCEPTION 'Customer receipt confirmation required' USING ERRCODE = '42501';
            END IF;
            IF NEW.order_status IS DISTINCT FROM OLD.order_status AND NOT (
                (OLD.order_status = 'PENDING' AND NEW.order_status IN ('WAITING_INTERNAL_TRANSFER', 'PROCESSING', 'CANCELLED'))
                OR (OLD.order_status IN ('WAITING_INTERNAL_TRANSFER', 'WAITING_TRANSFER') AND NEW.order_status IN ('PROCESSING', 'CANCELLED'))
                OR (OLD.order_status = 'PROCESSING' AND NEW.order_status IN ('SHIPPING', 'CANCELLED'))
                OR (OLD.order_status IN ('SHIPPING', 'IN_TRANSIT') AND NEW.order_status = 'COMPLETED')
                OR (OLD.order_status IN ('COMPLETED', 'DELIVERED') AND NEW.order_status IN ('RETURNED', 'PARTIALLY_RETURNED'))
                OR (OLD.order_status = 'DELIVERED' AND NEW.order_status = 'COMPLETED')
                OR (OLD.order_status = 'IN_TRANSIT' AND NEW.order_status = 'SHIPPING')
                OR (OLD.order_status = 'WAITING_TRANSFER' AND NEW.order_status = 'WAITING_INTERNAL_TRANSFER')
                OR (OLD.order_status = 'CANCELED' AND NEW.order_status = 'CANCELLED')
                OR (OLD.order_status = 'PARTIALLY_RETURNED' AND NEW.order_status = 'RETURNED')) THEN
                RAISE EXCEPTION 'Invalid order transition' USING ERRCODE = '42501';
            END IF;
        ELSIF op = 'pack' AND public.order_staff(OLD.export_facility_id)
            AND OLD.order_status IN ('PENDING', 'PROCESSING') AND NEW.order_status = 'SHIPPING' THEN
            allowed := ARRAY['order_status'];
        ELSIF op = 'receive' AND public.order_staff(OLD.export_facility_id)
            AND OLD.order_status = 'WAITING_INTERNAL_TRANSFER' AND NEW.order_status = 'PROCESSING' THEN
            allowed := ARRAY['order_status'];
        ELSIF op = 'prescription' AND public.order_staff(OLD.export_facility_id)
            AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'PHARMACIST')
            AND OLD.order_status IN ('PENDING', 'WAITING_INTERNAL_TRANSFER')
            AND NEW.prescription_review_status IN ('APPROVED', 'REJECTED')
            AND ((NEW.prescription_review_status = 'REJECTED' AND NEW.order_status = 'CANCELLED')
                OR (NEW.prescription_review_status = 'APPROVED' AND NEW.order_status = OLD.order_status)) THEN
            allowed := ARRAY['prescription_review_status', 'order_status'];
        END IF;
        IF op IN ('status', 'pack', 'receive') AND NEW.order_status IN ('PROCESSING', 'SHIPPING', 'COMPLETED')
            AND coalesce(NEW.prescription_review_status, 'APPROVED') <> 'APPROVED' THEN
            RAISE EXCEPTION 'Prescription approval is required' USING ERRCODE = '42501';
        END IF;
    ELSIF TG_TABLE_NAME = 'order_items' THEN
        IF op IN ('cancel', 'prescription', 'status') AND EXISTS (
            SELECT FROM public.orders o WHERE o.id = OLD.order_id AND o.order_status = 'CANCELLED') THEN
            allowed := ARRAY['assigned_uids', 'inventory_reserved'];
        ELSIF op IN ('pack', 'receive', 'replace') THEN allowed := ARRAY['assigned_uids', 'inventory_reserved', 'source_facility_id']; END IF;
    ELSIF TG_TABLE_NAME = 'shipments' AND op = 'status' THEN
        allowed := ARRAY['shipping_status', 'picked_up_at', 'actual_delivery_at', 'cod_settlement_status', 'cod_settled_at', 'updated_at'];
        IF NEW.shipping_status = 'DELIVERED' AND OLD.shipping_status IS DISTINCT FROM NEW.shipping_status THEN
            RAISE EXCEPTION 'Customer receipt confirmation required' USING ERRCODE = '42501';
        END IF;
        IF OLD.shipping_status = 'PENDING_PICKUP' AND NEW.shipping_status = 'PENDING_PICKUP' THEN
            allowed := allowed || ARRAY['courier_name', 'tracking_number', 'carrier_confirmed_at'];
        END IF;
    ELSIF TG_TABLE_NAME = 'internal_transfers' THEN
        IF op = 'dispatch' AND OLD.status = 'REQUESTED' AND NEW.status = 'DISPATCHED' THEN
            allowed := ARRAY['status', 'tracking_code', 'dispatched_at', 'updated_at', 'transport_mode', 'transport_employee_id', 'transport_employee_name', 'courier_name'];
            IF NEW.transport_mode IS NULL THEN
                RAISE EXCEPTION 'Transport method is required' USING ERRCODE = '42501';
            END IF;
            IF NEW.transport_mode = 'INTERNAL' AND NOT EXISTS (
                SELECT FROM public.transfer_transport_staff(OLD.id) e WHERE e.id = NEW.transport_employee_id AND e.full_name = NEW.transport_employee_name
            ) THEN RAISE EXCEPTION 'Invalid source transport employee' USING ERRCODE = '42501'; END IF;
        ELSIF op = 'receive' AND OLD.status = 'DISPATCHED' AND NEW.status = 'RECEIVED' THEN
            allowed := ARRAY['status', 'received_at', 'updated_at'];
        ELSIF op = 'replace' AND OLD.status IN ('DISPATCHED', 'REJECTED_UNFULFILLED') AND NEW.status IN ('REJECTED_UNFULFILLED', 'REPLACED') THEN
            allowed := ARRAY['status', 'notes', 'updated_at'];
        ELSIF op IN ('cancel', 'status', 'prescription') AND OLD.status <> 'RECEIVED' AND NEW.status = 'CANCELLED' THEN
            allowed := ARRAY['status', 'notes', 'updated_at']; END IF;
    END IF;
    IF allowed IS NULL OR (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
        RAISE EXCEPTION 'Order write touches protected fields or operation' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_order_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_order_write() TO app_user;
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'shipments', 'internal_transfers'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS order_write_guard ON public.%I', t);
        EXECUTE format('CREATE TRIGGER order_write_guard BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_order_write()', t);
    END LOOP;
END $$;

DROP POLICY IF EXISTS prescription_order_scope_select ON public.orders;
DROP POLICY IF EXISTS prescription_order_scope_update ON public.orders;
DROP POLICY IF EXISTS order_read ON public.orders;
CREATE POLICY order_read ON public.orders FOR SELECT TO app_user USING (
    public.order_customer(customer_id) OR public.order_staff(export_facility_id)
    OR (public.order_job() AND order_status = 'COMPLETED' AND customer_id IS NOT NULL));
DROP POLICY IF EXISTS order_insert ON public.orders;
CREATE POLICY order_insert ON public.orders FOR INSERT TO app_user WITH CHECK (
    current_setting('app.order_operation', true) = 'checkout' AND public.order_customer(customer_id)
    AND order_status IN ('PENDING', 'WAITING_INTERNAL_TRANSFER') AND payment_status = 'UNPAID'
    AND ((prescription_id IS NULL AND prescription_review_status IS NULL)
      OR (prescription_review_status = 'PENDING_APPROVAL' AND EXISTS (
        SELECT FROM public.prescriptions p WHERE p.id = orders.prescription_id AND p.customer_id = orders.customer_id))));
DROP POLICY IF EXISTS order_update ON public.orders;
CREATE POLICY order_update ON public.orders FOR UPDATE TO app_user
USING ((public.order_customer(customer_id) AND current_setting('app.order_operation', true) = 'cancel') OR public.order_staff(export_facility_id) OR public.order_job())
WITH CHECK (public.order_customer(customer_id) OR public.order_staff(export_facility_id));

DROP POLICY IF EXISTS item_read ON public.order_items;
CREATE POLICY item_read ON public.order_items FOR SELECT TO app_user USING (EXISTS (SELECT FROM public.orders o WHERE o.id = order_id));
DROP POLICY IF EXISTS item_insert ON public.order_items;
CREATE POLICY item_insert ON public.order_items FOR INSERT TO app_user WITH CHECK (
    current_setting('app.order_operation', true) = 'checkout' AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_customer(o.customer_id)));
DROP POLICY IF EXISTS item_update ON public.order_items;
CREATE POLICY item_update ON public.order_items FOR UPDATE TO app_user
USING (EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND (public.order_customer(o.customer_id) OR public.order_staff(o.export_facility_id))))
WITH CHECK (EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND (public.order_customer(o.customer_id) OR public.order_staff(o.export_facility_id))));

DROP POLICY IF EXISTS shipment_read ON public.shipments;
CREATE POLICY shipment_read ON public.shipments FOR SELECT TO app_user USING (EXISTS (SELECT FROM public.orders o WHERE o.id = order_id));
DROP POLICY IF EXISTS shipment_insert ON public.shipments;
CREATE POLICY shipment_insert ON public.shipments FOR INSERT TO app_user WITH CHECK (
    public.order_operation_allowed() AND current_setting('app.order_operation', true) = 'pack'
    AND cod_settlement_status = 'UNSETTLED' AND cod_settled_at IS NULL AND actual_delivery_at IS NULL
    AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id)
      AND o.order_status IN ('PENDING', 'PROCESSING') AND coalesce(o.prescription_review_status, 'APPROVED') = 'APPROVED'
      AND cod_amount = CASE WHEN o.payment_method = 'COD' THEN o.total_amount ELSE 0 END));
DROP POLICY IF EXISTS shipment_update ON public.shipments;
CREATE POLICY shipment_update ON public.shipments FOR UPDATE TO app_user USING (
    current_setting('app.order_operation', true) = 'status' AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id)))
WITH CHECK (EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id)));

DROP POLICY IF EXISTS transfer_read ON public.internal_transfers;
CREATE POLICY transfer_read ON public.internal_transfers FOR SELECT TO app_user USING (
    ((public.order_staff(from_facility_id) OR public.order_staff(to_facility_id))
      AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST', 'WAREHOUSE_STAFF'))
    OR EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND (public.order_customer(o.customer_id) OR public.order_staff(o.export_facility_id))));
DROP POLICY IF EXISTS transfer_insert ON public.internal_transfers;
CREATE POLICY transfer_insert ON public.internal_transfers FOR INSERT TO app_user WITH CHECK (public.order_operation_allowed() AND status = 'REQUESTED'
    AND from_facility_id <> to_facility_id AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND o.export_facility_id = to_facility_id
      AND ((current_setting('app.order_operation', true) = 'checkout' AND public.order_customer(o.customer_id))
        OR (current_setting('app.order_operation', true) = 'replace' AND public.order_staff(o.export_facility_id)))));
DROP POLICY IF EXISTS transfer_update ON public.internal_transfers;
CREATE POLICY transfer_update ON public.internal_transfers FOR UPDATE TO app_user
USING ((current_setting('app.order_operation', true) = 'dispatch' AND public.order_staff(from_facility_id))
    OR (current_setting('app.order_operation', true) IN ('receive', 'replace') AND public.order_staff(to_facility_id))
    OR (current_setting('app.order_operation', true) IN ('cancel', 'status', 'prescription') AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND o.order_status = 'CANCELLED')))
WITH CHECK (public.order_staff(from_facility_id) OR public.order_staff(to_facility_id)
    OR EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_customer(o.customer_id)));

ALTER TABLE public.loyalty_point_logs DROP CONSTRAINT IF EXISTS loyalty_point_logs_transaction_type_check;
ALTER TABLE public.loyalty_point_logs ADD CONSTRAINT loyalty_point_logs_transaction_type_check
    CHECK (transaction_type IN ('EARN', 'REDEEM', 'REDEEM_REVERSAL', 'EARN_REVERSAL', 'RANK_BONUS', 'RMA_DEDUCTION', 'ADMIN_ADJUSTMENT'));
CREATE UNIQUE INDEX IF NOT EXISTS loyalty_order_earn_once ON public.loyalty_point_logs(order_id)
    WHERE order_id IS NOT NULL AND transaction_type IN ('EARN', 'EARNED');
DROP POLICY IF EXISTS points_read ON public.loyalty_point_logs;
CREATE POLICY points_read ON public.loyalty_point_logs FOR SELECT TO app_user USING (public.order_customer(customer_id)
    OR public.order_job() OR EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id)));
DROP POLICY IF EXISTS points_insert ON public.loyalty_point_logs;
CREATE POLICY points_insert ON public.loyalty_point_logs FOR INSERT TO app_user WITH CHECK (
    public.order_operation_allowed() AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND o.customer_id = loyalty_point_logs.customer_id AND (
        (current_setting('app.order_operation', true) = 'checkout' AND public.order_customer(o.customer_id) AND transaction_type = 'REDEEM' AND points = -o.used_points AND points < 0)
        OR (current_setting('app.order_operation', true) IN ('cancel', 'status', 'prescription') AND o.order_status = 'CANCELLED'
            AND transaction_type = 'REDEEM_REVERSAL' AND points = o.used_points AND points > 0)
        OR (public.order_job() AND o.order_status = 'COMPLETED' AND transaction_type = 'EARN' AND points = floor(o.total_amount / 100) AND points > 0)
        OR (current_setting('app.order_operation', true) = 'status' AND public.order_staff(o.export_facility_id)
            AND o.order_status IN ('RETURNED', 'PARTIALLY_RETURNED') AND transaction_type = 'EARN_REVERSAL' AND points < 0))));
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'shipments', 'internal_transfers', 'loyalty_point_logs'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;
COMMIT;
