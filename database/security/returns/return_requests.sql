\set ON_ERROR_STOP on
-- Errors raised with ERRCODE 22023 carry an RMA_* code that the API maps to a user-facing message.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_user AND rolsuper) THEN
    RAISE EXCEPTION 'Install return request controls as a trusted superuser';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.return_requests (
  id serial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  order_id integer NOT NULL REFERENCES public.orders(id),
  customer_id integer REFERENCES public.customers(id),
  facility_id integer NOT NULL REFERENCES public.facilities(id),
  channel text NOT NULL CHECK (channel IN ('ONLINE','COUNTER','PHONE')),
  resolution text NOT NULL CHECK (resolution IN ('REFUND','EXCHANGE')),
  return_method text NOT NULL CHECK (return_method IN ('CARRIER_PICKUP','STORE_DROP_OFF')),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','NEEDS_INFO','APPROVED','REJECTED','CANCELLED',
    'RECEIVED','INSPECTED','REFUND_APPROVED','REFUNDED','CLOSED')),
  description text CHECK (length(description) <= 1000),
  pickup_address text CHECK (length(pickup_address) <= 500),
  customer_fee numeric(15,2) NOT NULL DEFAULT 0 CHECK (customer_fee >= 0),
  courier_name text,
  tracking_number text,
  staff_note text CHECK (length(staff_note) <= 1000),
  replacement_order_id integer UNIQUE REFERENCES public.orders(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS return_requests_one_open_per_order ON public.return_requests(order_id)
  WHERE status NOT IN ('REJECTED','CANCELLED','REFUNDED','CLOSED');

CREATE TABLE IF NOT EXISTS public.return_request_lines (
  request_id integer NOT NULL REFERENCES public.return_requests(id) ON DELETE CASCADE,
  order_item_id integer NOT NULL REFERENCES public.order_items(id),
  variant_id integer NOT NULL REFERENCES public.packaging_variants(id),
  quantity integer NOT NULL CHECK (quantity > 0),
  reason_code text NOT NULL CHECK (reason_code IN ('WRONG_ITEM','DAMAGED','EXPIRED_OR_NEAR_EXPIRY','QUALITY_ISSUE',
    'CHANGED_MIND','ORDERED_WRONG','NO_LONGER_NEEDED','OTHER')),
  reason_note text,
  restricted boolean NOT NULL DEFAULT false,
  exchange_variant_id integer REFERENCES public.packaging_variants(id),
  approved_quantity integer CHECK (approved_quantity BETWEEN 0 AND quantity),
  received_quantity integer CHECK (received_quantity BETWEEN 0 AND approved_quantity),
  box_uids uuid[] NOT NULL DEFAULT '{}',
  pass_quantity integer CHECK (pass_quantity >= 0),
  fail_quantity integer CHECK (fail_quantity >= 0),
  PRIMARY KEY (request_id, order_item_id),
  UNIQUE (request_id, variant_id),
  CHECK (NOT restricted OR coalesce(pass_quantity, 0) = 0)
);

-- Upgrade path for databases created before free-text reasons existed.
ALTER TABLE public.return_request_lines ADD COLUMN IF NOT EXISTS reason_note text;
ALTER TABLE public.return_request_lines DROP CONSTRAINT IF EXISTS return_request_lines_reason_code_check;
ALTER TABLE public.return_request_lines ADD CONSTRAINT return_request_lines_reason_code_check CHECK (reason_code IN ('WRONG_ITEM','DAMAGED',
  'EXPIRED_OR_NEAR_EXPIRY','QUALITY_ISSUE','CHANGED_MIND','ORDERED_WRONG','NO_LONGER_NEEDED','OTHER'));
ALTER TABLE public.return_request_lines DROP CONSTRAINT IF EXISTS return_request_lines_reason_note_check;
ALTER TABLE public.return_request_lines ADD CONSTRAINT return_request_lines_reason_note_check CHECK (
  reason_note IS NULL OR length(btrim(reason_note)) BETWEEN 1 AND 300);
-- Units that turned out not to be the product that was sold (another product, a counterfeit, an empty box).
-- They are never credited, whatever reason the customer gave.
ALTER TABLE public.return_request_lines ADD COLUMN IF NOT EXISTS mismatch_quantity integer;
ALTER TABLE public.return_request_lines DROP CONSTRAINT IF EXISTS return_request_lines_mismatch_quantity_check;
ALTER TABLE public.return_request_lines ADD CONSTRAINT return_request_lines_mismatch_quantity_check CHECK (mismatch_quantity >= 0);
ALTER TABLE public.return_request_lines DROP CONSTRAINT IF EXISTS return_request_lines_check2;
ALTER TABLE public.return_request_lines ADD CONSTRAINT return_request_lines_check2
  CHECK (pass_quantity + fail_quantity + coalesce(mismatch_quantity, 0) = received_quantity);
ALTER TABLE public.return_request_lines DROP CONSTRAINT IF EXISTS return_request_lines_other_reason_check;
ALTER TABLE public.return_request_lines ADD CONSTRAINT return_request_lines_other_reason_check CHECK (
  reason_code <> 'OTHER' OR reason_note IS NOT NULL);

CREATE TABLE IF NOT EXISTS public.return_attachments (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES public.return_requests(id) ON DELETE CASCADE,
  image_reference text NOT NULL,
  uploaded_by_type text NOT NULL CHECK (uploaded_by_type IN ('customer','employee')),
  uploaded_by_id integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.return_request_events (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES public.return_requests(id) ON DELETE CASCADE,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_type text,
  actor_id integer,
  actor_role text,
  actor_name text,
  facility_id integer,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.return_request_refunds (
  request_id integer PRIMARY KEY REFERENCES public.return_requests(id),
  goods_value numeric(15,2) NOT NULL CHECK (goods_value > 0),
  customer_fee numeric(15,2) NOT NULL CHECK (customer_fee >= 0 AND customer_fee < goods_value),
  refund_amount numeric(15,2) NOT NULL CHECK (refund_amount = goods_value - customer_fee),
  payment_method text NOT NULL CHECK (payment_method IN ('CASH','BANK_TRANSFER','DEBIT_CARD','E_WALLET')),
  payment_reference text CHECK (length(btrim(payment_reference)) BETWEEN 1 AND 100),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  approved_by integer NOT NULL REFERENCES public.employees(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  executed_by integer REFERENCES public.employees(id),
  executed_at timestamptz,
  cashbook_id integer UNIQUE REFERENCES public.cashbook_logs(id),
  UNIQUE (payment_method, payment_reference)
);

CREATE OR REPLACE FUNCTION public.log_return_request_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE actor integer := nullif(current_setting('app.current_user_id', true), '')::integer;
  kind text := nullif(current_setting('app.current_user_type', true), '');
BEGIN
  INSERT INTO public.return_request_events(request_id, action, from_status, to_status, actor_type, actor_id, actor_role, actor_name, facility_id, note)
  VALUES (NEW.id, coalesce(nullif(current_setting('app.rma_action', true), ''), NEW.status),
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END, NEW.status, kind, actor,
    nullif(current_setting('app.current_user_role', true), ''),
    CASE kind WHEN 'employee' THEN (SELECT full_name FROM public.employees WHERE id = actor)
              WHEN 'customer' THEN (SELECT full_name FROM public.customers WHERE id = actor) END,
    nullif(current_setting('app.current_unit_id', true), '')::integer,
    nullif(current_setting('app.rma_note', true), ''));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.log_return_request_event() FROM PUBLIC;
DROP TRIGGER IF EXISTS log_return_request_event ON public.return_requests;
CREATE TRIGGER log_return_request_event AFTER INSERT OR UPDATE ON public.return_requests
FOR EACH ROW EXECUTE FUNCTION public.log_return_request_event();

-- SECURITY DEFINER: transport requirements are manager-only, but the restriction applies to every caller.
CREATE OR REPLACE FUNCTION public.return_restricted_medicines(ids integer[]) RETURNS SETOF integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT m.id FROM public.medicines m WHERE m.id = ANY(ids)
    AND (coalesce(m.is_prescription, false) OR EXISTS (
      SELECT FROM public.medicine_transport_requirements r WHERE r.medicine_id = m.id AND r.condition <> 'APPROVED_STANDARD'))
$$;
REVOKE ALL ON FUNCTION public.return_restricted_medicines(integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_restricted_medicines(integer[]) TO app_user;

CREATE OR REPLACE FUNCTION public.return_request_visible(target integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT EXISTS (SELECT FROM public.return_requests r WHERE r.id = target
    AND (public.order_customer(r.customer_id) OR public.order_staff(r.facility_id)))
$$;
REVOKE ALL ON FUNCTION public.return_request_visible(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_request_visible(integer) TO app_user;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['return_requests','return_request_lines','return_attachments','return_request_events','return_request_refunds'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, app_user', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE ON public.return_requests, public.return_request_lines TO app_user;
GRANT SELECT, INSERT ON public.return_attachments TO app_user;
GRANT SELECT ON public.return_request_events, public.return_request_refunds TO app_user;
GRANT USAGE ON SEQUENCE public.return_requests_id_seq, public.return_attachments_id_seq TO app_user;

DROP POLICY IF EXISTS return_request_access ON public.return_requests;
CREATE POLICY return_request_access ON public.return_requests FOR ALL TO app_user
  USING (public.order_customer(customer_id) OR public.order_staff(facility_id))
  WITH CHECK ((public.order_customer(customer_id) OR public.order_staff(facility_id)) AND EXISTS (
    SELECT FROM public.orders o WHERE o.id = order_id
      AND o.customer_id IS NOT DISTINCT FROM return_requests.customer_id AND o.export_facility_id = return_requests.facility_id));
DROP POLICY IF EXISTS return_line_access ON public.return_request_lines;
CREATE POLICY return_line_access ON public.return_request_lines FOR ALL TO app_user
  USING (public.return_request_visible(request_id)) WITH CHECK (public.return_request_visible(request_id));
DROP POLICY IF EXISTS return_attachment_access ON public.return_attachments;
CREATE POLICY return_attachment_access ON public.return_attachments FOR ALL TO app_user
  USING (public.return_request_visible(request_id)) WITH CHECK (public.return_request_visible(request_id));
DROP POLICY IF EXISTS return_event_read ON public.return_request_events;
CREATE POLICY return_event_read ON public.return_request_events FOR SELECT TO app_user
  USING (public.return_request_visible(request_id));
DROP POLICY IF EXISTS return_refund_read ON public.return_request_refunds;
CREATE POLICY return_refund_read ON public.return_request_refunds FOR SELECT TO app_user
  USING (public.return_request_visible(request_id));

ALTER TABLE public.quarantine_movements DROP CONSTRAINT IF EXISTS quarantine_movements_origin_type_check;
ALTER TABLE public.quarantine_movements ADD CONSTRAINT quarantine_movements_origin_type_check CHECK (origin_type IN ('SHIPMENT','TRANSFER','TRANSFER_RETURN','RMA'));
CREATE OR REPLACE FUNCTION public.record_quarantine_movement(kind text, target integer, target_variant integer, movement text, units integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE facility integer; medicine integer; reference text; previous integer; current_balance integer; delta integer;
  available integer; actor integer; operation text := current_setting('app.order_operation', true); log_id integer;
BEGIN
  actor := nullif(current_setting('app.current_user_id', true),'')::integer;
  IF actor IS NULL OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER','PHARMACIST','WAREHOUSE_STAFF')
    OR kind NOT IN ('SHIPMENT','TRANSFER','TRANSFER_RETURN','RMA') OR units IS NULL OR units <= 0 THEN
    RAISE EXCEPTION 'Invalid quarantine movement' USING ERRCODE = '42501';
  END IF;
  IF kind = 'SHIPMENT' THEN
    SELECT o.export_facility_id, i.medicine_id, s.tracking_number, r.quantity
      INTO facility, medicine, reference, available
      FROM public.shipments s JOIN public.orders o ON o.id = s.order_id
      JOIN public.order_items i ON i.order_id = o.id AND i.variant_id = target_variant
      JOIN public.shipment_return_items r ON r.shipment_id = s.id AND r.variant_id = i.variant_id
      WHERE s.id = target AND ((movement = 'IN' AND operation = 'receive' AND s.shipping_status IN ('RETURN_REQUESTED','RETURN_IN_TRANSIT'))
        OR (movement IN ('RESTOCK','FAILED_QA') AND operation = 'status' AND s.shipping_status = 'RETURNED_TO_WAREHOUSE' AND s.return_qa_status = 'PENDING_INSPECTION'));
  ELSIF kind = 'RMA' THEN
    SELECT r.facility_id, i.medicine_id, r.code, l.received_quantity
      INTO facility, medicine, reference, available
      FROM public.return_requests r JOIN public.return_request_lines l ON l.request_id = r.id
      JOIN public.order_items i ON i.id = l.order_item_id
      WHERE r.id = target AND l.variant_id = target_variant
        AND ((movement = 'IN' AND operation = 'receive' AND r.status = 'APPROVED')
          OR (movement IN ('RESTOCK','FAILED_QA') AND operation = 'status' AND r.status = 'RECEIVED'));
  ELSE
    SELECT CASE WHEN kind = 'TRANSFER_RETURN' THEN t.from_facility_id ELSE t.to_facility_id END, i.medicine_id, t.transfer_code, (line->>'quantity')::integer
      INTO facility, medicine, reference, available
      FROM public.internal_transfers t JOIN public.order_items i ON i.order_id = t.order_id
      CROSS JOIN LATERAL jsonb_array_elements(t.items) line
      WHERE t.id = target AND i.variant_id = target_variant AND i.variant_id = (line->>'variantId')::integer
        AND ((kind = 'TRANSFER' AND t.status = 'DISPATCHED') OR (kind = 'TRANSFER_RETURN' AND t.status = 'RETURN_REQUESTED'))
        AND operation = 'receive' AND movement = 'IN';
  END IF;
  IF facility IS NULL OR medicine IS NULL OR public.order_staff(facility) IS NOT TRUE OR units > available THEN
    RAISE EXCEPTION 'Quarantine movement is not authorized or exceeds the recorded goods' USING ERRCODE = '42501';
  END IF;
  delta := CASE movement WHEN 'IN' THEN units WHEN 'RESTOCK' THEN -units ELSE 0 END;
  INSERT INTO public.quarantine_balances(facility_id,variant_id,quantity) VALUES (facility,target_variant,0) ON CONFLICT DO NOTHING;
  UPDATE public.quarantine_balances SET quantity = quantity + delta
    WHERE facility_id = facility AND variant_id = target_variant AND quantity + delta >= 0 RETURNING quantity INTO current_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'Quarantine balance is insufficient; reconcile prior intake first' USING ERRCODE = '22023'; END IF;
  previous := current_balance - delta;
  INSERT INTO public.inventory_logs(facility_id,medicine_id,variant_id,stock_bucket,transaction_type,quantity_changed,previous_quantity,new_quantity,reference_code,note,performed_by_id)
    VALUES(facility,medicine,target_variant,'QUARANTINE',CASE movement WHEN 'IN' THEN 'QUARANTINE_IN' WHEN 'RESTOCK' THEN 'QUARANTINE_TO_STOCK' ELSE 'QUARANTINE_FAILED_QA' END,
      delta,previous,current_balance,reference,format('%s: %s units',movement,units),actor) RETURNING id INTO log_id;
  INSERT INTO public.quarantine_movements(origin_type,origin_id,variant_id,action,inventory_log_id) VALUES (kind,target,target_variant,movement,log_id);
  RETURN log_id;
END $$;
REVOKE ALL ON FUNCTION public.record_quarantine_movement(text,integer,integer,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_quarantine_movement(text,integer,integer,text,integer) TO app_user;

CREATE OR REPLACE FUNCTION public.lock_return_request(target integer, roles text[]) RETURNS public.return_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE request public.return_requests%ROWTYPE;
BEGIN
  IF current_setting('app.order_operation', true) IS DISTINCT FROM 'status'
    OR current_setting('app.current_user_type', true) IS DISTINCT FROM 'employee'
    OR coalesce(current_setting('app.current_user_role', true), '') <> ALL (roles) THEN
    RAISE EXCEPTION 'Return request action is not authorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO request FROM public.return_requests WHERE id = target FOR UPDATE;
  IF NOT FOUND OR public.order_staff(request.facility_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'RMA_NOT_FOUND' USING ERRCODE = '22023';
  END IF;
  RETURN request;
END $$;
REVOKE ALL ON FUNCTION public.lock_return_request(integer, text[]) FROM PUBLIC;

-- Share of list price the customer actually paid for goods: order-level vouchers and points are spread over every
-- line in proportion to its value, so a partial return refunds what was paid, not the list price.
CREATE OR REPLACE FUNCTION public.return_paid_ratio(target_order integer) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN coalesce(sum(i.total_price), 0) <= 0 THEN 1
    ELSE least(1, greatest(o.total_amount - coalesce(o.shipping_fee, 0), 0) / sum(i.total_price)) END
  FROM public.orders o LEFT JOIN public.order_items i ON i.order_id = o.id
  WHERE o.id = target_order GROUP BY o.id
$$;
REVOKE ALL ON FUNCTION public.return_paid_ratio(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.return_paid_ratio(integer) TO app_user;

-- Units credited back to the customer. Pharmacy faults are credited in full; for customer-choice reasons only
-- units that passed inspection count, so goods damaged or used by the customer are not refunded or replaced.
-- Units that are not the product sold are never credited.
DROP FUNCTION IF EXISTS public.return_line_credit_quantity(text, integer, integer, integer) CASCADE;
CREATE OR REPLACE FUNCTION public.return_line_credit_quantity(reason text, approved integer, received integer, passed integer, mismatched integer)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN reason IN ('CHANGED_MIND','ORDERED_WRONG','NO_LONGER_NEEDED','OTHER') AND passed IS NOT NULL THEN passed
    ELSE greatest(coalesce(received, approved, 0) - coalesce(mismatched, 0), 0) END
$$;
REVOKE ALL ON FUNCTION public.return_line_credit_quantity(text, integer, integer, integer, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.return_request_goods_value(target integer) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT coalesce(round(sum(public.return_line_credit_quantity(l.reason_code, l.approved_quantity, l.received_quantity, l.pass_quantity, l.mismatch_quantity)
      * i.unit_price) * public.return_paid_ratio(r.order_id), 0), 0)
  FROM public.return_requests r
  JOIN public.return_request_lines l ON l.request_id = r.id
  JOIN public.order_items i ON i.id = l.order_item_id
  WHERE r.id = target GROUP BY r.order_id
$$;
REVOKE ALL ON FUNCTION public.return_request_goods_value(integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.return_replacement_lines(target integer)
RETURNS TABLE(quantity integer, variant_id integer, medicine_id integer, unit_name text, medicine_name text, unit_price numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT public.return_line_credit_quantity(l.reason_code, l.approved_quantity, l.received_quantity, l.pass_quantity, l.mismatch_quantity),
    v.id, v.medicine_id, v.unit_name::text, m.medicine_name::text,
    -- The same pack size is replaced at the price that was paid, so a voucher on the original order is not charged again.
    CASE WHEN v.id = l.variant_id THEN round(i.unit_price * public.return_paid_ratio(i.order_id), 0)
      WHEN (coalesce(v.discount_percent, 0) > 0 OR v.price < v.original_price) AND now() BETWEEN v.sale_start_date AND v.sale_end_date
      THEN v.price ELSE coalesce(v.original_price, v.price) END
  FROM public.return_request_lines l
  JOIN public.order_items i ON i.id = l.order_item_id
  JOIN public.packaging_variants v ON v.id = coalesce(l.exchange_variant_id, l.variant_id)
  JOIN public.medicines m ON m.id = v.medicine_id
  WHERE l.request_id = target AND public.return_line_credit_quantity(l.reason_code, l.approved_quantity, l.received_quantity, l.pass_quantity, l.mismatch_quantity) > 0
$$;
REVOKE ALL ON FUNCTION public.return_replacement_lines(integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_return_replacement_order(target integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE request public.return_requests%ROWTYPE; original public.orders%ROWTYPE; line record;
  returned numeric; replacement numeric := 0; total numeric; new_order integer;
BEGIN
  request := public.lock_return_request(target, ARRAY['SUPER_ADMIN','STORE_MANAGER','PHARMACIST']);
  IF request.resolution <> 'EXCHANGE' OR request.replacement_order_id IS NOT NULL THEN
    RAISE EXCEPTION 'RMA_EXCHANGE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  -- A wrong item is the pharmacy's mistake, so the replacement may ship before the goods come back, but only when
  -- the claim can be checked later: every line has tracked boxes (receipt must scan the boxes we sold) and the
  -- customer sent photos. Otherwise wait for inspection, so a swapped parcel cannot earn a free replacement.
  IF NOT (request.status = 'INSPECTED' OR (request.status = 'APPROVED'
    AND NOT EXISTS (SELECT FROM public.return_request_lines l JOIN public.order_items i ON i.id = l.order_item_id
      WHERE l.request_id = target AND (l.reason_code <> 'WRONG_ITEM' OR cardinality(coalesce(i.assigned_uids, '{}')) = 0))
    AND EXISTS (SELECT FROM public.return_attachments a WHERE a.request_id = target AND a.uploaded_by_type = 'customer'))) THEN
    RAISE EXCEPTION 'RMA_EXCHANGE_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO original FROM public.orders WHERE id = request.order_id;
  returned := public.return_request_goods_value(target);
  SELECT coalesce(sum(quantity * unit_price), 0) INTO replacement FROM public.return_replacement_lines(target);
  total := greatest(replacement - returned, 0) + request.customer_fee;
  INSERT INTO public.orders(order_code, customer_id, export_facility_id, prescription_id, prescription_review_status,
      subtotal_amount, shipping_fee, discount_amount, total_amount, payment_method, payment_status, order_status,
      shipping_address, recipient_name, recipient_phone, note)
    VALUES ('EXC-' || substr(request.code, 5), original.customer_id, request.facility_id, original.prescription_id,
      original.prescription_review_status, replacement, request.customer_fee, least(returned, replacement), total, 'COD',
      CASE WHEN total = 0 THEN 'PAID' ELSE 'UNPAID' END, 'PENDING',
      original.shipping_address, original.recipient_name, original.recipient_phone, 'Replacement order for ' || request.code)
    RETURNING id INTO new_order;
  FOR line IN SELECT * FROM public.return_replacement_lines(target) LOOP
    UPDATE public.inventories SET reserved_quantity = coalesce(reserved_quantity, 0) + line.quantity, updated_at = now()
      WHERE facility_id = request.facility_id AND variant_id = line.variant_id
        AND stock_quantity - coalesce(reserved_quantity, 0) >= line.quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'RMA_EXCHANGE_OUT_OF_STOCK' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.order_items(order_id, medicine_id, variant_id, quantity, unit_price, total_price, medicine_name, unit_name,
        inventory_reserved, source_facility_id)
      VALUES (new_order, line.medicine_id, line.variant_id, line.quantity, line.unit_price, line.quantity * line.unit_price,
        line.medicine_name, line.unit_name, true, request.facility_id);
  END LOOP;
  PERFORM set_config('app.rma_action', 'EXCHANGE_ORDER_CREATED', true);
  PERFORM set_config('app.rma_note', format('Replacement order #%s created, customer pays %s', new_order, total), true);
  UPDATE public.return_requests SET replacement_order_id = new_order, updated_at = now() WHERE id = target;
  RETURN jsonb_build_object('orderId', new_order, 'totalAmount', total);
END $$;
REVOKE ALL ON FUNCTION public.create_return_replacement_order(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_return_replacement_order(integer) TO app_user;

CREATE OR REPLACE FUNCTION public.approve_return_request_refund(target integer, method text, reason_text text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE request public.return_requests%ROWTYPE; original public.orders%ROWTYPE; goods numeric; fee numeric; already numeric;
BEGIN
  request := public.lock_return_request(target, ARRAY['SUPER_ADMIN','STORE_MANAGER']);
  IF request.status <> 'INSPECTED' OR (request.resolution = 'EXCHANGE' AND request.replacement_order_id IS NULL) THEN
    RAISE EXCEPTION 'RMA_REFUND_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO original FROM public.orders WHERE id = request.order_id FOR UPDATE;
  IF original.payment_status NOT IN ('PAID','PARTIALLY_REFUNDED') THEN RAISE EXCEPTION 'RMA_ORDER_NOT_PAID' USING ERRCODE = '22023'; END IF;
  -- Earlier refunds on the same order (approved or paid) use up what the customer paid, so several partial
  -- returns can never add up to more than the goods portion of the order.
  SELECT coalesce(sum(f.goods_value), 0) INTO already FROM public.return_request_refunds f
    JOIN public.return_requests r ON r.id = f.request_id WHERE r.order_id = original.id AND f.request_id <> target;
  goods := least(public.return_request_goods_value(target)
      - coalesce((SELECT subtotal_amount FROM public.orders WHERE id = request.replacement_order_id), 0),
    greatest(original.total_amount - coalesce(original.shipping_fee, 0) - already, 0));
  fee := CASE WHEN request.resolution = 'REFUND' THEN request.customer_fee ELSE 0 END;
  IF goods <= 0 OR goods - fee <= 0 THEN RAISE EXCEPTION 'RMA_NOTHING_TO_REFUND' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.return_request_refunds(request_id, goods_value, customer_fee, refund_amount, payment_method, reason, approved_by)
    VALUES (target, goods, fee, goods - fee, method, btrim(reason_text), current_setting('app.current_user_id')::integer);
  PERFORM set_config('app.rma_note', format('Refund of %s approved via %s: %s', goods - fee, method, btrim(reason_text)), true);
  UPDATE public.return_requests SET status = 'REFUND_APPROVED', updated_at = now() WHERE id = target;
  RETURN jsonb_build_object('refundAmount', goods - fee, 'goodsValue', goods, 'customerFee', fee);
END $$;
REVOKE ALL ON FUNCTION public.approve_return_request_refund(integer, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_return_request_refund(integer, text, text) TO app_user;

CREATE OR REPLACE FUNCTION public.record_return_request_refund(target integer, reference text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE request public.return_requests%ROWTYPE; original public.orders%ROWTYPE; refund public.return_request_refunds%ROWTYPE;
  actor integer := nullif(current_setting('app.current_user_id', true), '')::integer; cash_id integer;
  earned integer; reversed integer; points_to_reverse integer; refunded_goods numeric;
BEGIN
  request := public.lock_return_request(target, ARRAY['SUPER_ADMIN','STORE_MANAGER']);
  IF request.status <> 'REFUND_APPROVED' THEN RAISE EXCEPTION 'RMA_REFUND_NOT_APPROVED' USING ERRCODE = '22023'; END IF;
  SELECT * INTO original FROM public.orders WHERE id = request.order_id FOR UPDATE;
  SELECT * INTO refund FROM public.return_request_refunds WHERE request_id = target FOR UPDATE;
  INSERT INTO public.cashbook_logs(transaction_code, transaction_type, category, amount, party_type, order_id, payment_method, note, created_by_user_id)
    VALUES ('REF-' || gen_random_uuid()::text, 'EXPENSE', 'CUSTOMER_REFUND', refund.refund_amount, 'CUSTOMER', original.id,
      refund.payment_method, request.code || ' - refund reference: ' || btrim(reference), actor) RETURNING id INTO cash_id;
  UPDATE public.return_request_refunds SET payment_reference = btrim(reference), cashbook_id = cash_id, executed_by = actor, executed_at = now()
    WHERE request_id = target;
  IF original.customer_id IS NOT NULL THEN
    SELECT coalesce(sum(points) FILTER (WHERE transaction_type = 'EARN'), 0),
      -coalesce(sum(points) FILTER (WHERE transaction_type IN ('EARN_REVERSAL','RMA_DEDUCTION')), 0)
      INTO earned, reversed FROM public.loyalty_point_logs WHERE order_id = original.id;
    points_to_reverse := least(greatest(earned - reversed, 0), floor(refund.goods_value / 100)::integer);
    IF points_to_reverse > 0 THEN
      UPDATE public.customers SET reward_points = coalesce(reward_points, 0) - points_to_reverse WHERE id = original.customer_id;
      INSERT INTO public.loyalty_point_logs(customer_id, order_id, transaction_type, points, description)
        VALUES (original.customer_id, original.id, 'RMA_DEDUCTION', -points_to_reverse, 'Points reversed after ' || request.code);
    END IF;
  END IF;
  SELECT coalesce(sum(f.goods_value), 0) INTO refunded_goods FROM public.return_request_refunds f
    JOIN public.return_requests r ON r.id = f.request_id WHERE r.order_id = original.id AND f.executed_at IS NOT NULL;
  -- Shipping is never refunded, so "fully refunded" means every paid unit of goods has been paid back.
  UPDATE public.orders SET payment_status = CASE
      WHEN refunded_goods >= greatest(original.total_amount - coalesce(original.shipping_fee, 0), 0) THEN 'REFUNDED'
      ELSE 'PARTIALLY_REFUNDED' END
    WHERE id = original.id;
  PERFORM set_config('app.rma_note', format('Refund of %s paid, reference %s, cashbook #%s', refund.refund_amount, btrim(reference), cash_id), true);
  UPDATE public.return_requests SET status = 'REFUNDED', updated_at = now() WHERE id = target;
  RETURN jsonb_build_object('refundAmount', refund.refund_amount, 'cashbookId', cash_id);
END $$;
REVOKE ALL ON FUNCTION public.record_return_request_refund(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_return_request_refund(integer, text) TO app_user;
COMMIT;
