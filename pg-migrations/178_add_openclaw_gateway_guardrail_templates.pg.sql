-- Migration: 178_add_openclaw_gateway_guardrail_templates.pg.sql
-- Date: 2026-02-14
-- Description: 增加 OpenClaw Gateway 鉴权限流与 HTTP 工具策略模板配置
-- Note: PostgreSQL 版本，使用 INSERT ... WHERE NOT EXISTS 保持幂等

INSERT INTO system_settings (
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
SELECT
  'openclaw',
  'gateway_auth_rate_limit_json',
  NULL,
  NULL,
  '{"maxAttempts":10,"windowMs":60000,"lockoutMs":300000,"exemptLoopback":true}',
  'OpenClaw gateway.auth.rateLimit JSON（失败鉴权限流）',
  false,
  false,
  'json'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'gateway_auth_rate_limit_json' AND user_id IS NULL
);

INSERT INTO system_settings (
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
SELECT
  'openclaw',
  'gateway_tools_json',
  NULL,
  NULL,
  '{"allow":["message"],"deny":["sessions_spawn","sessions_send","gateway"]}',
  'OpenClaw gateway.tools JSON（HTTP /tools/invoke allow/deny）',
  false,
  false,
  'json'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'gateway_tools_json' AND user_id IS NULL
);
