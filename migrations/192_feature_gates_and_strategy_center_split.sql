-- Migration: 192_feature_gates_and_strategy_center_split.sql
-- Date: 2026-02-25
-- Description: 新增商品管理/策略中心用户开关，并将策略中心数据表从 openclaw_* 重命名为 strategy_center_*

-- ---------------------------------------------------------------------
-- 1) users: 新增独立功能开关（用户级）
-- ---------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN product_management_enabled INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN strategy_center_enabled INTEGER NOT NULL DEFAULT 0;

-- 历史用户回填：跟随 openclaw_enabled 当前状态
UPDATE users
SET product_management_enabled = CASE
  WHEN openclaw_enabled = 1 THEN 1
  ELSE 0
END;

UPDATE users
SET strategy_center_enabled = CASE
  WHEN openclaw_enabled = 1 THEN 1
  ELSE 0
END;

-- ---------------------------------------------------------------------
-- 2) 策略中心表重命名（openclaw_strategy_* -> strategy_center_*）
-- ---------------------------------------------------------------------
ALTER TABLE openclaw_strategy_runs RENAME TO strategy_center_runs;
ALTER TABLE openclaw_strategy_actions RENAME TO strategy_center_actions;
ALTER TABLE openclaw_strategy_recommendations RENAME TO strategy_center_recommendations;
ALTER TABLE openclaw_strategy_recommendation_events RENAME TO strategy_center_recommendation_events;

-- ---------------------------------------------------------------------
-- 3) 统一索引命名
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS idx_openclaw_strategy_runs_user;
DROP INDEX IF EXISTS idx_openclaw_strategy_runs_status;
CREATE INDEX IF NOT EXISTS idx_strategy_center_runs_user ON strategy_center_runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_center_runs_status ON strategy_center_runs(status);

DROP INDEX IF EXISTS idx_openclaw_strategy_actions_run;
DROP INDEX IF EXISTS idx_openclaw_strategy_actions_user;
CREATE INDEX IF NOT EXISTS idx_strategy_center_actions_run ON strategy_center_actions(run_id);
CREATE INDEX IF NOT EXISTS idx_strategy_center_actions_user ON strategy_center_actions(user_id, created_at);

DROP INDEX IF EXISTS idx_openclaw_strategy_recommendations_user_date;
DROP INDEX IF EXISTS idx_openclaw_strategy_recommendations_status;
DROP INDEX IF EXISTS idx_openclaw_strategy_recommendations_campaign;
DROP INDEX IF EXISTS idx_openclaw_strategy_recommendations_snapshot;
CREATE INDEX IF NOT EXISTS idx_strategy_center_recommendations_user_date
  ON strategy_center_recommendations(user_id, report_date);
CREATE INDEX IF NOT EXISTS idx_strategy_center_recommendations_status
  ON strategy_center_recommendations(user_id, status, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_center_recommendations_campaign
  ON strategy_center_recommendations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_strategy_center_recommendations_snapshot
  ON strategy_center_recommendations(user_id, report_date, status, snapshot_hash);

DROP INDEX IF EXISTS idx_openclaw_strategy_recommendation_events_recommendation;
DROP INDEX IF EXISTS idx_openclaw_strategy_recommendation_events_user;
CREATE INDEX IF NOT EXISTS idx_strategy_center_recommendation_events_recommendation
  ON strategy_center_recommendation_events(recommendation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_strategy_center_recommendation_events_user
  ON strategy_center_recommendation_events(user_id, created_at);
