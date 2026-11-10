\set ON_ERROR_STOP on
-- Fulfillment tables shared by development seed and runtime security setup.
CREATE TABLE IF NOT EXISTS public.warehouse_selling_pharmacies (
  warehouse_id integer NOT NULL REFERENCES public.facilities(id),
  pharmacy_id integer NOT NULL REFERENCES public.facilities(id),
  updated_by integer NOT NULL REFERENCES public.employees(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, pharmacy_id)
);

CREATE TABLE IF NOT EXISTS public.facility_fulfillment_policy (
  facility_id integer PRIMARY KEY REFERENCES public.facilities(id),
  selling_facility_id integer NOT NULL REFERENCES public.facilities(id),
  enabled boolean NOT NULL,
  opens_minute integer NOT NULL CHECK (opens_minute BETWEEN 0 AND 1439),
  closes_minute integer NOT NULL CHECK (closes_minute BETWEEN 1 AND 1440 AND closes_minute > opens_minute),
  weekdays integer[] NOT NULL CHECK (cardinality(weekdays)>0 AND weekdays <@ ARRAY[0,1,2,3,4,5,6]),
  daily_capacity integer NOT NULL CHECK (daily_capacity > 0),
  radius_km numeric NOT NULL CHECK (radius_km > 0 AND radius_km <= 3000),
  transport_conditions text[] NOT NULL CHECK (cardinality(transport_conditions)>0),
  updated_by integer NOT NULL REFERENCES public.employees(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.medicine_transport_requirements (
  medicine_id integer PRIMARY KEY REFERENCES public.medicines(id),
  condition text NOT NULL CHECK (length(btrim(condition)) BETWEEN 1 AND 100),
  updated_by integer NOT NULL REFERENCES public.employees(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_fulfillment_terms (
  order_id integer PRIMARY KEY REFERENCES public.orders(id),
  selling_facility_id integer NOT NULL REFERENCES public.facilities(id),
  policy jsonb NOT NULL,
  transport_requirements jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
