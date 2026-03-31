-- Migration 187: OpenClaw strategy recommendations + execution events
-- Purpose:
-- 1) Persist daily strategy recommendations for approval/execution
-- 2) Track lifecycle events (generated/approved/executed/failed)
-- 3) Persist recommendation snapshot hashes for approval consistency

CREATE TABLE IF NOT EXISTS openclaw_strategy_recommendations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  campaign_id INTEGER NOT NULL,
  google_campaign_id TEXT,
  snapshot_hash TEXT,
  approved_snapshot_hash TEXT,
  recommendation_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  reason TEXT,
  priority_score REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  data_json TEXT,
  approved_at TEXT,
  executed_at TEXT,
  execution_result_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE(user_id, report_date, campaign_id, recommendation_type)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_user_date
  ON openclaw_strategy_recommendations(user_id, report_date);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_status
  ON openclaw_strategy_recommendations(user_id, status, priority_score DESC);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_campaign
  ON openclaw_strategy_recommendations(campaign_id);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendations_snapshot
  ON openclaw_strategy_recommendations(user_id, report_date, status, snapshot_hash);

CREATE TABLE IF NOT EXISTS openclaw_strategy_recommendation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recommendation_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER,
  event_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (recommendation_id) REFERENCES openclaw_strategy_recommendations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendation_events_recommendation
  ON openclaw_strategy_recommendation_events(recommendation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendation_events_user
  ON openclaw_strategy_recommendation_events(user_id, created_at);
