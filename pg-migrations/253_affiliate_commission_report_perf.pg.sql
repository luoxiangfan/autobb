-- Migration: 253_affiliate_commission_report_perf.pg.sql
-- Date: 2026-06-02
-- Description: Commission report perf — offers.asin, payload compression codecs, line facts pre-agg, report cache

ALTER TABLE offers ADD COLUMN IF NOT EXISTS asin TEXT;

CREATE INDEX IF NOT EXISTS idx_offers_user_asin
  ON offers(user_id, asin)
  WHERE asin IS NOT NULL;

ALTER TABLE openclaw_affiliate_commission_raw_sync_payloads
  ADD COLUMN IF NOT EXISTS request_payload_codec TEXT NOT NULL DEFAULT 'json';

ALTER TABLE openclaw_affiliate_commission_raw_sync_payloads
  ADD COLUMN IF NOT EXISTS response_payload_codec TEXT NOT NULL DEFAULT 'json';

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_line_facts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  platform TEXT NOT NULL,
  brand_key TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  commission DOUBLE PRECISION NOT NULL DEFAULT 0,
  advert_id TEXT,
  asin TEXT,
  rebuilt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oaclf_user_date
  ON openclaw_affiliate_commission_line_facts(user_id, report_date DESC, platform);

CREATE INDEX IF NOT EXISTS idx_oaclf_user_date_brand
  ON openclaw_affiliate_commission_line_facts(user_id, report_date, brand_key);

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_report_cache (
  cache_key TEXT PRIMARY KEY,
  line_items_json TEXT NOT NULL,
  line_items_codec TEXT NOT NULL DEFAULT 'json',
  source_updated_at TIMESTAMPTZ,
  built_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oacrc_built_at
  ON openclaw_affiliate_commission_report_cache(built_at DESC);
