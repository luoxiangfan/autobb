-- Migration: 169_openclaw_config.sql
-- Date: 2026-02-07
-- Description: OpenClaw per-user configuration key-value store

CREATE TABLE IF NOT EXISTS openclaw_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  config_key TEXT NOT NULL,
  config_value TEXT,
  config_type TEXT DEFAULT 'string',
  description TEXT,
  is_sensitive INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, config_key)
);

CREATE INDEX IF NOT EXISTS idx_oc_user_key ON openclaw_config(user_id, config_key);
