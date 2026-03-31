-- Migration: 修复 creative_versions 表的 user_id 字段为 NOT NULL
-- Date: 2025-12-04
-- Description: 确保数据完整性，user_id 必须存在

-- SQLite 不支持直接 ALTER COLUMN，需要重建表
-- Step 1: 创建新表
CREATE TABLE creative_versions_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ad_creative_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,

  -- 创意内容
  headlines TEXT,
  descriptions TEXT,
  path1 TEXT,
  path2 TEXT,

  -- 元数据
  change_type TEXT,
  change_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 外键约束
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,

  -- 唯一约束
  UNIQUE(ad_creative_id, version_number)
);

-- Step 2: 复制数据（如果有的话）
INSERT INTO creative_versions_new
SELECT * FROM creative_versions;

-- Step 3: 删除旧表
DROP TABLE creative_versions;

-- Step 4: 重命名新表
ALTER TABLE creative_versions_new RENAME TO creative_versions;

-- Step 5: 重建索引
CREATE INDEX IF NOT EXISTS idx_creative_versions_user_id
ON creative_versions(user_id);

CREATE INDEX IF NOT EXISTS idx_creative_versions_creative
ON creative_versions(ad_creative_id);

CREATE INDEX IF NOT EXISTS idx_creative_versions_user_creative
ON creative_versions(user_id, ad_creative_id);
