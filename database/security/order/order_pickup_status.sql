\set ON_ERROR_STOP on
BEGIN;
\if :{?bootstrap_current_functions}
-- Fresh bootstrap installs only the final definition.
\else
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
                OR (OLD.order_status = 'PROCESSING' AND NEW.order_status = 'CANCELLED')
                OR (OLD.order_status = 'PENDING_PICKUP' AND NEW.order_status = 'PICKED_UP' AND EXISTS (SELECT FROM public.shipments s WHERE s.order_id = OLD.id AND s.shipping_status = 'PICKED_UP'))
                OR (OLD.order_status = 'PICKED_UP' AND NEW.order_status = 'SHIPPING' AND EXISTS (SELECT FROM public.shipments s WHERE s.order_id = OLD.id AND s.shipping_status = 'IN_TRANSIT'))
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
            AND OLD.order_status IN ('PENDING', 'PROCESSING') AND NEW.order_status = 'PENDING_PICKUP' THEN
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
        IF op IN ('status', 'pack', 'receive') AND NEW.order_status IN ('PROCESSING', 'PENDING_PICKUP', 'PICKED_UP', 'SHIPPING', 'COMPLETED')
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
\endif
COMMIT;
