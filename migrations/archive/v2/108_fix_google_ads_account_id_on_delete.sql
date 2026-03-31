-- Migration: 108_fix_google_ads_account_id_on_delete
-- Date: 2025-12-25
-- Description: 修改google_ads_account_id外键约束，删除Ads账号时保留历史数据，设为NULL
-- Tables affected: campaigns, weekly_recommendations, optimization_recommendations, sync_logs

-- =============================================================================
-- 1. campaigns 表
-- =============================================================================

-- SQLite: 删除旧的外键约束并重新创建
-- 注意：SQLite不支持直接修改外键，需要重建表

-- 步骤1.1: 创建临时表存储数据
CREATE TABLE IF NOT EXISTS _campaigns_backup AS
SELECT id, user_id, offer_id, google_ads_account_id, campaign_id, campaign_name,
       budget_amount, budget_type, target_cpa, max_cpc, status, start_date, end_date,
       creation_status, creation_error, last_sync_at, ad_creative_id,
       google_campaign_id, google_ad_group_id, google_ad_id, campaign_config,
       pause_old_campaigns, is_test_variant, ab_test_id, traffic_allocation,
       created_at, updated_at
FROM campaigns;

-- 步骤1.2: 删除旧表
DROP TABLE campaigns;

-- 步骤1.3: 创建新表（google_ads_account_id改为可空，SET NULL）
CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  google_ads_account_id INTEGER,
  campaign_id TEXT UNIQUE,
  campaign_name TEXT NOT NULL,
  budget_amount REAL NOT NULL,
  budget_type TEXT NOT NULL DEFAULT 'DAILY',
  target_cpa REAL,
  max_cpc REAL,
  status TEXT NOT NULL DEFAULT 'PAUSED',
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT,
  last_sync_at TIMESTAMP,
  ad_creative_id INTEGER REFERENCES ad_creatives(id) ON DELETE SET NULL,
  google_campaign_id TEXT,
  google_ad_group_id TEXT,
  google_ad_id TEXT,
  campaign_config TEXT,
  pause_old_campaigns BOOLEAN,
  is_test_variant BOOLEAN DEFAULT FALSE,
  ab_test_id INTEGER,
  traffic_allocation REAL DEFAULT 1.0 CHECK (traffic_allocation >= 0 AND traffic_allocation <= 1),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL
);

-- 步骤1.4: 创建索引
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_offer_id ON campaigns(offer_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_is_test_variant ON campaigns(is_test_variant);
CREATE INDEX IF NOT EXISTS idx_campaigns_ab_test_id ON campaigns(ab_test_id);

-- 步骤1.5: 恢复数据
INSERT INTO campaigns (
  id, user_id, offer_id, google_ads_account_id, campaign_id, campaign_name,
  budget_amount, budget_type, target_cpa, max_cpc, status, start_date, end_date,
  creation_status, creation_error, last_sync_at, ad_creative_id,
  google_campaign_id, google_ad_group_id, google_ad_id, campaign_config,
  pause_old_campaigns, is_test_variant, ab_test_id, traffic_allocation,
  created_at, updated_at
)
SELECT id, user_id, offer_id, google_ads_account_id, campaign_id, campaign_name,
       budget_amount, budget_type, target_cpa, max_cpc, status, start_date, end_date,
       creation_status, creation_error, last_sync_at, ad_creative_id,
       google_campaign_id, google_ad_group_id, google_ad_id, campaign_config,
       pause_old_campaigns, is_test_variant, ab_test_id, traffic_allocation,
       created_at, updated_at
FROM _campaigns_backup;

-- 步骤1.6: 删除临时表
DROP TABLE IF EXISTS _campaigns_backup;

-- =============================================================================
-- 2. weekly_recommendations 表
-- =============================================================================

CREATE TABLE IF NOT EXISTS _weekly_recommendations_backup AS
SELECT id, user_id, google_ads_account_id, recommendation_type, recommendation_data,
       priority, status, applied_at, week_start_date, created_at
FROM weekly_recommendations;

DROP TABLE weekly_recommendations;

CREATE TABLE weekly_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER,
  recommendation_type TEXT NOT NULL,
  recommendation_data TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMP,
  week_start_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL
);

INSERT INTO weekly_recommendations (
  id, user_id, google_ads_account_id, recommendation_type, recommendation_data,
  priority, status, applied_at, week_start_date, created_at
)
SELECT id, user_id, google_ads_account_id, recommendation_type, recommendation_data,
       priority, status, applied_at, week_start_date, created_at
FROM _weekly_recommendations_backup;

DROP TABLE IF EXISTS _weekly_recommendations_backup;

-- =============================================================================
-- 3. optimization_recommendations 表
-- =============================================================================

CREATE TABLE IF NOT EXISTS _optimization_recommendations_backup AS
SELECT id, user_id, google_ads_account_id, recommendation_id, recommendation_type,
       impact, recommendation_data, status, applied_at, dismissed_at, created_at
FROM optimization_recommendations;

DROP TABLE optimization_recommendations;

CREATE TABLE optimization_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER,
  recommendation_id TEXT NOT NULL UNIQUE,
  recommendation_type TEXT NOT NULL,
  impact TEXT,
  recommendation_data TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  applied_at TIMESTAMP,
  dismissed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL
);

INSERT INTO optimization_recommendations (
  id, user_id, google_ads_account_id, recommendation_id, recommendation_type,
  impact, recommendation_data, status, applied_at, dismissed_at, created_at
)
SELECT id, user_id, google_ads_account_id, recommendation_id, recommendation_type,
       impact, recommendation_data, status, applied_at, dismissed_at, created_at
FROM _optimization_recommendations_backup;

DROP TABLE IF EXISTS _optimization_recommendations_backup;

-- =============================================================================
-- 4. sync_logs 表
-- =============================================================================

CREATE TABLE IF NOT EXISTS _sync_logs_backup AS
SELECT id, user_id, google_ads_account_id, sync_type, status, record_count,
       duration_ms, error_message, started_at, completed_at, created_at
FROM sync_logs;

DROP TABLE sync_logs;

CREATE TABLE sync_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON sync_logs(user_id, started_at);

INSERT INTO sync_logs (
  id, user_id, google_ads_account_id, sync_type, status, record_count,
  duration_ms, error_message, started_at, completed_at, created_at
)
SELECT id, user_id, google_ads_account_id, sync_type, status, record_count,
       duration_ms, error_message, started_at, completed_at, created_at
FROM _sync_logs_backup;

DROP TABLE IF EXISTS _sync_logs_backup;
