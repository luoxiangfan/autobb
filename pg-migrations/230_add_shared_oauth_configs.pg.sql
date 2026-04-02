-- Google Ads 共享 OAuth 配置表 (PostgreSQL)
-- 管理员创建 OAuth 配置，用户可以绑定并授权

CREATE TABLE IF NOT EXISTS google_ads_shared_oauth_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- 配置名称（例如："主账户 OAuth 配置"）
  description TEXT,                       -- 配置描述
  client_id TEXT NOT NULL,                -- OAuth Client ID
  client_secret TEXT NOT NULL,            -- OAuth Client Secret（加密存储）
  developer_token TEXT NOT NULL,          -- Developer Token（加密存储）
  login_customer_id TEXT NOT NULL,        -- MCC 账户 ID（10 位数字）
  created_by INTEGER NOT NULL,            -- 创建者用户 ID（管理员）
  is_active BOOLEAN NOT NULL DEFAULT TRUE, -- 是否激活
  version INTEGER NOT NULL DEFAULT 1,     -- 版本号（用于追踪配置变更）
  last_modified_at TIMESTAMP,             -- 最后修改时间
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 用户 OAuth 授权绑定表
-- 记录用户选择了哪个共享配置并完成授权

CREATE TABLE IF NOT EXISTS google_ads_user_oauth_bindings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,               -- 用户 ID
  oauth_config_id TEXT NOT NULL,          -- 关联的共享 OAuth 配置 ID
  refresh_token TEXT,                     -- OAuth Refresh Token（加密存储）
  authorized_at TIMESTAMP,                -- 用户授权时间
  needs_reauth BOOLEAN NOT NULL DEFAULT FALSE, -- 是否需要重新授权（管理员修改配置后置 TRUE）
  is_active BOOLEAN NOT NULL DEFAULT TRUE, -- 是否激活
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (oauth_config_id) REFERENCES google_ads_shared_oauth_configs(id),
  UNIQUE(user_id, oauth_config_id)        -- 一个用户只能绑定一个共享 OAuth 配置
);

-- 用户服务账号绑定表
-- 管理员将服务账号绑定到用户

CREATE TABLE IF NOT EXISTS google_ads_user_sa_bindings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,               -- 用户 ID
  service_account_id TEXT NOT NULL,       -- 服务账号 ID
  bound_by INTEGER NOT NULL,              -- 绑定者用户 ID（管理员）
  bound_at TIMESTAMP NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE, -- 是否激活
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (service_account_id) REFERENCES google_ads_service_accounts(id),
  UNIQUE(user_id, service_account_id)     -- 一个用户只能绑定一个服务账号
);

-- 修改现有的 google_ads_service_accounts 表，增加 is_shared 字段

ALTER TABLE google_ads_service_accounts 
ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE google_ads_service_accounts 
ADD COLUMN IF NOT EXISTS description TEXT;

-- 创建索引以优化查询性能

CREATE INDEX IF NOT EXISTS idx_shared_oauth_configs_active ON google_ads_shared_oauth_configs(is_active);
CREATE INDEX IF NOT EXISTS idx_user_oauth_bindings_user ON google_ads_user_oauth_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_oauth_bindings_config ON google_ads_user_oauth_bindings(oauth_config_id);
CREATE INDEX IF NOT EXISTS idx_user_sa_bindings_user ON google_ads_user_sa_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sa_bindings_sa ON google_ads_user_sa_bindings(service_account_id);
CREATE INDEX IF NOT EXISTS idx_service_accounts_shared ON google_ads_service_accounts(is_shared);

-- 记录迁移历史

INSERT INTO migration_history (migration_name, applied_at) 
VALUES ('230_add_shared_oauth_configs.pg.sql', NOW())
ON CONFLICT (migration_name) DO UPDATE SET applied_at = NOW();
