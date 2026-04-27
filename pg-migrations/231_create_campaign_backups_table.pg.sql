-- Migration: Create campaign_backups table (PostgreSQL)
-- Purpose: Backup campaign data for quick restoration
-- Created: 2026-04-20

CREATE TABLE IF NOT EXISTS campaign_backups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  campaign_data JSONB NOT NULL,
  campaign_config JSONB,
  backup_type TEXT NOT NULL DEFAULT 'auto',
  backup_source TEXT NOT NULL DEFAULT 'autoads',
  backup_version INTEGER NOT NULL DEFAULT 1,
  custom_name TEXT,
  campaign_name TEXT NOT NULL,
  budget_amount REAL NOT NULL,
  budget_type TEXT NOT NULL,
  target_cpa REAL,
  max_cpc REAL,
  status TEXT NOT NULL,
  google_ads_account_id INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_campaign_backups_user_offer ON campaign_backups(user_id, offer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_backups_offer_id ON campaign_backups(offer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_backups_backup_source ON campaign_backups(backup_source);
CREATE INDEX IF NOT EXISTS idx_campaign_backups_created_at ON campaign_backups(created_at DESC);

-- 添加注释
COMMENT ON TABLE campaign_backups IS '广告系列备份表：支持 autoads 和 Google Ads 创建时的备份，以及通过备份快速创建';
COMMENT ON COLUMN campaign_backups.backup_type IS '备份类型：auto=自动备份，manual=手动备份';
COMMENT ON COLUMN campaign_backups.backup_source IS '备份来源：autoads=平台创建，google_ads=Google Ads 同步';
COMMENT ON COLUMN campaign_backups.backup_version IS '备份版本：google_ads 会备份 2 次（初始 + 第 7 天），version 1=初始，version 2=第 7 天';
COMMENT ON COLUMN campaign_backups.campaign_data IS '完整的广告系列数据（JSONB 格式），包含所有字段';
COMMENT ON COLUMN campaign_backups.campaign_config IS '广告系列配置（JSONB 格式），包含出价策略、投放设置等';
