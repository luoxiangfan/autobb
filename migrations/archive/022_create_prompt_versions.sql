-- Migration: 019_create_prompt_versions
-- Description: 创建Prompt版本管理表
-- Created: 2025-12-01

-- Prompt版本表
CREATE TABLE IF NOT EXISTS prompt_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id TEXT NOT NULL,                 -- Prompt唯一标识（如 'ad_elements_headlines'）
  version TEXT NOT NULL,                   -- 版本号（如 'v1.0', 'v1.1'）
  category TEXT NOT NULL,                  -- 业务分类
  name TEXT NOT NULL,                      -- 功能名称
  description TEXT,                        -- 功能描述
  file_path TEXT NOT NULL,                 -- 源文件路径
  function_name TEXT NOT NULL,             -- 函数名称
  prompt_content TEXT NOT NULL,            -- 完整Prompt内容
  language TEXT DEFAULT 'English',         -- Prompt语言
  created_by INTEGER,                      -- 创建者用户ID
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active INTEGER DEFAULT 0,             -- 是否为当前激活版本（0=否, 1=是）
  change_notes TEXT,                       -- 版本变更说明

  UNIQUE(prompt_id, version),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_active ON prompt_versions(is_active);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_created_at ON prompt_versions(created_at DESC);

-- Prompt使用统计表
CREATE TABLE IF NOT EXISTS prompt_usage_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_id TEXT NOT NULL,
  version TEXT NOT NULL,
  usage_date DATE NOT NULL,              -- 使用日期
  call_count INTEGER DEFAULT 0,          -- 调用次数
  total_tokens INTEGER DEFAULT 0,        -- 总Token消耗
  total_cost REAL DEFAULT 0,             -- 总成本
  avg_quality_score REAL,                -- 平均质量评分

  UNIQUE(prompt_id, version, usage_date),
  FOREIGN KEY (prompt_id, version) REFERENCES prompt_versions(prompt_id, version) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_prompt_usage_stats_date ON prompt_usage_stats(usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_usage_stats_prompt ON prompt_usage_stats(prompt_id, version);
