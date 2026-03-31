-- Migration: 167_openclaw_experiment_results.sql
-- Date: 2026-02-07
-- Description: OpenClaw A/B experiment results tracking

CREATE TABLE IF NOT EXISTS openclaw_experiment_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  experiment_name TEXT NOT NULL,
  experiment_type TEXT NOT NULL,
  offer_id INTEGER,
  campaign_id INTEGER,
  variant_a TEXT,
  variant_b TEXT,
  metrics_a TEXT,
  metrics_b TEXT,
  winner TEXT,
  confidence REAL,
  conclusion TEXT,
  status TEXT DEFAULT 'running',
  started_at TEXT DEFAULT (datetime('now')),
  ended_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_oer_user_id ON openclaw_experiment_results(user_id);
CREATE INDEX IF NOT EXISTS idx_oer_status ON openclaw_experiment_results(user_id, status);
CREATE INDEX IF NOT EXISTS idx_oer_offer ON openclaw_experiment_results(user_id, offer_id);
