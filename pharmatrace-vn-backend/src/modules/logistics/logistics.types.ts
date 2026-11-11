export interface LogisticsHistoryEvent {
  old_status: string | null;
  new_status: string;
  reason: string | null;
  actor_id: number | null;
  actor_type: string | null;
  actor_name: string | null;
  actor_role: string | null;
  actor_inferred: boolean;
  created_at: Date;
  occurred_at: Date | null;
}
