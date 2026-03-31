-- Migration: 135_add_google_ads_test_credentials.sql
-- Date: 2026-01-08
-- Description: 添加 google_ads_test_credentials 表 + Google Ads 测试OAuth配置模板（system_settings）
-- Note: SQLite 版本，使用 INSERT OR IGNORE 实现幂等插入

-- 1) 测试OAuth凭证表（与 google_ads_credentials 隔离，避免影响现有OAuth用户授权）
CREATE TABLE IF NOT EXISTS google_ads_test_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  developer_token TEXT NOT NULL,
  login_customer_id TEXT,
  access_token_expires_at TEXT,
  is_active INTEGER DEFAULT 1,
  last_verified_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 2) system_settings 全局模板：Google Ads “测试权限MCC诊断”专用配置项
INSERT OR IGNORE INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES (NULL, 'google_ads', 'test_login_customer_id', NULL, 'string', 0, 0, '【测试】Login Customer ID (MCC账户ID)');

INSERT OR IGNORE INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES (NULL, 'google_ads', 'test_client_id', NULL, 'string', 1, 0, '【测试】OAuth Client ID（仅用于测试诊断，不影响现有OAuth）');

INSERT OR IGNORE INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES (NULL, 'google_ads', 'test_client_secret', NULL, 'string', 1, 0, '【测试】OAuth Client Secret（仅用于测试诊断，不影响现有OAuth）');

INSERT OR IGNORE INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES (NULL, 'google_ads', 'test_developer_token', NULL, 'string', 1, 0, '【测试】Developer Token（测试权限/Test access，用于验证MCC调用限制）');

