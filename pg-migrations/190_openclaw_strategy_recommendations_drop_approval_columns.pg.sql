-- Migration: 190_openclaw_strategy_recommendations_drop_approval_columns.pg.sql
-- Date: 2026-02-24
-- Description: 删除策略建议表中的审批遗留字段（approved_at / approved_snapshot_hash）

ALTER TABLE openclaw_strategy_recommendations
  DROP COLUMN IF EXISTS approved_at;

ALTER TABLE openclaw_strategy_recommendations
  DROP COLUMN IF EXISTS approved_snapshot_hash;

