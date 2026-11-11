\set ON_ERROR_STOP on
BEGIN;
-- Deleting a packaging variant must not silently detach it from existing orders (and their transfers).
ALTER TABLE public.order_items DROP CONSTRAINT IF EXISTS fk_order_items_variant;
ALTER TABLE public.order_items ADD CONSTRAINT fk_order_items_variant
    FOREIGN KEY (variant_id) REFERENCES public.packaging_variants(id) ON DELETE RESTRICT;
COMMIT;
