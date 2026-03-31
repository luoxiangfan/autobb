-- 039_add_user_id_to_creative_versions.sql
-- 为creative_versions表添加user_id列
-- 问题：代码查询使用WHERE c.user_id = ?，但表中缺少此列

-- 添加user_id列（允许NULL以兼容现有数据）
ALTER TABLE creative_versions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

-- 添加索引以优化按用户查询
CREATE INDEX IF NOT EXISTS idx_creative_versions_user_id ON creative_versions(user_id);

-- 添加复合索引以优化常用查询
CREATE INDEX IF NOT EXISTS idx_creative_versions_user_version ON creative_versions(user_id, version_number DESC);
