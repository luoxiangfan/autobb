-- Migration: 166_openclaw_offer_scores.pg.sql
-- Date: 2026-02-07
-- Description: OpenClaw offer scoring table for strategy engine

CREATE TABLE IF NOT EXISTS openclaw_offer_scores (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  asin VARCHAR(20),
  platform VARCHAR(50),
  commission_rate DECIMAL(5,2),
  product_rating DECIMAL(3,2),
  review_count INTEGER DEFAULT 0,
  discount_percent DECIMAL(5,2),
  category VARCHAR(100),
  brand VARCHAR(200),
  score_total DECIMAL(5,2) DEFAULT 0,
  score_commission DECIMAL(5,2) DEFAULT 0,
  score_demand DECIMAL(5,2) DEFAULT 0,
  score_competition DECIMAL(5,2) DEFAULT 0,
  score_conversion DECIMAL(5,2) DEFAULT 0,
  profit_probability VARCHAR(10) DEFAULT 'low',
  suggested_cpc_min DECIMAL(6,3),
  suggested_cpc_max DECIMAL(6,3),
  estimated_roas DECIMAL(6,3),
  priority VARCHAR(5) DEFAULT 'P2',
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ocs_user_id ON openclaw_offer_scores(user_id);
CREATE INDEX idx_ocs_asin ON openclaw_offer_scores(user_id, asin);
CREATE INDEX idx_ocs_score ON openclaw_offer_scores(user_id, score_total DESC);
CREATE INDEX idx_ocs_priority ON openclaw_offer_scores(user_id, priority);
