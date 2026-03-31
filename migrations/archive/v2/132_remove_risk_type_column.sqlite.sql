-- Migration: Remove risk_type field from risk_alerts table (SQLite)
-- Date: 2026-01-06
-- Description: risk_type 和 alert_type 是重复字段，删除 risk_type 简化数据结构
-- Note: SQLite 不支持直接删除列，使用重命名表的方式

-- 🛡️ 防御：SQLite 在执行 DDL（DROP/ALTER）时会重新加载 schema，
-- 若存在“损坏视图”（引用了不存在的列），会导致本迁移在早期步骤失败。
-- 这里先删除相关视图，等表结构变更完成后再重建。
DROP VIEW IF EXISTS v_offers_boolean_integrity;
DROP VIEW IF EXISTS v_campaigns_boolean_integrity;
DROP VIEW IF EXISTS v_google_ads_accounts_boolean_integrity;
DROP VIEW IF EXISTS v_prompt_versions_boolean_integrity;
DROP VIEW IF EXISTS v_system_settings_boolean_integrity;

-- ✅ 兼容：某些旧/异常环境可能缺少 risk_alerts 表，导致 Step 2 复制数据时报错
-- 先确保表存在（空表也可），并补齐 risk_type/alert_type 以支持后续统一迁移逻辑
CREATE TABLE IF NOT EXISTS risk_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  risk_type TEXT,
  alert_type TEXT,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  related_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  resolved_at TEXT,
  resolved_by INTEGER,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resource_type TEXT,
  resource_id INTEGER,
  details TEXT,
  acknowledged_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);
ALTER TABLE risk_alerts ADD COLUMN risk_type TEXT;
ALTER TABLE risk_alerts ADD COLUMN alert_type TEXT;
UPDATE risk_alerts SET alert_type = COALESCE(alert_type, risk_type) WHERE alert_type IS NULL;

-- 防御：上次失败可能遗留临时表
DROP TABLE IF EXISTS risk_alerts_new;

-- Step 1: 创建新表（不含 risk_type）
CREATE TABLE risk_alerts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  alert_type TEXT,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  related_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  resolved_at TEXT,
  resolved_by INTEGER,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resource_type TEXT,
  resource_id INTEGER,
  details TEXT,
  acknowledged_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);

-- Step 2: 复制数据
INSERT INTO risk_alerts_new (
  id, user_id, alert_type, severity, title, message,
  related_type, related_id, related_name, status,
  resolved_at, resolved_by, detected_at, created_at, updated_at,
  resource_type, resource_id, details, acknowledged_at
)
SELECT
  id, user_id, alert_type, severity, title, message,
  related_type, related_id, related_name, status,
  resolved_at, resolved_by, detected_at, created_at, updated_at,
  resource_type, resource_id, details, acknowledged_at
FROM risk_alerts;

-- Step 3: 删除旧表
DROP TABLE IF EXISTS risk_alerts;

-- Step 4: 重命名新表
ALTER TABLE risk_alerts_new RENAME TO risk_alerts;

-- Step 5: 重建索引
CREATE INDEX IF NOT EXISTS idx_risk_alerts_alert_type ON risk_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_resource ON risk_alerts(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_severity ON risk_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_type ON risk_alerts(alert_type, status);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_severity_status ON risk_alerts(user_id, severity, status);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_status ON risk_alerts(user_id, status);
-- Step 6: 重建视图（SQLite 在表结构变更后需要重建依赖视图）
-- 🛡️ 兼容：campaigns 表可能被旧迁移重建后遗漏 is_active 列（例如 108），先补齐
ALTER TABLE campaigns ADD COLUMN is_active INTEGER DEFAULT 1;
UPDATE campaigns SET is_active = 1 WHERE is_active IS NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_is_active ON campaigns(is_active);
CREATE INDEX IF NOT EXISTS idx_offers_is_active ON offers(is_active);

-- 重新创建视图（来自 078_fix_boolean_columns.sql）
CREATE VIEW IF NOT EXISTS v_offers_boolean_integrity AS
SELECT
    'offers' as table_name,
    'is_deleted' as column_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN is_deleted NOT IN (0, 1) OR is_deleted IS NULL THEN 1 ELSE 0 END) as invalid_count,
    COUNT(CASE WHEN is_deleted = 1 THEN 1 END) as true_count,
    COUNT(CASE WHEN is_deleted = 0 THEN 1 END) as false_count
FROM offers
UNION ALL
SELECT
    'offers' as table_name,
    'is_active' as column_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN is_active NOT IN (0, 1) OR is_active IS NULL THEN 1 ELSE 0 END) as invalid_count,
    COUNT(CASE WHEN is_active = 1 THEN 1 END) as true_count,
    COUNT(CASE WHEN is_active = 0 THEN 1 END) as false_count
FROM offers;

CREATE VIEW IF NOT EXISTS v_campaigns_boolean_integrity AS
SELECT
    'campaigns' as table_name,
    'is_deleted' as column_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN is_deleted NOT IN (0, 1) OR is_deleted IS NULL THEN 1 ELSE 0 END) as invalid_count,
    COUNT(CASE WHEN is_deleted = 1 THEN 1 END) as true_count,
    COUNT(CASE WHEN is_deleted = 0 THEN 1 END) as false_count
FROM campaigns
UNION ALL
SELECT
    'campaigns' as table_name,
    'is_active' as column_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN is_active NOT IN (0, 1) OR is_active IS NULL THEN 1 ELSE 0 END) as invalid_count,
    COUNT(CASE WHEN is_active = 1 THEN 1 END) as true_count,
    COUNT(CASE WHEN is_active = 0 THEN 1 END) as false_count
FROM campaigns;

CREATE VIEW IF NOT EXISTS v_google_ads_accounts_boolean_integrity AS
SELECT
    'google_ads_accounts' as table_name,
    'is_active' as column_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN is_active NOT IN (0, 1) OR is_active IS NULL THEN 1 ELSE 0 END) as invalid_count,
    COUNT(CASE WHEN is_active = 1 THEN 1 END) as true_count,
    COUNT(CASE WHEN is_active = 0 THEN 1 END) as false_count
FROM google_ads_accounts;

CREATE VIEW IF NOT EXISTS v_prompt_versions_boolean_integrity AS
SELECT
    'prompt_versions' as table_name,
    'is_active' as column_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN is_active NOT IN (0, 1) OR is_active IS NULL THEN 1 ELSE 0 END) as invalid_count,
    COUNT(CASE WHEN is_active = 1 THEN 1 END) as true_count,
    COUNT(CASE WHEN is_active = 0 THEN 1 END) as false_count
FROM prompt_versions;

CREATE VIEW IF NOT EXISTS v_system_settings_boolean_integrity AS
SELECT
    'system_settings' as table_name,
    'is_sensitive' as column_name,
    COUNT(*) as total_rows,
    SUM(CASE WHEN is_sensitive NOT IN (0, 1) OR is_sensitive IS NULL THEN 1 ELSE 0 END) as invalid_count,
    COUNT(CASE WHEN is_sensitive = 1 THEN 1 END) as true_count,
    COUNT(CASE WHEN is_sensitive = 0 THEN 1 END) as false_count
FROM system_settings;
