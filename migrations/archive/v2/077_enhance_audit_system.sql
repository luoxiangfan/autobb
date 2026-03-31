-- Migration: 077_enhance_audit_system.sql
-- Purpose: 完善审计系统 - 增强login_attempts表和audit_logs表
-- Date: 2025-12-17
-- 注意：本迁移文件需要兼容SQLite和PostgreSQL

-- ============================================================================
-- 1. 完善 login_attempts 表 - 添加设备和浏览器信息
-- ============================================================================

-- SQLite不支持ALTER TABLE ADD COLUMN IF NOT EXISTS
-- 策略：直接执行ALTER TABLE，如果列已存在会被忽略（通过迁移系统的错误处理）

-- 添加设备类型字段（Desktop, Mobile, Tablet, Bot）
ALTER TABLE login_attempts ADD COLUMN device_type TEXT DEFAULT 'Unknown';

-- 添加操作系统字段
ALTER TABLE login_attempts ADD COLUMN os TEXT DEFAULT 'Unknown';

-- 添加浏览器字段
ALTER TABLE login_attempts ADD COLUMN browser TEXT DEFAULT 'Unknown';

-- 添加浏览器版本字段
ALTER TABLE login_attempts ADD COLUMN browser_version TEXT;

-- 添加完整的User-Agent字段索引（用于快速查询特定设备）
CREATE INDEX IF NOT EXISTS idx_login_attempts_device_type ON login_attempts(device_type);
CREATE INDEX IF NOT EXISTS idx_login_attempts_os ON login_attempts(os);
CREATE INDEX IF NOT EXISTS idx_login_attempts_browser ON login_attempts(browser);

-- ============================================================================
-- 2. 完善 audit_logs 表 - 确保字段完整性
-- ============================================================================

-- 防御：某些旧库可能缺少 audit_logs（例如上游迁移失败/跳过）。
-- 先确保基础表存在，再做后续 ALTER（重复执行时由迁移系统忽略重复列错误）。
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  details TEXT, -- JSON format
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 扩展字段（本迁移后续也会尝试 ALTER 添加；这里提前放入以便缺表场景一次到位）
  operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  operator_username TEXT,
  target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  target_username TEXT,
  status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failure')),
  error_message TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- audit_logs 表已经存在完整字段，只需确保索引优化
-- 已有字段：id, user_id, event_type, ip_address, user_agent, details, created_at

-- 添加操作人字段（记录是谁执行的操作，用于管理员操作审计）
ALTER TABLE audit_logs ADD COLUMN operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN operator_username TEXT;

-- 添加target_user_id字段（记录被操作的用户ID，用于用户管理审计）
ALTER TABLE audit_logs ADD COLUMN target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN target_username TEXT;

-- 添加操作结果字段
ALTER TABLE audit_logs ADD COLUMN status TEXT DEFAULT 'success' CHECK (status IN ('success', 'failure'));

-- 添加错误信息字段
ALTER TABLE audit_logs ADD COLUMN error_message TEXT;

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_id ON audit_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id ON audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at ON audit_logs(user_id, created_at);

-- ============================================================================
-- 3. 创建审计日志事件类型枚举（注释说明，实际存储为TEXT）
-- ============================================================================

-- 用户管理操作事件类型：
-- - user_created: 创建用户
-- - user_updated: 更新用户信息
-- - user_disabled: 禁用用户
-- - user_enabled: 启用用户
-- - user_deleted: 删除用户（永久）
-- - user_password_reset: 管理员重置密码
-- - user_unlocked: 解锁账户
--
-- 认证事件类型：
-- - login_success: 登录成功
-- - login_failed: 登录失败
-- - account_locked: 账户被锁定
-- - password_changed: 用户修改密码
-- - logout: 用户登出

-- ============================================================================
-- 4. 数据修复 - 补充现有记录的设备信息（基于user_agent解析）
-- ============================================================================

-- 基于User-Agent字符串更新device_type
UPDATE login_attempts
SET device_type = CASE
    WHEN user_agent LIKE '%Mobile%' OR user_agent LIKE '%Android%' OR user_agent LIKE '%iPhone%' THEN 'Mobile'
    WHEN user_agent LIKE '%Tablet%' OR user_agent LIKE '%iPad%' THEN 'Tablet'
    WHEN user_agent LIKE '%Bot%' OR user_agent LIKE '%Spider%' OR user_agent LIKE '%Crawler%' THEN 'Bot'
    ELSE 'Desktop'
END
WHERE device_type = 'Unknown';

-- 基于User-Agent字符串更新os
UPDATE login_attempts
SET os = CASE
    WHEN user_agent LIKE '%Windows%' THEN 'Windows'
    WHEN user_agent LIKE '%Macintosh%' OR user_agent LIKE '%Mac OS%' THEN 'macOS'
    WHEN user_agent LIKE '%Linux%' THEN 'Linux'
    WHEN user_agent LIKE '%iPhone%' OR user_agent LIKE '%iPad%' THEN 'iOS'
    WHEN user_agent LIKE '%Android%' THEN 'Android'
    ELSE 'Unknown'
END
WHERE os = 'Unknown';

-- 基于User-Agent字符串更新browser
UPDATE login_attempts
SET browser = CASE
    WHEN user_agent LIKE '%Edg/%' THEN 'Edge'
    WHEN user_agent LIKE '%Chrome/%' AND user_agent NOT LIKE '%Edg/%' THEN 'Chrome'
    WHEN user_agent LIKE '%Firefox/%' THEN 'Firefox'
    WHEN user_agent LIKE '%Safari/%' AND user_agent NOT LIKE '%Chrome/%' THEN 'Safari'
    WHEN user_agent LIKE '%curl/%' THEN 'curl'
    WHEN user_agent LIKE '%Postman%' THEN 'Postman'
    ELSE 'Unknown'
END
WHERE browser = 'Unknown';

-- ============================================================================
-- 5. 创建统计视图 - 便于快速查询审计统计信息
-- ============================================================================

-- 用户登录统计视图
CREATE VIEW IF NOT EXISTS v_login_stats AS
SELECT
    username_or_email,
    COUNT(*) as total_attempts,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful_logins,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failed_logins,
    MAX(attempted_at) as last_attempt,
    device_type,
    os,
    browser
FROM login_attempts
GROUP BY username_or_email, device_type, os, browser;

-- 用户操作审计统计视图
CREATE VIEW IF NOT EXISTS v_user_audit_stats AS
SELECT
    operator_id,
    operator_username,
    event_type,
    COUNT(*) as operation_count,
    MAX(created_at) as last_operation,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count
FROM audit_logs
WHERE event_type LIKE 'user_%'
GROUP BY operator_id, operator_username, event_type;

-- ============================================================================
-- Migration完成
-- ============================================================================
