-- 允许 google_ads_service_accounts.user_id 为 NULL，表示全租户（管理员）统一配置的服务账号

PRAGMA foreign_keys=OFF;

ALTER TABLE google_ads_service_accounts RENAME TO google_ads_service_accounts_old_237;

CREATE TABLE google_ads_service_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NULL,
  name TEXT NOT NULL,
  mcc_customer_id TEXT NOT NULL,
  developer_token TEXT NOT NULL,
  service_account_email TEXT NOT NULL,
  private_key TEXT NOT NULL,
  project_id TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  api_access_level TEXT DEFAULT 'explorer' CHECK (api_access_level IN ('test', 'explorer', 'basic', 'standard')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO google_ads_service_accounts (
  id,
  user_id,
  name,
  mcc_customer_id,
  developer_token,
  service_account_email,
  private_key,
  project_id,
  is_active,
  created_at,
  updated_at,
  api_access_level
)
SELECT
  id,
  user_id,
  name,
  mcc_customer_id,
  developer_token,
  service_account_email,
  private_key,
  project_id,
  is_active,
  created_at,
  updated_at,
  api_access_level
FROM google_ads_service_accounts_old_237;

DROP TABLE google_ads_service_accounts_old_237;

CREATE INDEX IF NOT EXISTS idx_service_accounts_user ON google_ads_service_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_service_accounts_active ON google_ads_service_accounts(user_id, is_active);

PRAGMA foreign_keys=ON;
