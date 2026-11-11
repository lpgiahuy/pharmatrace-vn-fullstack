\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=current_user AND rolsuper) THEN RAISE EXCEPTION 'Install logistics functions as a trusted superuser'; END IF;
END $$;

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
\endif


-- Scope source-facility reads and reservation updates to the returned transfer only.
CREATE OR REPLACE FUNCTION public.transfer_return_source(target_order integer, target_variant integer DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
 SELECT current_setting('app.order_operation', true) IN ('receive', 'transfer_read')
 AND EXISTS (SELECT FROM public.internal_transfers t WHERE t.order_id = target_order
   AND t.status = 'RETURN_REQUESTED' AND public.order_staff(t.from_facility_id)
   AND (target_variant IS NULL OR EXISTS (SELECT FROM jsonb_array_elements(t.items) item WHERE (item->>'variantId')::integer = target_variant)))
$$;
REVOKE ALL ON FUNCTION public.transfer_return_source(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_return_source(integer, integer) TO app_user;
DROP POLICY IF EXISTS order_transfer_return_read ON public.orders;
CREATE POLICY order_transfer_return_read ON public.orders FOR SELECT TO app_user
 USING (public.transfer_return_source(id));
DROP POLICY IF EXISTS item_transfer_return_update ON public.order_items;
CREATE POLICY item_transfer_return_update ON public.order_items FOR UPDATE TO app_user
 USING (current_setting('app.order_operation', true) = 'receive' AND public.order_staff(source_facility_id) AND public.transfer_return_source(order_id, variant_id))
 WITH CHECK (public.order_staff(source_facility_id) AND public.transfer_return_source(order_id, variant_id));
DROP POLICY IF EXISTS shipment_return_intake ON public.shipments;
CREATE POLICY shipment_return_intake ON public.shipments FOR UPDATE TO app_user
 USING (current_setting('app.order_operation', true) = 'receive' AND shipping_status IN ('RETURN_REQUESTED','RETURN_IN_TRANSIT')
   AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id)))
 WITH CHECK (shipping_status = 'RETURNED_TO_WAREHOUSE' AND EXISTS (SELECT FROM public.orders o WHERE o.id = order_id AND public.order_staff(o.export_facility_id)));

-- Pending discrepancies have no cashbook voucher. Never use a fabricated foreign key.
ALTER TABLE public.logistics_cod_settlements ALTER COLUMN cashbook_id DROP NOT NULL;
ALTER TABLE public.logistics_cod_settlements DROP CONSTRAINT IF EXISTS logistics_cod_settlements_amount_check;
ALTER TABLE public.logistics_cod_settlements ADD CONSTRAINT logistics_cod_settlements_amount_check CHECK (amount >= 0);
REVOKE INSERT, UPDATE ON public.logistics_cod_settlements FROM app_user;

