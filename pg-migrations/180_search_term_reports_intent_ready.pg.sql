-- Migration: 180_search_term_reports_intent_ready.pg.sql
-- Date: 2026-02-15
-- Description: 为 search_term_reports 增加 ad group 和原始匹配类型字段，支持意图分层与自动否词

ALTER TABLE search_term_reports
  ADD COLUMN IF NOT EXISTS ad_group_id INTEGER REFERENCES ad_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS google_ad_group_id TEXT,
  ADD COLUMN IF NOT EXISTS raw_match_type TEXT;

CREATE INDEX IF NOT EXISTS idx_search_terms_campaign_adgroup_date
ON search_term_reports(campaign_id, ad_group_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_search_terms_google_adgroup
ON search_term_reports(google_ad_group_id);
