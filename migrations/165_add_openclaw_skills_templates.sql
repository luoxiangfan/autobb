-- Migration: 165_add_openclaw_skills_templates.sql
-- Date: 2026-02-07
-- Description: 增加 OpenClaw skills 配置模板（entries/allowBundled）
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
VALUES (
  'openclaw',
  'openclaw_skills_entries_json',
  NULL,
  NULL,
  NULL,
  'OpenClaw skills.entries 覆盖配置 JSON（启用/禁用技能或注入技能配置）',
  0,
  0,
  'json'
);

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
VALUES (
  'openclaw',
  'openclaw_skills_allow_bundled_json',
  NULL,
  NULL,
  NULL,
  'OpenClaw skills.allowBundled 白名单 JSON 数组（控制可用内置技能）',
  0,
  0,
  'json'
);
