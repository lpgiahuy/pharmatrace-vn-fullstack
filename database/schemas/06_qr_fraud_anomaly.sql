-- Schema: 06_qr_fraud_anomaly.sql
-- Modules: QR Verification Logs & Fraud Alerts

CREATE TABLE IF NOT EXISTS public.verification_logs (
    id SERIAL PRIMARY KEY,
    uid UUID NOT NULL REFERENCES public.medicine_boxes(uid) ON DELETE CASCADE,
    user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    latitude NUMERIC(10, 7),
    longitude NUMERIC(10, 7),
    ip_address VARCHAR(50),
    user_agent TEXT,
    scan_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    verification_result VARCHAR(50) DEFAULT 'AUTHENTIC_FIRST_TIME' CHECK (verification_result IN ('AUTHENTIC_FIRST_TIME', 'ALREADY_ACTIVATED', 'INVALID_CODE', 'GEO_ANOMALY', 'FREQUENCY_ANOMALY')),
    risk_score INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.fraud_alerts (
    id SERIAL PRIMARY KEY,
    uid UUID REFERENCES public.medicine_boxes(uid) ON DELETE CASCADE,
    alert_type VARCHAR(100) NOT NULL CHECK (alert_type IN ('GEO_VELOCITY_ANOMALY', 'HIGH_FREQUENCY_DDOS', 'DUPLICATE_ACTIVATION', 'INVALID_MASTER_CODE')),
    severity VARCHAR(50) DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description TEXT,
    latitude_1 NUMERIC(10, 7),
    longitude_1 NUMERIC(10, 7),
    latitude_2 NUMERIC(10, 7),
    longitude_2 NUMERIC(10, 7),
    distance_km DOUBLE PRECISION,
    time_diff_minutes DOUBLE PRECISION,
    velocity_kmh DOUBLE PRECISION,
    resolution_status VARCHAR(50) DEFAULT 'OPEN' CHECK (resolution_status IN ('OPEN', 'INVESTIGATING', 'RESOLVED', 'FALSE_POSITIVE')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_verification_logs_uid ON public.verification_logs(uid);
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_uid ON public.fraud_alerts(uid);
