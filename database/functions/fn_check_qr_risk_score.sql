-- Function: fn_check_qr_risk_score
-- Evaluates verification scan risk based on velocity and frequency

CREATE OR REPLACE FUNCTION public.fn_check_qr_risk_score(
    p_uid UUID,
    p_lat NUMERIC(10, 7),
    p_lng NUMERIC(10, 7)
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_last_lat NUMERIC(10, 7);
    v_last_lng NUMERIC(10, 7);
    v_last_time TIMESTAMP;
    v_distance DOUBLE PRECISION;
    v_time_diff_hours DOUBLE PRECISION;
    v_speed_kmh DOUBLE PRECISION;
    v_recent_scans INTEGER;
    v_risk_score INTEGER := 0;
BEGIN
    -- Get most recent previous scan
    SELECT latitude, longitude, scan_timestamp
    INTO v_last_lat, v_last_lng, v_last_time
    FROM public.verification_logs
    WHERE uid = p_uid
    ORDER BY scan_timestamp DESC
    LIMIT 1;

    -- Frequency check: count scans in the last 1 minute
    SELECT COUNT(*)
    INTO v_recent_scans
    FROM public.verification_logs
    WHERE uid = p_uid
      AND scan_timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 minute';

    IF v_recent_scans >= 5 THEN
        v_risk_score := v_risk_score + 60;
    END IF;

    -- Velocity check
    IF v_last_lat IS NOT NULL AND p_lat IS NOT NULL THEN
        v_distance := public.fn_haversine_distance(
            v_last_lat::DOUBLE PRECISION, v_last_lng::DOUBLE PRECISION,
            p_lat::DOUBLE PRECISION, p_lng::DOUBLE PRECISION
        );
        
        v_time_diff_hours := EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - v_last_time)) / 3600.0;
        
        IF v_time_diff_hours > 0 THEN
            v_speed_kmh := v_distance / v_time_diff_hours;
            
            -- If calculated physical travel speed exceeds 1000 km/h
            IF v_speed_kmh > 1000.0 THEN
                v_risk_score := v_risk_score + 80;
                
                -- Record fraud alert
                INSERT INTO public.fraud_alerts (
                    uid, alert_type, severity, description,
                    latitude_1, longitude_1, latitude_2, longitude_2,
                    distance_km, time_diff_minutes, velocity_kmh
                ) VALUES (
                    p_uid, 'GEO_VELOCITY_ANOMALY', 'HIGH',
                    'Suspicious scan velocity detected across different geographic regions.',
                    v_last_lat, v_last_lng, p_lat, p_lng,
                    v_distance, v_time_diff_hours * 60.0, v_speed_kmh
                );
            END IF;
        END IF;
    END IF;

    RETURN LEAST(v_risk_score, 100);
END;
$$;
