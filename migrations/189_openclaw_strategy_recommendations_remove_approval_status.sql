-- Migration: 189_openclaw_strategy_recommendations_remove_approval_status.sql
-- Date: 2026-02-24
-- Description: 策略建议流程下线审批语义，将历史 approved 状态归一为 pending

UPDATE openclaw_strategy_recommendations
SET
  status = 'pending',
  approved_at = NULL,
  approved_snapshot_hash = NULL,
  updated_at = datetime('now')
WHERE status = 'approved';

