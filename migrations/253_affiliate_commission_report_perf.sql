-- Migration: 253_affiliate_commission_report_perf.sql
-- Date: 2026-06-02
-- Description: Commission report perf — offers.asin, payload compression codecs, line facts pre-agg, report cache

ALTER TABLE offers ADD COLUMN asin TEXT;

CREATE INDEX IF NOT EXISTS idx_offers_user_asin
  ON offers(user_id, asin)
  WHERE asin IS NOT NULL;

ALTER TABLE openclaw_affiliate_commission_raw_sync_payloads
  ADD COLUMN request_payload_codec TEXT NOT NULL DEFAULT 'json';

ALTER TABLE openclaw_affiliate_commission_raw_sync_payloads
  ADD COLUMN response_payload_codec TEXT NOT NULL DEFAULT 'json';

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_line_facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  platform TEXT NOT NULL,
  brand_key TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  commission REAL NOT NULL DEFAULT 0,
  advert_id TEXT,
  asin TEXT,
  rebuilt_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oaclf_user_date
  ON openclaw_affiliate_commission_line_facts(user_id, report_date DESC, platform);

CREATE INDEX IF NOT EXISTS idx_oaclf_user_date_brand
  ON openclaw_affiliate_commission_line_facts(user_id, report_date, brand_key);

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_report_cache (
  cache_key TEXT PRIMARY KEY,
  line_items_json TEXT NOT NULL,
  line_items_codec TEXT NOT NULL DEFAULT 'json',
  source_updated_at TEXT,
  built_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_oacrc_built_at
  ON openclaw_affiliate_commission_report_cache(built_at DESC);
