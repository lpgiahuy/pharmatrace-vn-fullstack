\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_cancellation_safeguards() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  actor_role text := current_setting('app.current_user_role', true);
  actor_type text := current_setting('app.current_user_type', true);
BEGIN
  IF current_user = 'app_user' AND current_setting('app.order_operation', true) = 'status'
    AND NEW.payment_status = 'REFUNDED' AND OLD.payment_status IS DISTINCT FROM NEW.payment_status THEN
    RAISE EXCEPTION 'Refunds require a separate financial approval and payment record' USING ERRCODE = '42501';
  END IF;
  IF current_user <> 'app_user' OR NEW.order_status IS NOT DISTINCT FROM OLD.order_status OR NEW.order_status <> 'CANCELLED' THEN
    RETURN NEW;
  END IF;
  IF OLD.prescription_id IS NOT NULL AND OLD.prescription_review_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Approved prescription cancellation requires pharmacist confirmation' USING ERRCODE = '42501';
  END IF;
  IF actor_type = 'customer' AND (OLD.order_status NOT IN ('PENDING', 'WAITING_INTERNAL_TRANSFER', 'PROCESSING')
    OR EXISTS (SELECT FROM public.shipments WHERE order_id=OLD.id)) THEN
    RAISE EXCEPTION 'Customer cancellation is not allowed in this state' USING ERRCODE = '42501';
  END IF;
  IF actor_type = 'employee' AND current_setting('app.order_operation', true) = 'status' THEN
    IF nullif(btrim(NEW.note), '') IS NULL OR NEW.note IS NOT DISTINCT FROM OLD.note THEN
      RAISE EXCEPTION 'Cancellation reason is required' USING ERRCODE = '42501';
    END IF;
    IF OLD.order_status = 'PROCESSING' AND coalesce(actor_role, '') NOT IN ('STORE_MANAGER', 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'Export facility manager approval is required' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_cancellation_safeguards ON public.orders;
CREATE TRIGGER guard_cancellation_safeguards BEFORE UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_cancellation_safeguards();
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
            AND OLD.order_status IN ('PENDING', 'WAITING_INTERNAL_TRANSFER', 'PROCESSING') AND NEW.order_status = 'CANCELLED'
            AND NOT EXISTS (SELECT FROM public.shipments WHERE order_id=OLD.id) THEN
            allowed := ARRAY['order_status'];
        ELSIF op = 'status' AND public.order_staff(OLD.export_facility_id)
            AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'PHARMACIST') THEN
            allowed := ARRAY['order_status', 'payment_status', 'note'];
            IF NEW.order_status IS DISTINCT FROM OLD.order_status AND NOT (
                (OLD.order_status = 'PENDING' AND NEW.order_status IN ('WAITING_INTERNAL_TRANSFER', 'PROCESSING', 'CANCELLED'))
                OR (OLD.order_status IN ('WAITING_INTERNAL_TRANSFER', 'WAITING_TRANSFER') AND NEW.order_status IN ('PROCESSING', 'CANCELLED'))
                OR (OLD.order_status = 'PROCESSING' AND NEW.order_status = 'CANCELLED')
                OR (OLD.order_status = 'PENDING_PICKUP' AND NEW.order_status = 'PICKED_UP' AND EXISTS (SELECT FROM public.shipments s WHERE s.order_id = OLD.id AND s.shipping_status = 'PICKED_UP'))
                OR (OLD.order_status = 'PICKED_UP' AND NEW.order_status = 'SHIPPING' AND EXISTS (SELECT FROM public.shipments s WHERE s.order_id = OLD.id AND s.shipping_status = 'IN_TRANSIT'))
                OR (OLD.order_status IN ('SHIPPING', 'IN_TRANSIT') AND NEW.order_status = 'COMPLETED' AND EXISTS (SELECT FROM public.shipments sh WHERE sh.order_id = OLD.id AND sh.shipping_status = 'DELIVERED' AND nullif(btrim(sh.proof_reference),'') IS NOT NULL))
                OR (OLD.order_status IN ('COMPLETED', 'DELIVERED', 'SHIPPING', 'PICKED_UP') AND NEW.order_status IN ('RETURNED', 'PARTIALLY_RETURNED') AND EXISTS (SELECT FROM public.shipments sh WHERE sh.order_id=OLD.id AND sh.shipping_status='RETURNED_TO_WAREHOUSE' AND sh.return_qa_status='COMPLETED'))
                OR (OLD.order_status = 'DELIVERED' AND NEW.order_status = 'COMPLETED')
                OR (OLD.order_status = 'IN_TRANSIT' AND NEW.order_status = 'SHIPPING')
                OR (OLD.order_status = 'WAITING_TRANSFER' AND NEW.order_status = 'WAITING_INTERNAL_TRANSFER')
                OR (OLD.order_status = 'CANCELED' AND NEW.order_status = 'CANCELLED')
                OR (OLD.order_status = 'PARTIALLY_RETURNED' AND NEW.order_status = 'RETURNED')) THEN
                RAISE EXCEPTION 'Invalid order transition from % to %', OLD.order_status, NEW.order_status USING ERRCODE = '42501';
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
        ELSIF op IN ('pack', 'receive', 'replace') THEN
            allowed := ARRAY['assigned_uids', 'inventory_reserved', 'source_facility_id'];
        END IF;

    ELSIF TG_TABLE_NAME = 'shipments' THEN
      IF op = 'receive' AND OLD.shipping_status IN ('RETURN_REQUESTED', 'RETURN_IN_TRANSIT') AND NEW.shipping_status = 'RETURNED_TO_WAREHOUSE' THEN
        allowed := ARRAY['shipping_status', 'return_received_at', 'return_qa_status', 'delivery_notes', 'updated_at'];
      ELSIF op = 'status' THEN
        IF NEW.shipping_status = 'DELIVERED' AND OLD.shipping_status <> 'DELIVERED' AND (nullif(btrim(NEW.proof_reference),'') IS NULL OR nullif(btrim(NEW.delivered_to_name),'') IS NULL OR nullif(btrim(NEW.proof_type),'') IS NULL) THEN
          RAISE EXCEPTION 'Delivery evidence is required' USING ERRCODE='42501';
        END IF;
        allowed := ARRAY[
          'shipping_status', 'picked_up_at', 'actual_delivery_at', 'cod_settlement_status', 'cod_settled_at', 'updated_at',
          'proof_type', 'proof_reference', 'delivered_to_name', 'delivery_notes',
          'return_category', 'return_reason', 'return_qa_status', 'return_qa_notes', 'return_disposition',
          'return_received_at', 'return_disposed_at'
        ];
        IF OLD.shipping_status = 'PENDING_PICKUP' AND NEW.shipping_status = 'PENDING_PICKUP' THEN
            allowed := allowed || ARRAY['courier_name', 'tracking_number', 'carrier_confirmed_at'];
        END IF;

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
        ELSIF op = 'receive' AND OLD.status = 'DISPATCHED' AND NEW.status IN ('RECEIVED', 'PARTIALLY_RECEIVED', 'RECEIVED_WITH_DISCREPANCY') THEN
            allowed := ARRAY['status', 'received_at', 'updated_at', 'variance_details', 'discrepancy_status', 'notes'];
        ELSIF op = 'receive' AND OLD.status = 'RETURN_REQUESTED' AND NEW.status = 'RETURNED_TO_SOURCE' AND public.order_staff(OLD.from_facility_id) THEN
            allowed := ARRAY['status', 'returned_at', 'notes', 'updated_at'];
        ELSIF op = 'replace' AND OLD.status IN ('DISPATCHED', 'REJECTED_UNFULFILLED') AND NEW.status IN ('REJECTED_UNFULFILLED', 'REPLACED') THEN
            allowed := ARRAY['status', 'notes', 'updated_at'];
        ELSIF op IN ('cancel', 'status', 'prescription') AND OLD.status <> 'RECEIVED' AND NEW.status IN ('CANCELLED', 'RETURN_REQUESTED', 'RETURNED_TO_SOURCE') THEN
            allowed := ARRAY['status', 'notes', 'updated_at', 'return_reason', 'returned_at'];
        ELSIF op = 'dispatch' AND OLD.status = 'DISPATCHED' AND NEW.status IN ('RETURN_REQUESTED', 'RETURNED_TO_SOURCE') THEN
            allowed := ARRAY['status', 'notes', 'updated_at', 'return_reason', 'returned_at'];
        END IF;
    END IF;

    IF allowed IS NULL OR (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed) THEN
        RAISE EXCEPTION 'Order write touches protected fields or operation: % on %', op, TG_TABLE_NAME USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
END $$;
\if :{?bootstrap_current_functions}
\ir order_write_guard_trigger.sql
\endif
DROP POLICY IF EXISTS customer_cancellation_reason ON public.order_cancellation_reasons;
CREATE POLICY customer_cancellation_reason ON public.order_cancellation_reasons TO app_user
  USING (public.order_customer(customer_id))
  WITH CHECK (current_setting('app.order_operation', true) = 'cancel' AND public.order_customer(customer_id)
    AND EXISTS (SELECT FROM public.orders o WHERE o.id=order_cancellation_reasons.order_id
      AND o.customer_id=order_cancellation_reasons.customer_id
      AND o.order_status IN ('PENDING','WAITING_INTERNAL_TRANSFER','PROCESSING')
      AND NOT EXISTS (SELECT FROM public.shipments WHERE order_id=o.id)));
COMMIT;
