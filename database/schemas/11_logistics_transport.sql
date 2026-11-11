\set ON_ERROR_STOP on
BEGIN;
-- Nullable fields preserve historical transfers whose transport method was not recorded.
ALTER TABLE public.internal_transfers
 ADD COLUMN IF NOT EXISTS transport_mode varchar(20),
 ADD COLUMN IF NOT EXISTS transport_employee_id integer REFERENCES public.employees(id),
 ADD COLUMN IF NOT EXISTS transport_employee_name varchar(150),
 ADD COLUMN IF NOT EXISTS courier_name varchar(100);
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname = 'transfer_transport_check' AND conrelid = 'public.internal_transfers'::regclass) THEN
  ALTER TABLE public.internal_transfers ADD CONSTRAINT transfer_transport_check CHECK ((
   (transport_mode IS NULL AND transport_employee_id IS NULL AND transport_employee_name IS NULL AND courier_name IS NULL)
   OR (transport_mode = 'INTERNAL' AND transport_employee_id IS NOT NULL AND length(btrim(transport_employee_name)) > 0 AND courier_name IS NULL)
   OR (transport_mode = 'THIRD_PARTY' AND transport_employee_id IS NULL AND transport_employee_name IS NULL AND length(btrim(courier_name)) > 0 AND length(btrim(tracking_code)) > 0)
  ) IS TRUE);
 END IF;
END $$;
ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_tracking_number_key;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS carrier_confirmed_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_courier_tracking ON public.shipments(courier_name, tracking_number);

COMMIT;
