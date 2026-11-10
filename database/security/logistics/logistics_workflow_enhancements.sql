\set ON_ERROR_STOP on
BEGIN;

-- 1. Shipments enhancements: Proof of Delivery (PoD) and Returns (RMA & Failed Delivery)
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS proof_type varchar(50),
  ADD COLUMN IF NOT EXISTS proof_reference text,
  ADD COLUMN IF NOT EXISTS delivered_to_name varchar(150),
  ADD COLUMN IF NOT EXISTS delivery_notes text,
  ADD COLUMN IF NOT EXISTS return_category varchar(50),
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS return_qa_status varchar(50),
  ADD COLUMN IF NOT EXISTS return_qa_notes text,
  ADD COLUMN IF NOT EXISTS return_disposition varchar(50),
  ADD COLUMN IF NOT EXISTS return_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_disposed_at timestamptz;

CREATE OR REPLACE FUNCTION public.submit_delivery_dispute(target_order integer, dispute_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; shipment public.shipments%ROWTYPE;
BEGIN
 IF current_setting('app.order_operation', true) IS DISTINCT FROM 'customer_receive'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'customer'
    OR current_setting('app.current_user_role', true) IS DISTINCT FROM 'CUSTOMER' THEN
   RAISE EXCEPTION 'Customer dispute is not authorized' USING ERRCODE = '42501';
 END IF;
 IF dispute_reason IS NULL OR length(btrim(dispute_reason)) = 0 OR length(dispute_reason) > 500 THEN
   RAISE EXCEPTION 'Invalid dispute reason' USING ERRCODE = '22023';
 END IF;
 SELECT * INTO ord FROM public.orders WHERE id = target_order AND customer_id = NULLIF(current_setting('app.current_user_id', true), '')::integer FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 SELECT * INTO shipment FROM public.shipments WHERE order_id = ord.id FOR UPDATE;
 IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
 IF ord.order_status NOT IN ('COMPLETED', 'SHIPPING') THEN RETURN 'NOT_READY'; END IF;
 PERFORM set_config('app.logistics_reason', 'Customer delivery dispute', true);
 UPDATE public.shipments SET delivery_notes = '[DISPUTED] ' || btrim(dispute_reason) || ' | Prev: ' || coalesce(delivery_notes, ''), updated_at = now() WHERE id = shipment.id;
 RETURN 'SUBMITTED';
END $$;
REVOKE ALL ON FUNCTION public.submit_delivery_dispute(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_delivery_dispute(integer, text) TO app_user;

-- 2. Internal Transfers enhancements: Partial shortage/damage variance tracking & return workflow
ALTER TABLE public.internal_transfers
  ADD COLUMN IF NOT EXISTS variance_details jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS discrepancy_status varchar(50) DEFAULT 'NONE';

-- 3. COD Settlements enhancements: Gross, Courier Fees, Adjustments, Net Remittance & Discrepancy
ALTER TABLE public.logistics_cod_settlements
  ADD COLUMN IF NOT EXISTS courier_fee numeric(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS adjustment_amount numeric(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount numeric(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS statement_reference varchar(100),
  ADD COLUMN IF NOT EXISTS discrepancy_amount numeric(15, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discrepancy_status varchar(50) DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- 4. Update Permissions for app_user
GRANT UPDATE (
  shipping_status, picked_up_at, actual_delivery_at, cod_settlement_status, cod_settled_at, updated_at,
  courier_name, tracking_number, carrier_confirmed_at,
  proof_type, proof_reference, delivered_to_name, delivery_notes,
  return_category, return_reason, return_qa_status, return_qa_notes, return_disposition,
  return_received_at, return_disposed_at
) ON public.shipments TO app_user;

GRANT UPDATE (
  status, tracking_code, dispatched_at, received_at, notes, updated_at,
  transport_mode, transport_employee_id, transport_employee_name, courier_name,
  variance_details, return_reason, returned_at, discrepancy_status
) ON public.internal_transfers TO app_user;

-- Prisma inserts these defaulted columns explicitly when checkout creates a transfer.
GRANT INSERT (variance_details, discrepancy_status) ON public.internal_transfers TO app_user;

GRANT INSERT, UPDATE ON public.logistics_cod_settlements TO app_user;

DROP POLICY IF EXISTS transfer_update ON public.internal_transfers;
CREATE POLICY transfer_update ON public.internal_transfers FOR UPDATE TO app_user
USING ((current_setting('app.order_operation', true) = 'dispatch' AND public.order_staff(from_facility_id))
    OR (current_setting('app.order_operation', true) IN ('receive', 'replace') AND public.order_staff(to_facility_id))
    OR (current_setting('app.order_operation', true) = 'receive' AND status = 'RETURN_REQUESTED' AND public.order_staff(from_facility_id))
    OR (current_setting('app.order_operation', true) IN ('cancel', 'status', 'prescription') AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND o.order_status = 'CANCELLED')))
WITH CHECK (public.order_staff(from_facility_id) OR public.order_staff(to_facility_id)
    OR EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_customer(o.customer_id)));

-- 5. Safe Order Lock during transfer dispatch, receipt, and return
CREATE OR REPLACE FUNCTION public.transfer_order_state(target_order integer)
RETURNS TABLE (order_status varchar, prescription_review_status varchar)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
    SELECT o.order_status, o.prescription_review_status FROM public.orders o
    WHERE o.id = target_order AND current_setting('app.order_operation', true) IN ('dispatch', 'receive', 'replace', 'cancel', 'status')
      AND current_setting('app.current_user_role', true) IN ('SUPER_ADMIN', 'STORE_MANAGER', 'WAREHOUSE_STAFF', 'PHARMACIST')
      AND (
        current_setting('app.current_user_role', true) = 'SUPER_ADMIN'
        OR EXISTS (SELECT FROM public.internal_transfers t WHERE t.order_id = o.id AND (public.order_staff(t.from_facility_id) OR public.order_staff(t.to_facility_id)))
      )
    FOR UPDATE OF o
$$;
REVOKE ALL ON FUNCTION public.transfer_order_state(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_order_state(integer) TO app_user;

-- 6. Comprehensive Order & Logistics Write Guard
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
            AND OLD.order_status IN ('PENDING', 'WAITING_INTERNAL_TRANSFER', 'PROCESSING') AND NEW.order_status = 'CANCELLED' THEN
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
                OR (OLD.order_status IN ('SHIPPING', 'IN_TRANSIT') AND NEW.order_status = 'COMPLETED')
                OR (OLD.order_status IN ('COMPLETED', 'DELIVERED') AND NEW.order_status IN ('RETURNED', 'PARTIALLY_RETURNED'))
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

    ELSIF TG_TABLE_NAME = 'shipments' AND op = 'status' THEN
        allowed := ARRAY[
          'shipping_status', 'picked_up_at', 'actual_delivery_at', 'cod_settlement_status', 'cod_settled_at', 'updated_at',
          'proof_type', 'proof_reference', 'delivered_to_name', 'delivery_notes',
          'return_category', 'return_reason', 'return_qa_status', 'return_qa_notes', 'return_disposition',
          'return_received_at', 'return_disposed_at'
        ];
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
\endif

COMMIT;

