-- 039_add_user_id_to_creative_versions.sql
-- 为creative_versions表添加user_id列
-- 问题：代码查询使用WHERE c.user_id = ?，但表中缺少此列

-- 添加user_id列（允许NULL以兼容现有数据）

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creative_versions' AND column_name = 'user_id') THEN
    ALTER TABLE creative_versions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
    RAISE NOTICE '✅ 添加 user_id 字段到 creative_versions';
  ELSE
    RAISE NOTICE '⏭️  user_id 字段已存在于 creative_versions';
  END IF;
END $$;

-- 添加索引以优化按用户查询
CREATE INDEX IF NOT EXISTS idx_creative_versions_user_id ON creative_versions(user_id);

-- 添加复合索引以优化常用查询
CREATE INDEX IF NOT EXISTS idx_creative_versions_user_version ON creative_versions(user_id, version_number DESC);


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('039_add_user_id_to_creative_versions.pg')
ON CONFLICT (migration_name) DO NOTHING;
