-- Migration: 165_add_openclaw_skills_templates.pg.sql
-- Date: 2026-02-07
-- Description: 增加 OpenClaw skills 配置模板（entries/allowBundled）
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
  'openclaw_skills_entries_json',
  NULL,
  NULL,
  NULL,
  'OpenClaw skills.entries 覆盖配置 JSON（启用/禁用技能或注入技能配置）',
  false,
  false,
  'json'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_skills_entries_json' AND user_id IS NULL
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
  'openclaw_skills_allow_bundled_json',
  NULL,
  NULL,
  NULL,
  'OpenClaw skills.allowBundled 白名单 JSON 数组（控制可用内置技能）',
  false,
  false,
  'json'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_skills_allow_bundled_json' AND user_id IS NULL
);
