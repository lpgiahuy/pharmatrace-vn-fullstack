-- Shared trigger installation; run after the final guard function exists.
REVOKE ALL ON FUNCTION public.guard_order_write() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_order_write() TO app_user;
DO $$ DECLARE t text; BEGIN
    FOREACH t IN ARRAY ARRAY['orders', 'order_items', 'shipments', 'internal_transfers'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS order_write_guard ON public.%I', t);
        EXECUTE format('CREATE TRIGGER order_write_guard BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_order_write()', t);
    END LOOP;
END $$;
