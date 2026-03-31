-- Migration: 178_add_openclaw_gateway_guardrail_templates.sql
-- Date: 2026-02-14
-- Description: 增加 OpenClaw Gateway 鉴权限流与 HTTP 工具策略模板配置
-- Note: SQLite 版本，使用 INSERT OR IGNORE 保持幂等

INSERT OR IGNORE INTO system_settings (
  category,
  key,
  user_id,
  value,
  default_value,
  description,
  is_sensitive,
  is_required,
  data_type
)
VALUES
  (
    'openclaw',
    'gateway_auth_rate_limit_json',
    NULL,
    NULL,
    '{"maxAttempts":10,"windowMs":60000,"lockoutMs":300000,"exemptLoopback":true}',
    'OpenClaw gateway.auth.rateLimit JSON（失败鉴权限流）',
    0,
    0,
    'json'
  ),
  (
    'openclaw',
    'gateway_tools_json',
    NULL,
    NULL,
    '{"allow":["message"],"deny":["sessions_spawn","sessions_send","gateway"]}',
    'OpenClaw gateway.tools JSON（HTTP /tools/invoke allow/deny）',
    0,
    0,
    'json'
  );
