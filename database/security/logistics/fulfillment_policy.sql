\set ON_ERROR_STOP on
BEGIN;
\ir ../../schemas/13_fulfillment_policy.sql
REVOKE ALL ON public.warehouse_selling_pharmacies FROM PUBLIC,app_user;
GRANT SELECT ON public.warehouse_selling_pharmacies TO app_user;
ALTER TABLE public.warehouse_selling_pharmacies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_selling_pharmacies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warehouse_pharmacy_read ON public.warehouse_selling_pharmacies;
CREATE POLICY warehouse_pharmacy_read ON public.warehouse_selling_pharmacies FOR SELECT TO app_user
  USING (public.order_staff(warehouse_id));

CREATE OR REPLACE FUNCTION public.valid_selling_pharmacy(source integer, selling integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS (SELECT FROM public.facilities src JOIN public.facilities seller ON seller.id=selling
    WHERE src.id=source AND seller.facility_type='PHARMACY' AND (
      (src.facility_type='PHARMACY' AND src.id=selling)
      OR (src.facility_type IN ('CENTRAL_WAREHOUSE','BRANCH_WAREHOUSE') AND EXISTS (
        SELECT FROM public.warehouse_selling_pharmacies l WHERE l.warehouse_id=source AND l.pharmacy_id=selling))))
$$;
REVOKE ALL ON FUNCTION public.valid_selling_pharmacy(integer,integer) FROM PUBLIC,app_user;

CREATE OR REPLACE FUNCTION public.set_warehouse_selling_pharmacies(target integer, pharmacies integer[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR current_setting('app.current_user_role',true) IS DISTINCT FROM 'SUPER_ADMIN'
    OR current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR nullif(current_setting('app.current_user_id',true),'') IS NULL THEN
    RAISE EXCEPTION 'Super administrator approval is required' USING ERRCODE='42501';
  END IF;
  PERFORM 1 FROM public.facilities WHERE id=target AND facility_type IN ('CENTRAL_WAREHOUSE','BRANCH_WAREHOUSE') FOR NO KEY UPDATE;
  IF NOT FOUND OR pharmacies IS NULL OR cardinality(pharmacies)>200 OR EXISTS (
    SELECT FROM unnest(pharmacies) p WHERE p IS NULL OR NOT EXISTS (
      SELECT FROM public.facilities WHERE id=p AND facility_type='PHARMACY')) THEN
    RAISE EXCEPTION 'Choose a warehouse and valid selling pharmacies' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.warehouse_selling_pharmacies WHERE warehouse_id=target;
  INSERT INTO public.warehouse_selling_pharmacies(warehouse_id,pharmacy_id,updated_by)
    SELECT target,p,current_setting('app.current_user_id')::integer FROM (SELECT DISTINCT unnest(pharmacies) p) approved;
END $$;
REVOKE ALL ON FUNCTION public.set_warehouse_selling_pharmacies(integer,integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_warehouse_selling_pharmacies(integer,integer[]) TO app_user;
REVOKE ALL ON public.facility_fulfillment_policy,public.medicine_transport_requirements,public.order_fulfillment_terms FROM PUBLIC,app_user;
GRANT SELECT ON public.facility_fulfillment_policy,public.medicine_transport_requirements,public.order_fulfillment_terms TO app_user;
ALTER TABLE public.facility_fulfillment_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facility_fulfillment_policy FORCE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_transport_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medicine_transport_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_fulfillment_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_fulfillment_terms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fulfillment_policy_read ON public.facility_fulfillment_policy;
CREATE POLICY fulfillment_policy_read ON public.facility_fulfillment_policy FOR SELECT TO app_user USING (public.order_staff(facility_id));
DROP POLICY IF EXISTS transport_requirement_read ON public.medicine_transport_requirements;
CREATE POLICY transport_requirement_read ON public.medicine_transport_requirements FOR SELECT TO app_user USING (
  current_setting('app.current_user_type',true)='employee' AND current_setting('app.current_user_role',true) IN ('SUPER_ADMIN','STORE_MANAGER')
);
DROP POLICY IF EXISTS fulfillment_terms_read ON public.order_fulfillment_terms;
CREATE POLICY fulfillment_terms_read ON public.order_fulfillment_terms FOR SELECT TO app_user USING (EXISTS (SELECT FROM public.orders WHERE id=order_id));

CREATE OR REPLACE FUNCTION public.fulfillment_options(medicines integer[])
RETURNS TABLE(facility_id integer,selling_facility_id integer,selling_facility_name text,radius_km numeric,revision text,requirements_revision text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT p.facility_id,p.selling_facility_id,f.facility_name::text,p.radius_km,md5(to_jsonb(p)::text),
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.medicine_id)::text,'')) FROM public.medicine_transport_requirements r WHERE r.medicine_id=ANY(medicines))
  FROM public.facility_fulfillment_policy p JOIN public.facilities f ON f.id=p.selling_facility_id
  WHERE nullif(current_setting('app.current_user_id',true),'') IS NOT NULL
    AND current_setting('app.current_user_type',true) IN ('employee','customer')
    AND cardinality(medicines) BETWEEN 1 AND 200 AND p.enabled
    AND public.valid_selling_pharmacy(p.facility_id,p.selling_facility_id)
    AND (extract(dow FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer=ANY(p.weekdays)
    AND (extract(hour FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')*60+extract(minute FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) >= p.opens_minute
    AND (extract(hour FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')*60+extract(minute FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) < p.closes_minute
    AND NOT EXISTS (SELECT FROM unnest(medicines) m WHERE NOT EXISTS (
      SELECT FROM public.medicine_transport_requirements r WHERE r.medicine_id=m AND r.condition=ANY(p.transport_conditions)))
    AND (SELECT count(*) FROM public.orders o WHERE o.export_facility_id=p.facility_id
      AND o.order_status NOT IN ('CANCELLED','CANCELED')
      AND o.created_at >= (date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' AT TIME ZONE 'UTC')
      AND o.created_at < ((date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')+interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh' AT TIME ZONE 'UTC')) < p.daily_capacity
$$;

CREATE OR REPLACE FUNCTION public.save_fulfillment_policy(target integer, selling integer, enabled boolean, opens integer, closes integer,
  days integer[], capacity integer, radius numeric, conditions text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actor integer;
BEGIN
  actor:=nullif(current_setting('app.current_user_id',true),'')::integer;
  IF actor IS NULL OR current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR coalesce(current_setting('app.current_user_role',true),'') NOT IN ('SUPER_ADMIN','STORE_MANAGER')
    OR public.order_staff(target) IS NOT TRUE THEN RAISE EXCEPTION 'Facility manager approval is required' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT FROM public.facilities WHERE id=selling AND facility_type='PHARMACY')
    OR NOT EXISTS (SELECT FROM public.facilities WHERE id=target AND facility_type IN ('CENTRAL_WAREHOUSE','BRANCH_WAREHOUSE','PHARMACY'))
    OR conditions IS NULL OR cardinality(conditions) NOT BETWEEN 1 AND 20
    OR EXISTS (SELECT FROM unnest(conditions) c WHERE c IS NULL OR length(btrim(c)) NOT BETWEEN 1 AND 100) THEN
    RAISE EXCEPTION 'Choose a selling pharmacy and valid transport conditions' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.facilities WHERE id=target FOR NO KEY UPDATE;
  IF public.valid_selling_pharmacy(target,selling) IS NOT TRUE THEN
    RAISE EXCEPTION 'A pharmacy must sell for itself; a warehouse must select a linked selling pharmacy' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.facility_fulfillment_policy VALUES(target,selling,enabled,opens,closes,days,capacity,radius,conditions,actor,now())
    ON CONFLICT(facility_id) DO UPDATE SET selling_facility_id=EXCLUDED.selling_facility_id,enabled=EXCLUDED.enabled,
      opens_minute=EXCLUDED.opens_minute,closes_minute=EXCLUDED.closes_minute,weekdays=EXCLUDED.weekdays,
      daily_capacity=EXCLUDED.daily_capacity,radius_km=EXCLUDED.radius_km,transport_conditions=EXCLUDED.transport_conditions,updated_by=actor,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION public.save_transport_requirement(target integer, requirement text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF current_setting('app.current_user_type',true) IS DISTINCT FROM 'employee'
    OR current_setting('app.order_operation',true) IS DISTINCT FROM 'read'
    OR current_setting('app.current_user_role',true) IS DISTINCT FROM 'SUPER_ADMIN'
    OR nullif(current_setting('app.current_user_id',true),'') IS NULL THEN
    RAISE EXCEPTION 'Super administrator approval is required for product transport classification' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT FROM public.medicines WHERE id=target) THEN
    RAISE EXCEPTION 'Medicine not found' USING ERRCODE='P0002';
  END IF;
  INSERT INTO public.medicine_transport_requirements VALUES(target,btrim(requirement),current_setting('app.current_user_id',true)::integer,now())
    ON CONFLICT(medicine_id) DO UPDATE SET condition=EXCLUDED.condition,updated_by=EXCLUDED.updated_by,updated_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.accept_fulfillment_terms(target integer, expected text, requirements text, distance numeric, sources integer[], medicines integer[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE ord public.orders%ROWTYPE; p public.facility_fulfillment_policy%ROWTYPE;
BEGIN
  SELECT * INTO ord FROM public.orders WHERE id=target FOR UPDATE;
  IF current_setting('app.order_operation',true) IS DISTINCT FROM 'checkout' OR public.order_customer(ord.customer_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'Checkout ownership is required' USING ERRCODE='42501';
  END IF;
  IF medicines IS NULL OR sources IS NULL OR cardinality(medicines) NOT BETWEEN 1 AND 200 OR cardinality(sources)=0
    OR medicines IS DISTINCT FROM ARRAY(SELECT DISTINCT medicine_id FROM public.order_items WHERE order_id=target ORDER BY medicine_id)
    OR sources IS DISTINCT FROM ARRAY(SELECT DISTINCT source_facility_id FROM public.order_items WHERE order_id=target ORDER BY source_facility_id) THEN
    RAISE EXCEPTION 'Fulfillment terms must match the actual order allocation' USING ERRCODE='22023';
  END IF;
  -- Lock shared policies in facility order to serialize capacity checks and configuration edits.
  -- Use the same facility locks as policy/link edits so revocation cannot race checkout.
  PERFORM 1 FROM public.facilities WHERE id=ANY(sources||ARRAY[ord.export_facility_id]) ORDER BY id FOR NO KEY UPDATE;
  PERFORM 1 FROM public.facility_fulfillment_policy WHERE facility_id=ANY(sources||ARRAY[ord.export_facility_id]) ORDER BY facility_id FOR UPDATE;
  PERFORM 1 FROM public.medicine_transport_requirements WHERE medicine_id=ANY(medicines) ORDER BY medicine_id FOR SHARE;
  SELECT * INTO p FROM public.facility_fulfillment_policy WHERE facility_id=ord.export_facility_id;
  -- Revalidate the quoted policy under lock.
  IF NOT FOUND OR public.valid_selling_pharmacy(p.facility_id,p.selling_facility_id) IS NOT TRUE
    OR md5(to_jsonb(p)::text) IS DISTINCT FROM expected OR distance IS NULL OR distance::text IN ('NaN','Infinity','-Infinity')
    OR distance<0 OR distance>p.radius_km THEN RAISE EXCEPTION 'Delivery policy changed or address is outside service coverage; request a new quote' USING ERRCODE='22023'; END IF;
  -- The new order already occupies one slot, so equality with the daily capacity is valid.
  IF (SELECT count(*) FROM public.orders WHERE export_facility_id=p.facility_id AND order_status NOT IN ('CANCELLED','CANCELED')
      AND created_at>=(date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh') AT TIME ZONE 'Asia/Ho_Chi_Minh' AT TIME ZONE 'UTC') AND created_at<((date_trunc('day',now() AT TIME ZONE 'Asia/Ho_Chi_Minh')+interval '1 day') AT TIME ZONE 'Asia/Ho_Chi_Minh' AT TIME ZONE 'UTC')) > p.daily_capacity THEN
    RAISE EXCEPTION 'Facility capacity has been reached; request a new quote' USING ERRCODE='22023';
  END IF;
  IF NOT p.enabled OR (extract(dow FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::integer<>ALL(p.weekdays)
    OR (extract(hour FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')*60+extract(minute FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) < p.opens_minute
    OR (extract(hour FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')*60+extract(minute FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')) >= p.closes_minute
    OR EXISTS (SELECT FROM unnest(medicines) m WHERE NOT EXISTS (SELECT FROM public.medicine_transport_requirements r WHERE r.medicine_id=m AND r.condition=ANY(p.transport_conditions)))
    OR (SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.medicine_id)::text,'')) FROM public.medicine_transport_requirements r WHERE r.medicine_id=ANY(medicines)) IS DISTINCT FROM requirements
    OR EXISTS (SELECT FROM unnest(sources) src WHERE src<>p.facility_id AND NOT EXISTS (SELECT FROM public.fulfillment_options(medicines) o WHERE o.facility_id=src)) THEN
    RAISE EXCEPTION 'Operating hours or transport requirements changed; request a new quote' USING ERRCODE='22023';
  END IF;
  INSERT INTO public.order_fulfillment_terms(order_id,selling_facility_id,policy,transport_requirements)
    SELECT target,p.selling_facility_id,to_jsonb(p),jsonb_agg(to_jsonb(r) ORDER BY r.medicine_id)
    FROM public.medicine_transport_requirements r WHERE r.medicine_id=ANY(medicines);
END $$;
REVOKE ALL ON FUNCTION public.fulfillment_options(integer[]),public.save_fulfillment_policy(integer,integer,boolean,integer,integer,integer[],integer,numeric,text[]),public.save_transport_requirement(integer,text),public.accept_fulfillment_terms(integer,text,text,numeric,integer[],integer[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fulfillment_options(integer[]),public.save_fulfillment_policy(integer,integer,boolean,integer,integer,integer[],integer,numeric,text[]),public.save_transport_requirement(integer,text),public.accept_fulfillment_terms(integer,text,text,numeric,integer[],integer[]) TO app_user;
COMMIT;
