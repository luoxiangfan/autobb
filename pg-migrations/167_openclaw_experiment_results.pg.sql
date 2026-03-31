-- Migration: 167_openclaw_experiment_results.pg.sql
-- Date: 2026-02-07
-- Description: OpenClaw A/B experiment results tracking

CREATE TABLE IF NOT EXISTS openclaw_experiment_results (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  experiment_name VARCHAR(200) NOT NULL,
  experiment_type VARCHAR(50) NOT NULL,
  offer_id INTEGER REFERENCES offers(id) ON DELETE SET NULL,
  campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  variant_a JSONB,
  variant_b JSONB,
  metrics_a JSONB,
  metrics_b JSONB,
  winner VARCHAR(10),
  confidence DECIMAL(5,4),
  conclusion TEXT,
  status VARCHAR(20) DEFAULT 'running',
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_oer_user_id ON openclaw_experiment_results(user_id);
CREATE INDEX idx_oer_status ON openclaw_experiment_results(user_id, status);
CREATE INDEX idx_oer_offer ON openclaw_experiment_results(user_id, offer_id);
