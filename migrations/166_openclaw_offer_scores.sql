-- Migration: 166_openclaw_offer_scores.sql
-- Date: 2026-02-07
-- Description: OpenClaw offer scoring table for strategy engine

CREATE TABLE IF NOT EXISTS openclaw_offer_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offer_id INTEGER,
  asin TEXT,
  platform TEXT,
  commission_rate REAL,
  product_rating REAL,
  review_count INTEGER DEFAULT 0,
  discount_percent REAL,
  category TEXT,
  brand TEXT,
  score_total REAL DEFAULT 0,
  score_commission REAL DEFAULT 0,
  score_demand REAL DEFAULT 0,
  score_competition REAL DEFAULT 0,
  score_conversion REAL DEFAULT 0,
  profit_probability TEXT DEFAULT 'low',
  suggested_cpc_min REAL,
  suggested_cpc_max REAL,
  estimated_roas REAL,
  priority TEXT DEFAULT 'P2',
  raw_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_ocs_user_id ON openclaw_offer_scores(user_id);
CREATE INDEX IF NOT EXISTS idx_ocs_asin ON openclaw_offer_scores(user_id, asin);
CREATE INDEX IF NOT EXISTS idx_ocs_score ON openclaw_offer_scores(user_id, score_total DESC);
CREATE INDEX IF NOT EXISTS idx_ocs_priority ON openclaw_offer_scores(user_id, priority);
