-- Procedure: sp_recall_medicine_batch
-- Quarantines all inventory boxes belonging to a recalled batch

CREATE OR REPLACE PROCEDURE public.sp_recall_medicine_batch(
    p_batch_id INTEGER,
    p_reason TEXT DEFAULT 'Product recall notice'
)
LANGUAGE plpgsql
AS $$
BEGIN
    -- Update batch status
    UPDATE public.medicine_batches
    SET status = 'RECALLED'
    WHERE id = p_batch_id;

    -- Quarantine all non-delivered boxes
    UPDATE public.medicine_boxes
    SET status = 'QUARANTINED'
    WHERE batch_id = p_batch_id
      AND status IN ('IN_STOCK', 'IN_TRANSIT');

    -- Insert fraud alert / audit record
    INSERT INTO public.fraud_alerts (
        uid, alert_type, severity, description
    )
    SELECT uid, 'INVALID_MASTER_CODE', 'CRITICAL', p_reason
    FROM public.medicine_boxes
    WHERE batch_id = p_batch_id
    LIMIT 10;

END;
$$;
