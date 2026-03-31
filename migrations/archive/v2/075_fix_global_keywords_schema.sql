-- Migration: 075_fix_global_keywords_schema.sql
-- Purpose: 修复 global_keywords 表结构（旧结构 keyword_text → 新结构 keyword）
-- Date: 2025-12-17
--
-- ⚠️ 重要：此迁移仅适用于旧结构（有 keyword_text 字段）的数据库
-- 如果数据库已经是新结构（有 keyword 字段），迁移系统会因哈希匹配而跳过

-- Step 1: 创建新结构表
CREATE TABLE IF NOT EXISTS global_keywords_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  language TEXT NOT NULL DEFAULT 'en',
  search_volume INTEGER DEFAULT 0,
  competition_level TEXT,
  avg_cpc_micros INTEGER,
  cached_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(keyword, country, language)
);

-- Step 2: 从旧表迁移数据（keyword_text → keyword）
INSERT OR IGNORE INTO global_keywords_v2 (keyword, country, language, search_volume, competition_level, avg_cpc_micros, created_at)
SELECT
  keyword_text,
  COALESCE(country, 'US'),
  COALESCE(language, 'en'),
  search_volume,
  competition_level,
  avg_cpc_micros,
  created_at
FROM global_keywords
WHERE keyword_text IS NOT NULL;

-- Step 3: 删除旧表
DROP TABLE IF EXISTS global_keywords;

-- Step 4: 重命名新表
ALTER TABLE global_keywords_v2 RENAME TO global_keywords;

-- Step 5: 创建索引
CREATE INDEX IF NOT EXISTS idx_global_keywords_lookup
ON global_keywords(keyword, country, language);

CREATE INDEX IF NOT EXISTS idx_global_keywords_cached_at
ON global_keywords(cached_at);
