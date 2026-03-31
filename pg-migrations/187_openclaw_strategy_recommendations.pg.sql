-- Migration 187: OpenClaw strategy recommendations + execution events (PostgreSQL)
-- Purpose:
-- 1) Persist daily strategy recommendations for approval/execution
-- 2) Track lifecycle events (generated/approved/executed/failed)
-- 3) Persist recommendation snapshot hashes for approval consistency

CREATE TABLE IF NOT EXISTS openclaw_strategy_recommendations (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  google_campaign_id TEXT,
  snapshot_hash TEXT,
  approved_snapshot_hash TEXT,
  recommendation_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  reason TEXT,
  priority_score NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  data_json JSONB,
  approved_at TIMESTAMP,
  executed_at TIMESTAMP,
  execution_result_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  id SERIAL PRIMARY KEY,
  recommendation_id TEXT NOT NULL REFERENCES openclaw_strategy_recommendations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendation_events_recommendation
  ON openclaw_strategy_recommendation_events(recommendation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_recommendation_events_user
  ON openclaw_strategy_recommendation_events(user_id, created_at);
