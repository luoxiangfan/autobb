-- 支持 Standard Access（无限次/天）
-- SQLite 无法直接修改 CHECK 约束，需重建表

ALTER TABLE google_ads_credentials RENAME TO google_ads_credentials_old_220;

CREATE TABLE google_ads_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  client_id TEXT,
  client_secret TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  developer_token TEXT,
  login_customer_id TEXT NOT NULL,
  access_token_expires_at TIMESTAMP,
  is_active INTEGER DEFAULT 1,
  last_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  api_access_level TEXT DEFAULT 'explorer' CHECK (api_access_level IN ('test', 'explorer', 'basic', 'standard')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO google_ads_credentials (
  id,
  user_id,
  client_id,
  client_secret,
  refresh_token,
  access_token,
  developer_token,
  login_customer_id,
  access_token_expires_at,
  is_active,
  last_verified_at,
  created_at,
  updated_at,
  api_access_level
)
SELECT
  id,
  user_id,
  client_id,
  client_secret,
  refresh_token,
  access_token,
  developer_token,
  login_customer_id,
  access_token_expires_at,
  is_active,
  last_verified_at,
  created_at,
  updated_at,
  api_access_level
FROM google_ads_credentials_old_220;

DROP TABLE google_ads_credentials_old_220;

ALTER TABLE google_ads_service_accounts RENAME TO google_ads_service_accounts_old_220;

CREATE TABLE google_ads_service_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
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
FROM google_ads_service_accounts_old_220;

DROP TABLE google_ads_service_accounts_old_220;

CREATE INDEX IF NOT EXISTS idx_service_accounts_user ON google_ads_service_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_service_accounts_active ON google_ads_service_accounts(user_id, is_active);