\if :{?bootstrap_current_functions}
-- Fresh bootstrap installs only the final definition.
\else
CREATE OR REPLACE FUNCTION public.reconcile_shipment_cod(target_id integer, gross numeric, fee numeric, adjustment numeric, net numeric, statement text, reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s public.shipments%ROWTYPE; ord public.orders%ROWTYPE; previous public.logistics_cod_settlements%ROWTYPE;
 actor integer; cash_id integer; mismatch boolean; discrepancy text;
BEGIN
 IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
 OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
 OR coalesce(current_setting('app.current_user_role', true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER') THEN
   RAISE EXCEPTION 'COD reconciliation is not authorized' USING ERRCODE = '42501';
 END IF;
 actor := NULLIF(current_setting('app.current_user_id', true),'')::integer;
 IF actor IS NULL THEN RAISE EXCEPTION 'Missing actor' USING ERRCODE = '42501'; END IF;
 IF gross IS NULL OR fee IS NULL OR adjustment IS NULL OR net IS NULL OR least(gross,fee,net) < 0
 OR gross::text IN ('NaN','Infinity','-Infinity') OR fee::text IN ('NaN','Infinity','-Infinity')
 OR adjustment::text IN ('NaN','Infinity','-Infinity') OR net::text IN ('NaN','Infinity','-Infinity')
 OR gross <> round(gross,2) OR fee <> round(fee,2) OR adjustment <> round(adjustment,2) OR net <> round(net,2)
 OR statement IS NULL OR length(btrim(statement)) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Invalid COD statement' USING ERRCODE = '22023';
 END IF;
 -- Same lock order as customer receipt/dispute: order, then shipment.
 SELECT o.* INTO ord FROM public.orders o JOIN public.shipments sh ON sh.order_id=o.id WHERE sh.id=target_id AND public.order_staff(o.export_facility_id) FOR UPDATE OF o;
 IF NOT FOUND OR public.order_staff(ord.export_facility_id) IS NOT TRUE THEN
   RAISE EXCEPTION 'Shipment not found' USING ERRCODE = 'P0002';
 END IF;
 SELECT * INTO s FROM public.shipments WHERE id=target_id FOR UPDATE;
 SELECT * INTO previous FROM public.logistics_cod_settlements WHERE shipment_id=target_id;
 IF s.cod_settlement_status = 'SETTLED' OR previous.cashbook_id IS NOT NULL THEN
   RETURN jsonb_build_object('shipmentId',target_id,'status','SETTLED','cashbookId',previous.cashbook_id,'netAmount',previous.net_amount);
 END IF;
 IF s.cod_amount <= 0 OR (s.shipping_status <> 'DELIVERED' AND NOT (s.actual_delivery_at IS NOT NULL AND s.shipping_status IN ('RETURN_REQUESTED','RETURN_IN_TRANSIT','RETURNED_TO_WAREHOUSE'))) THEN RETURN NULL; END IF;
 mismatch := gross <> s.cod_amount OR net <> gross-fee+adjustment;
 discrepancy := CASE WHEN gross < s.cod_amount THEN 'UNDERPAID' WHEN gross > s.cod_amount THEN 'OVERPAID' WHEN mismatch THEN 'NET_MISMATCH' ELSE 'NONE' END;
 IF NOT mismatch THEN
   -- Gross plus adjustment minus one fee expense equals actual net remittance.
   INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,party_name,order_id,payment_method,note,created_by_user_id)
   VALUES ('COD-SHIP-'||s.id,'INCOME','COD',gross+adjustment,'OTHER',s.courier_name,s.order_id,'BANK_TRANSFER','Statement: '||btrim(statement),actor) RETURNING id INTO cash_id;
   IF fee > 0 THEN
     INSERT INTO public.cashbook_logs(transaction_code,transaction_type,category,amount,party_type,party_name,order_id,payment_method,created_by_user_id)
     VALUES ('COD-FEE-'||s.id,'EXPENSE','SHIPPING_FEE',fee,'OTHER',s.courier_name,s.order_id,'BANK_TRANSFER',actor);
   END IF;
 END IF;
 INSERT INTO public.logistics_cod_settlements(shipment_id,cashbook_id,amount,courier_fee,adjustment_amount,net_amount,statement_reference,discrepancy_amount,discrepancy_status,notes,collected_by)
 VALUES (target_id,cash_id,gross,fee,adjustment,net,btrim(statement),s.cod_amount-gross,discrepancy,reason,actor)
 ON CONFLICT (shipment_id) DO UPDATE SET cashbook_id=excluded.cashbook_id,amount=excluded.amount,courier_fee=excluded.courier_fee,
 adjustment_amount=excluded.adjustment_amount,net_amount=excluded.net_amount,statement_reference=excluded.statement_reference,
 discrepancy_amount=excluded.discrepancy_amount,discrepancy_status=excluded.discrepancy_status,notes=excluded.notes,collected_by=excluded.collected_by,collected_at=now();
 UPDATE public.shipments SET cod_settlement_status=CASE WHEN mismatch THEN 'DISCREPANCY_PENDING' ELSE 'SETTLED' END,
 cod_settled_at=CASE WHEN mismatch THEN NULL ELSE now() END,updated_at=now() WHERE id=target_id;
 IF NOT mismatch THEN UPDATE public.orders SET payment_status='PAID' WHERE id=s.order_id; END IF;
 RETURN jsonb_build_object('shipmentId',target_id,'status',CASE WHEN mismatch THEN 'DISCREPANCY_PENDING' ELSE 'SETTLED' END,
 'cashbookId',cash_id,'netAmount',net,'discrepancyAmount',s.cod_amount-gross,'discrepancyStatus',discrepancy);
END $$;
REVOKE ALL ON FUNCTION public.reconcile_shipment_cod(integer,numeric,numeric,numeric,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconcile_shipment_cod(integer,numeric,numeric,numeric,numeric,text,text) TO app_user;
\endif

-- Legacy collection shares the reconciliation lock and cannot bypass pending discrepancies.
CREATE OR REPLACE FUNCTION public.collect_shipment_cod(target_id integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE s public.shipments%ROWTYPE; result jsonb;
BEGIN
 IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status' OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee' OR coalesce(current_setting('app.current_user_role', true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER') THEN RAISE EXCEPTION 'COD collection is not authorized' USING ERRCODE='42501'; END IF;
 PERFORM o.id FROM public.orders o JOIN public.shipments sh ON sh.order_id=o.id WHERE sh.id=target_id AND public.order_staff(o.export_facility_id) FOR UPDATE OF o;
 IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO s FROM public.shipments WHERE id=target_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Shipment not found' USING ERRCODE='P0002'; END IF;
 IF s.cod_settlement_status = 'DISCREPANCY_PENDING' THEN RETURN NULL; END IF;
 result := public.reconcile_shipment_cod(target_id,s.cod_amount,0,0,s.cod_amount,'LEGACY-'||target_id,NULL);
 RETURN (result->>'cashbookId')::integer;
END $$;
COMMIT;
