-- Migration: Rebuild creative_versions table with correct schema
-- Date: 2025-12-03
-- Description: Schema与代码使用完全不匹配，需要重建表结构

-- ============================================================================
-- 备份现有数据（如果有）
-- ============================================================================
CREATE TABLE IF NOT EXISTS creative_versions_backup AS 
SELECT * FROM creative_versions;

-- ============================================================================
-- 删除旧表
-- ============================================================================
DROP TABLE IF EXISTS creative_versions;

-- ============================================================================
-- 创建新表（与代码实际使用一致）
-- ============================================================================
CREATE TABLE creative_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  headlines TEXT NOT NULL,  -- JSON格式: ["H1", "H2", "H3"]
  descriptions TEXT NOT NULL,  -- JSON格式: ["D1", "D2"]
  final_url TEXT NOT NULL,
  path_1 TEXT,
  path_2 TEXT,
  quality_score INTEGER,
  quality_details TEXT,  -- JSON格式
  budget_amount REAL,
  clicks INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  created_by TEXT NOT NULL,  -- 用户标识（字符串）
  creation_method TEXT NOT NULL,  -- inline_edit, ai_generation, rollback等
  change_summary TEXT,  -- 变更说明
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE
);

-- ============================================================================
-- 创建索引
-- ============================================================================
CREATE INDEX idx_creative_versions_creative_id ON creative_versions(creative_id);
CREATE INDEX idx_creative_versions_version ON creative_versions(creative_id, version_number);

-- ============================================================================
-- 注意：无法自动迁移数据，因为字段结构完全不同
-- 如果需要保留旧数据，请手动处理 creative_versions_backup 表
-- ============================================================================
