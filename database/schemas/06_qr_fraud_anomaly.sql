-- Schema: 06_qr_fraud_anomaly.sql
-- Modules: QR Scan Logs & Anti-Fraud Anomaly Alerts

-- 1. Public QR Verification Logs
CREATE TABLE IF NOT EXISTS public.qr_scan_logs (
    id SERIAL PRIMARY KEY,
    uid UUID NOT NULL REFERENCES public.medicine_boxes(uid) ON DELETE CASCADE,
    scanned_by_user_id INTEGER REFERENCES public.customers(id) ON DELETE SET NULL,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    ip_address VARCHAR(50),
    user_agent TEXT,
    scanned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    scan_result VARCHAR(50) DEFAULT 'VALID',
    risk_score INTEGER DEFAULT 0
);

-- 2. Fraud & Anomaly Alerts
CREATE TABLE IF NOT EXISTS public.fraud_alerts (
    id SERIAL PRIMARY KEY,
    uid UUID REFERENCES public.medicine_boxes(uid) ON DELETE CASCADE,
    fraud_type VARCHAR(100) NOT NULL,
    severity_level VARCHAR(50) DEFAULT 'WARNING',
    description TEXT,
    latitude_1 NUMERIC(10, 7),
    longitude_1 NUMERIC(10, 7),
    latitude_2 NUMERIC(10, 7),
    longitude_2 NUMERIC(10, 7),
    distance_km DOUBLE PRECISION,
    time_delta_minutes DOUBLE PRECISION,
    calculated_speed_kmh DOUBLE PRECISION,
    resolution_status VARCHAR(50) DEFAULT 'UNRESOLVED',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_qr_scan_logs_uid ON public.qr_scan_logs(uid);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_uid ON public.fraud_alerts(uid);
