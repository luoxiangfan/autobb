-- 创建 Google Ads 服务账号表
CREATE TABLE IF NOT EXISTS google_ads_service_accounts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  mcc_customer_id TEXT NOT NULL,
  developer_token TEXT NOT NULL,
  service_account_email TEXT NOT NULL,
  private_key TEXT NOT NULL,
  project_id TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_accounts_user ON google_ads_service_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_service_accounts_active ON google_ads_service_accounts(user_id, is_active);

-- 修改 google_ads_accounts 表，添加认证类型字段
ALTER TABLE google_ads_accounts ADD COLUMN auth_type TEXT DEFAULT 'oauth';
ALTER TABLE google_ads_accounts ADD COLUMN service_account_id TEXT REFERENCES google_ads_service_accounts(id);
