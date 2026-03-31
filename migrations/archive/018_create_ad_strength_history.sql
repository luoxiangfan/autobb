-- 创建Ad Strength历史记录表
-- 用于统计不同评级创意的实际转化率

CREATE TABLE IF NOT EXISTS ad_strength_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 关联字段
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  creative_id INTEGER,  -- 可选，如果创意已保存
  campaign_id TEXT,     -- Google Ads Campaign ID

  -- Ad Strength评估数据
  rating TEXT NOT NULL CHECK(rating IN ('PENDING', 'POOR', 'AVERAGE', 'GOOD', 'EXCELLENT')),
  overall_score INTEGER NOT NULL CHECK(overall_score >= 0 AND overall_score <= 100),

  -- 5维度评分
  diversity_score INTEGER NOT NULL,
  relevance_score INTEGER NOT NULL,
  completeness_score INTEGER NOT NULL,
  quality_score INTEGER NOT NULL,
  compliance_score INTEGER NOT NULL,

  -- 创意内容（快照）
  headlines_count INTEGER NOT NULL,
  descriptions_count INTEGER NOT NULL,
  keywords_count INTEGER NOT NULL,

  -- 资产特征（用于分析）
  has_numbers BOOLEAN DEFAULT 0,
  has_cta BOOLEAN DEFAULT 0,
  has_urgency BOOLEAN DEFAULT 0,
  avg_headline_length REAL,
  avg_description_length REAL,

  -- 性能数据（从Google Ads同步）
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,

  -- 计算字段
  ctr REAL GENERATED ALWAYS AS (
    CASE
      WHEN impressions > 0 THEN CAST(clicks AS REAL) / impressions
      ELSE 0
    END
  ) STORED,

  cvr REAL GENERATED ALWAYS AS (
    CASE
      WHEN clicks > 0 THEN CAST(conversions AS REAL) / clicks
      ELSE 0
    END
  ) STORED,

  cpc REAL GENERATED ALWAYS AS (
    CASE
      WHEN clicks > 0 THEN cost / clicks
      ELSE 0
    END
  ) STORED,

  -- 时间戳
  evaluated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  performance_updated_at DATETIME,

  -- 外键约束
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);

-- 创建索引优化查询
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_user ON ad_strength_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_offer ON ad_strength_history(offer_id);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_rating ON ad_strength_history(rating);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_campaign ON ad_strength_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_evaluated_at ON ad_strength_history(evaluated_at);

-- 创建组合索引（用于统计分析）
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_rating_score ON ad_strength_history(rating, overall_score);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_user_rating ON ad_strength_history(user_id, rating);
