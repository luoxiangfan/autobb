-- Migration: 为 ab_test_variants 表添加 user_id 字段实现用户隔离
-- Date: 2025-12-04
-- Description: 从间接隔离改为直接隔离，提升查询性能和数据安全性

-- Step 1: 删除旧表（因为没有数据，直接重建）
DROP TABLE IF EXISTS ab_test_variants;

-- Step 2: 创建新表（包含 user_id 字段）
CREATE TABLE ab_test_variants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ab_test_id INTEGER NOT NULL,

  -- 变体信息
  variant_name TEXT NOT NULL, -- A, B, C, etc.
  variant_label TEXT, -- 可读的标签，如 "Original", "Variation 1"
  ad_creative_id INTEGER NOT NULL,

  -- 流量分配
  traffic_allocation REAL NOT NULL DEFAULT 0.5 CHECK(traffic_allocation >= 0 AND traffic_allocation <= 1),
  is_control INTEGER NOT NULL DEFAULT 0, -- 是否为对照组

  -- 测试结果缓存（从campaign_performance聚合）
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  ctr REAL,
  conversion_rate REAL,
  cpa REAL,
  confidence_interval_lower REAL,
  confidence_interval_upper REAL,
  p_value REAL,

  -- 元数据
  last_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- 外键约束
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ab_test_id) REFERENCES ab_tests(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE
);

-- Step 3: 创建索引
CREATE INDEX IF NOT EXISTS idx_ab_test_variants_user_id
ON ab_test_variants(user_id);

CREATE INDEX IF NOT EXISTS idx_ab_test_variants_ab_test_id
ON ab_test_variants(ab_test_id);

CREATE INDEX IF NOT EXISTS idx_ab_test_variants_user_test
ON ab_test_variants(user_id, ab_test_id);

CREATE INDEX IF NOT EXISTS idx_ab_test_variants_creative
ON ab_test_variants(ad_creative_id);
