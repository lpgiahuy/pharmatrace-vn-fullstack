\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION public.start_paid_order_transfers() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.payment_status = 'PAID'
    AND NEW.order_status = 'PENDING' AND NEW.payment_method IN ('BANK_TRANSFER', 'E_WALLET')
    AND EXISTS (SELECT FROM public.internal_transfers t WHERE t.order_id = NEW.id AND t.status = 'REQUESTED') THEN
    UPDATE public.orders SET order_status = 'WAITING_INTERNAL_TRANSFER' WHERE id = NEW.id AND order_status = 'PENDING';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.start_paid_order_transfers() FROM PUBLIC, app_user;
DROP TRIGGER IF EXISTS start_paid_order_transfers ON public.orders;
CREATE TRIGGER start_paid_order_transfers AFTER UPDATE OF payment_status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.start_paid_order_transfers();

CREATE OR REPLACE FUNCTION public.expire_unpaid_orders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; item public.order_items%ROWTYPE; changed integer; expired integer := 0;
BEGIN
  IF public.order_job() IS NOT TRUE THEN
    RAISE EXCEPTION 'Payment expiration requires the order job context' USING ERRCODE = '42501';
  END IF;
  FOR ord IN SELECT * FROM public.orders o WHERE o.order_status = 'PENDING' AND o.payment_status = 'UNPAID'
    AND ((o.payment_method = 'E_WALLET' AND o.created_at <= now() - interval '15 minutes')
      OR (o.payment_method = 'BANK_TRANSFER' AND o.created_at <= now() - interval '30 minutes'))
    AND NOT EXISTS (SELECT FROM public.internal_transfers t WHERE t.order_id = o.id AND t.status <> 'REQUESTED' AND t.status <> 'CANCELLED')
    ORDER BY o.id LIMIT 100 FOR UPDATE OF o SKIP LOCKED
  LOOP
    UPDATE public.internal_transfers SET status = 'CANCELLED', notes = 'Payment expired before dispatch', updated_at = now()
      WHERE order_id = ord.id AND status = 'REQUESTED';
    FOR item IN SELECT * FROM public.order_items WHERE order_id = ord.id AND inventory_reserved = true FOR UPDATE LOOP
      UPDATE public.inventories SET reserved_quantity = coalesce(reserved_quantity, 0) - item.quantity, updated_at = now()
        WHERE facility_id = coalesce(item.source_facility_id, ord.export_facility_id) AND variant_id = item.variant_id
          AND coalesce(reserved_quantity, 0) >= item.quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'Inconsistent inventory reservation for order %', ord.id; END IF;
      IF cardinality(item.assigned_uids) > 0 THEN
        UPDATE public.medicine_boxes SET status = 'IN_STOCK' WHERE uid = ANY(item.assigned_uids)
          AND current_facility_id = coalesce(item.source_facility_id, ord.export_facility_id) AND status = 'RESERVED';
        GET DIAGNOSTICS changed = ROW_COUNT;
        IF changed <> cardinality(item.assigned_uids) THEN RAISE EXCEPTION 'Inconsistent UID reservation for order %', ord.id; END IF;
      END IF;
      UPDATE public.order_items SET inventory_reserved = false, assigned_uids = '{}' WHERE id = item.id;
    END LOOP;
    IF ord.used_points > 0 AND ord.customer_id IS NOT NULL THEN
      UPDATE public.customers SET reward_points = coalesce(reward_points, 0) + ord.used_points WHERE id = ord.customer_id;
      INSERT INTO public.loyalty_point_logs (customer_id, order_id, transaction_type, points, description)
        VALUES (ord.customer_id, ord.id, 'REDEEM_REVERSAL', ord.used_points, 'Payment expired');
    END IF;
    UPDATE public.orders SET order_status = 'CANCELLED', note = concat_ws(E'\n', nullif(note, ''), 'Payment expired') WHERE id = ord.id;
    expired := expired + 1;
  END LOOP;
  RETURN expired;
END $$;
REVOKE ALL ON FUNCTION public.expire_unpaid_orders() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_unpaid_orders() TO app_user;
COMMIT;
