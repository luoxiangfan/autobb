-- Migration: 181_openclaw_user_bindings_tenant_unique_fix.sql
-- Description: Replace legacy global open_id uniqueness with tenant-aware constraints
-- Date: 2026-02-15
-- Database: SQLite

PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

DROP TABLE IF EXISTS openclaw_user_bindings_new;

CREATE TABLE openclaw_user_bindings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  tenant_key TEXT,
  open_id TEXT NOT NULL,
  union_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO openclaw_user_bindings_new (
  id,
  user_id,
  channel,
  tenant_key,
  open_id,
  union_id,
  status,
  created_at,
  updated_at
)
SELECT
  id,
  user_id,
  channel,
  tenant_key,
  open_id,
  union_id,
  status,
  created_at,
  updated_at
FROM openclaw_user_bindings;

DROP TABLE IF EXISTS openclaw_user_bindings;
ALTER TABLE openclaw_user_bindings_new RENAME TO openclaw_user_bindings;

CREATE INDEX IF NOT EXISTS idx_openclaw_bindings_user
  ON openclaw_user_bindings(user_id);

CREATE INDEX IF NOT EXISTS idx_openclaw_bindings_channel
  ON openclaw_user_bindings(channel, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_open_unique
  ON openclaw_user_bindings(channel, tenant_key, open_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_union_unique
  ON openclaw_user_bindings(channel, tenant_key, union_id)
  WHERE union_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_open_null_tenant_unique
  ON openclaw_user_bindings(channel, open_id)
  WHERE tenant_key IS NULL;

COMMIT;

PRAGMA foreign_keys = ON;
