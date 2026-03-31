-- Migration: 创建creative_learning_patterns表存储成功创意特征
-- Date: 2025-11-19
-- Description: 存储高表现创意的成功模式，供AI Prompt优化使用

-- 创建creative_learning_patterns表
CREATE TABLE IF NOT EXISTS creative_learning_patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,

  -- 成功特征数据（JSON格式存储）
  success_features TEXT NOT NULL,  -- JSON: SuccessFeatures对象

  -- 统计信息
  total_creatives_analyzed INTEGER NOT NULL,  -- 分析的创意数量
  avg_ctr REAL NOT NULL,  -- 平均CTR
  avg_conversion_rate REAL NOT NULL,  -- 平均转化率
  min_ctr_threshold REAL NOT NULL,  -- CTR最低阈值

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 外键约束
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_creative_learning_user
ON creative_learning_patterns(user_id, updated_at DESC);

-- 创建creative_performance_scores表存储创意评分历史
CREATE TABLE IF NOT EXISTS creative_performance_scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  creative_id INTEGER NOT NULL,

  -- 评分数据
  score INTEGER NOT NULL,  -- 0-100分
  rating TEXT NOT NULL CHECK(rating IN ('excellent', 'good', 'average', 'poor')),
  is_good INTEGER NOT NULL DEFAULT 0,  -- 0 or 1 (boolean)

  -- 性能指标快照
  metrics_snapshot TEXT NOT NULL,  -- JSON: {ctr, cpc, clicks, conversions, budget}
  reasons TEXT NOT NULL,  -- JSON array: ["优秀CTR...", "低CPC..."]

  -- 时间戳
  scored_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 外键约束
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES creative_versions(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_creative_scores_user
ON creative_performance_scores(user_id, scored_at DESC);

CREATE INDEX IF NOT EXISTS idx_creative_scores_creative
ON creative_performance_scores(creative_id, scored_at DESC);

CREATE INDEX IF NOT EXISTS idx_creative_scores_rating
ON creative_performance_scores(user_id, rating, is_good);
