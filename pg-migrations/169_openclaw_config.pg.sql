-- Migration: 169_openclaw_config.pg.sql
-- Date: 2026-02-07
-- Description: OpenClaw per-user configuration key-value store

CREATE TABLE IF NOT EXISTS openclaw_config (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_key VARCHAR(100) NOT NULL,
  config_value TEXT,
  config_type VARCHAR(20) DEFAULT 'string',
  description VARCHAR(500),
  is_sensitive BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, config_key)
);

CREATE INDEX idx_oc_user_key ON openclaw_config(user_id, config_key);
