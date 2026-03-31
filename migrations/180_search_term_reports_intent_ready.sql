-- Migration: 180_search_term_reports_intent_ready.sql
-- Date: 2026-02-15
-- Description: 为 search_term_reports 增加 ad group 和原始匹配类型字段，支持意图分层与自动否词

ALTER TABLE search_term_reports ADD COLUMN ad_group_id INTEGER;
ALTER TABLE search_term_reports ADD COLUMN google_ad_group_id TEXT;
ALTER TABLE search_term_reports ADD COLUMN raw_match_type TEXT;

CREATE INDEX IF NOT EXISTS idx_search_terms_campaign_adgroup_date
ON search_term_reports(campaign_id, ad_group_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_search_terms_google_adgroup
ON search_term_reports(google_ad_group_id);
