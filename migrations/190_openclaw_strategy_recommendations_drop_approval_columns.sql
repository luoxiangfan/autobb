-- Migration: 190_openclaw_strategy_recommendations_drop_approval_columns.sql
-- Date: 2026-02-24
-- Description: 删除策略建议表中的审批遗留字段（approved_at / approved_snapshot_hash）

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS openclaw_strategy_recommendations_new;

CREATE TABLE openclaw_strategy_recommendations_new (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  campaign_id INTEGER NOT NULL,
  google_campaign_id TEXT,
  snapshot_hash TEXT,
  recommendation_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  reason TEXT,
  priority_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  data_json TEXT,
  executed_at TEXT,
  execution_result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE(user_id, report_date, campaign_id, recommendation_type)
);

INSERT INTO openclaw_strategy_recommendations_new (
  id,
  user_id,
  report_date,
  campaign_id,
  google_campaign_id,
  snapshot_hash,
  recommendation_type,
  title,
  summary,
  reason,
  priority_score,
  status,
  data_json,
  executed_at,
  execution_result_json,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  report_date,
  campaign_id,
  google_campaign_id,
  snapshot_hash,
  recommendation_type,
  title,
  summary,
  reason,
  priority_score,
  status,
  data_json,
  executed_at,
  execution_result_json,
  created_at,
  updated_at
FROM openclaw_strategy_recommendations;

DROP TABLE openclaw_strategy_recommendations;

ALTER TABLE openclaw_strategy_recommendations_new RENAME TO openclaw_strategy_recommendations;

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_user_date
  ON openclaw_strategy_recommendations(user_id, report_date);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_status
  ON openclaw_strategy_recommendations(user_id, status, priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_campaign
  ON openclaw_strategy_recommendations(campaign_id);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_snapshot
  ON openclaw_strategy_recommendations(user_id, report_date, status, snapshot_hash);

PRAGMA foreign_keys = ON;

