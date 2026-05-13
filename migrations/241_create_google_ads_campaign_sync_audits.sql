-- Migration: create_google_ads_campaign_sync_audits
-- Purpose: store campaign-level Google Ads sync snapshots for audit
-- Created: 2026-05-13

CREATE TABLE IF NOT EXISTS google_ads_campaign_sync_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER,
  customer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT,
  query1_rows INTEGER NOT NULL DEFAULT 0,
  query2_rows INTEGER NOT NULL DEFAULT 0,
  query3_rows INTEGER NOT NULL DEFAULT 0,
  query4_rows INTEGER NOT NULL DEFAULT 0,
  aggregated_ad_groups INTEGER NOT NULL DEFAULT 0,
  aggregated_ads INTEGER NOT NULL DEFAULT 0,
  aggregated_keywords INTEGER NOT NULL DEFAULT 0,
  aggregated_callouts INTEGER NOT NULL DEFAULT 0,
  aggregated_sitelinks INTEGER NOT NULL DEFAULT 0,
  aggregated_locations INTEGER NOT NULL DEFAULT 0,
  audit_payload TEXT NOT NULL,
  synced_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_google_ads_campaign_sync_audits_user_synced
ON google_ads_campaign_sync_audits(user_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_google_ads_campaign_sync_audits_campaign_synced
ON google_ads_campaign_sync_audits(campaign_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_google_ads_campaign_sync_audits_account_synced
ON google_ads_campaign_sync_audits(google_ads_account_id, synced_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uk_google_ads_campaign_sync_audits_user_customer_campaign
ON google_ads_campaign_sync_audits(user_id, customer_id, campaign_id);
