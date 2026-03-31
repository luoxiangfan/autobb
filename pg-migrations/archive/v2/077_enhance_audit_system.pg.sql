-- Migration: 077_enhance_audit_system.pg.sql
-- Purpose: 完善审计系统 - 增强login_attempts表和audit_logs表（PostgreSQL版本）
-- Date: 2025-12-17

-- ============================================================================
-- 1. 完善 login_attempts 表 - 添加设备和浏览器信息
-- ============================================================================

-- 添加设备类型字段（Desktop, Mobile, Tablet, Bot）
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'Unknown';

-- 添加操作系统字段
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS os TEXT DEFAULT 'Unknown';

-- 添加浏览器字段
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS browser TEXT DEFAULT 'Unknown';

-- 添加浏览器版本字段
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS browser_version TEXT;

-- 添加完整的User-Agent字段索引（用于快速查询特定设备）
CREATE INDEX IF NOT EXISTS idx_login_attempts_device_type ON login_attempts(device_type);
CREATE INDEX IF NOT EXISTS idx_login_attempts_os ON login_attempts(os);
CREATE INDEX IF NOT EXISTS idx_login_attempts_browser ON login_attempts(browser);

-- ============================================================================
-- 2. 完善 audit_logs 表 - 确保字段完整性
-- ============================================================================

-- audit_logs 表已经存在完整字段，只需确保索引优化
-- 已有字段：id, user_id, event_type, ip_address, user_agent, details, created_at

-- 添加操作人字段（记录是谁执行的操作，用于管理员操作审计）
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS operator_username TEXT;

-- 添加target_user_id字段（记录被操作的用户ID，用于用户管理审计）
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_username TEXT;

-- 添加操作结果字段
DO $$
BEGIN
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'audit_logs_status_check' AND conrelid = 'audit_logs'::regclass
    ) THEN
        ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_status_check CHECK (status IN ('success', 'failure'));
    END IF;
END $$;

-- 添加错误信息字段
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS error_message TEXT;

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
CREATE OR REPLACE VIEW v_login_stats AS
SELECT
    username_or_email,
    COUNT(*) as total_attempts,
    SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as successful_logins,
    SUM(CASE WHEN success = FALSE THEN 1 ELSE 0 END) as failed_logins,
    MAX(attempted_at) as last_attempt,
    device_type,
    os,
    browser
FROM login_attempts
GROUP BY username_or_email, device_type, os, browser;

-- 用户操作审计统计视图
CREATE OR REPLACE VIEW v_user_audit_stats AS
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
