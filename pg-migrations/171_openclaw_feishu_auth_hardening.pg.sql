-- Migration: 171_openclaw_feishu_auth_hardening.pg.sql
-- Description: Add strict Feishu auth templates and binding uniqueness indexes
-- Date: 2026-02-08
-- Database: PostgreSQL

-- ---------------------------------------------------------------------
-- 1) OpenClaw strict Feishu auth templates
--    NOTE: Do NOT use ON CONFLICT here.
--    Existing PostgreSQL schema uses partial unique indexes on system_settings,
--    so ON CONFLICT (user_id, category, key) cannot infer a matching constraint.
-- ---------------------------------------------------------------------
INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  default_value,
  description
)
SELECT
  NULL,
  'openclaw',
  'feishu_auth_mode',
  NULL,
  'string',
  false,
  false,
  'strict',
  'Feishu auth mode (strict/compat)'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'openclaw'
    AND key = 'feishu_auth_mode'
    AND user_id IS NULL
);

INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  default_value,
  description
)
SELECT
  NULL,
  'openclaw',
  'feishu_require_tenant_key',
  NULL,
  'boolean',
  false,
  false,
  'true',
  'Require tenant_key in strict auth mode'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'openclaw'
    AND key = 'feishu_require_tenant_key'
    AND user_id IS NULL
);

INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  default_value,
  description
)
SELECT
  NULL,
  'openclaw',
  'feishu_strict_auto_bind',
  NULL,
  'boolean',
  false,
  false,
  'true',
  'Auto-bind sender to current account in strict auth mode when no binding exists'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'openclaw'
    AND key = 'feishu_strict_auto_bind'
    AND user_id IS NULL
);

-- ---------------------------------------------------------------------
-- 2) openclaw_user_bindings uniqueness hardening
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_open_unique
  ON openclaw_user_bindings(channel, tenant_key, open_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_openclaw_bindings_channel_tenant_union_unique
  ON openclaw_user_bindings(channel, tenant_key, union_id)
  WHERE union_id IS NOT NULL;
