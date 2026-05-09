-- Migration: USD base exchange rates (ExchangeRate-API sync)
-- PostgreSQL

CREATE TABLE IF NOT EXISTS usd_exchange_rates (
  currency TEXT PRIMARY KEY NOT NULL,
  rate DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exchange_rate_snapshot_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_code TEXT NOT NULL DEFAULT 'USD',
  time_last_update_unix BIGINT,
  time_next_update_unix BIGINT,
  time_last_update_utc TEXT,
  time_next_update_utc TEXT,
  fetched_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usd_exchange_rates_updated_at ON usd_exchange_rates(updated_at);

COMMENT ON TABLE usd_exchange_rates IS 'Per-currency rates vs USD (same units as exchangerate-api conversion_rates)';
COMMENT ON TABLE exchange_rate_snapshot_meta IS 'Singleton row (id=1) for last API snapshot metadata';
