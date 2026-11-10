\set ON_ERROR_STOP on
BEGIN;
-- Seed data used Vietnamese labels that the application does not recognise as available stock.
-- Only the unambiguous equivalents are mapped; other legacy values are left untouched.
UPDATE public.batches SET status = 'ACTIVE' WHERE status = 'HopLe';
UPDATE public.medicine_boxes SET status = 'IN_STOCK' WHERE status = 'TrongKho';
COMMIT;
