-- Migration: 为 ab_test_variants 表添加 user_id 字段实现用户隔离
-- Date: 2025-12-04
-- Description: 从间接隔离改为直接隔离，提升查询性能和数据安全性

-- Step 1: 添加 user_id 字段（允许 NULL，用于数据迁移）
ALTER TABLE ab_test_variants
ADD COLUMN user_id INTEGER;

-- Step 2: 回填 user_id 数据（从 ab_tests 表获取）
UPDATE ab_test_variants
SET user_id = (
  SELECT at.user_id
  FROM ab_tests at
  WHERE at.id = ab_test_variants.ab_test_id
);

-- Step 3: 将 user_id 设置为 NOT NULL
ALTER TABLE ab_test_variants
ALTER COLUMN user_id SET NOT NULL;

-- Step 4: 添加外键约束
ALTER TABLE ab_test_variants
ADD CONSTRAINT fk_ab_test_variants_user_id
FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Step 5: 创建索引
CREATE INDEX IF NOT EXISTS idx_ab_test_variants_user_id
ON ab_test_variants(user_id);

CREATE INDEX IF NOT EXISTS idx_ab_test_variants_user_test
ON ab_test_variants(user_id, ab_test_id);

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('046_add_user_id_to_ab_test_variants.pg')
ON CONFLICT (migration_name) DO NOTHING;
