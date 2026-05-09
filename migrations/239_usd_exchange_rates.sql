-- Migration: USD base exchange rates (ExchangeRate-API sync)
-- SQLite

CREATE TABLE IF NOT EXISTS usd_exchange_rates (
  currency TEXT PRIMARY KEY NOT NULL,
  rate REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exchange_rate_snapshot_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_code TEXT NOT NULL DEFAULT 'USD',
  time_last_update_unix INTEGER,
  time_next_update_unix INTEGER,
  time_last_update_utc TEXT,
  time_next_update_utc TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usd_exchange_rates_updated_at ON usd_exchange_rates(updated_at);
