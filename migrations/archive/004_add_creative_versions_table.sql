-- Migration: 添加creative_versions表支持版本管理
-- Date: 2025-11-18
-- Description: 为Creative内容编辑功能添加版本历史追踪和回滚支持

-- 删除旧的creative_versions表（如果存在）
DROP TABLE IF EXISTS creative_versions;

-- 创建新的creative_versions表
CREATE TABLE creative_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,

  -- Creative内容（JSON格式存储，支持多个Headlines和Descriptions）
  headlines TEXT NOT NULL,  -- JSON: ["headline1", "headline2", "headline3"]
  descriptions TEXT NOT NULL,  -- JSON: ["desc1", "desc2"]
  final_url TEXT NOT NULL,
  path_1 TEXT,
  path_2 TEXT,

  -- 质量评分
  quality_score REAL,
  quality_details TEXT,  -- JSON: {relevance: 85, clarity: 90, cta: 75, uniqueness: 80}

  -- 版本元数据
  created_by TEXT NOT NULL,  -- 'ai' or 'manual' or user_id
  creation_method TEXT NOT NULL,  -- 'ai_generation', 'manual_edit', 'inline_edit', 'rollback'
  change_summary TEXT,  -- 简短描述本次修改

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 外键约束
  FOREIGN KEY (creative_id) REFERENCES creatives(id) ON DELETE CASCADE
);

-- 创建索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_creative_versions_creative_id
ON creative_versions(creative_id);

CREATE INDEX IF NOT EXISTS idx_creative_versions_version
ON creative_versions(creative_id, version_number DESC);
