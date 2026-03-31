-- Migration: 修复 creative_versions 表的 user_id 字段为 NOT NULL
-- Date: 2025-12-04
-- Description: 确保数据完整性，user_id 必须存在

-- PostgreSQL 支持直接修改列
-- Step 1: 确保没有 NULL 值
UPDATE creative_versions
SET user_id = (
  SELECT ac.user_id
  FROM ad_creatives ac
  WHERE ac.id = creative_versions.ad_creative_id
)
WHERE user_id IS NULL;

-- Step 2: 将 user_id 设置为 NOT NULL
ALTER TABLE creative_versions
ALTER COLUMN user_id SET NOT NULL;

-- Step 3: 确保索引存在
CREATE INDEX IF NOT EXISTS idx_creative_versions_user_id
ON creative_versions(user_id);

CREATE INDEX IF NOT EXISTS idx_creative_versions_user_creative
ON creative_versions(user_id, ad_creative_id);

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('047_fix_creative_versions_user_id_not_null.pg')
ON CONFLICT (migration_name) DO NOTHING;
