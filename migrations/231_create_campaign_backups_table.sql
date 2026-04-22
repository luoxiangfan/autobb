-- Migration: Create campaign_backups table
-- Purpose: Backup campaign data for quick restoration
-- Created: 2026-04-20
-- Updated: 2026-04-20 (Added campaign_config field)

-- SQLite 迁移
CREATE TABLE IF NOT EXISTS campaign_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  campaign_data TEXT NOT NULL,  -- JSON: 完整的广告系列数据
  campaign_config TEXT,  -- 🔧 新增：广告系列配置（JSON 格式）
  backup_type TEXT NOT NULL DEFAULT 'auto',  -- 'auto' | 'manual'
  backup_source TEXT NOT NULL DEFAULT 'autoads',  -- 'autoads' | 'google_ads'
  backup_version INTEGER NOT NULL DEFAULT 1,  -- 备份版本号（google_ads 会备份 2 次）
  custom_name TEXT,  -- 用户自定义名称
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

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_campaign_backups_user_offer ON campaign_backups(user_id, offer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_backups_offer_id ON campaign_backups(offer_id);
CREATE INDEX IF NOT EXISTS idx_campaign_backups_backup_source ON campaign_backups(backup_source);
CREATE INDEX IF NOT EXISTS idx_campaign_backups_created_at ON campaign_backups(created_at DESC);
