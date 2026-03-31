-- 创建optimization_recommendations表（存储Google Ads Recommendations API返回的优化建议）

CREATE TABLE IF NOT EXISTS optimization_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,

  -- Google Ads Recommendation信息
  recommendation_id TEXT NOT NULL UNIQUE,       -- Google Ads Recommendation ID（唯一标识）
  recommendation_type TEXT NOT NULL,            -- 建议类型
  recommendation_resource_name TEXT NOT NULL,   -- Resource name

  -- 关联信息
  campaign_id INTEGER,                          -- 关联的Campaign ID（可选）
  ad_group_id INTEGER,                          -- 关联的Ad Group ID（可选）

  -- 建议分类
  category TEXT NOT NULL,                       -- 分类：keyword | creative | bid | budget | landing_page | other
  priority TEXT NOT NULL DEFAULT 'medium',      -- 优先级：high | medium | low

  -- 建议内容（JSON存储）
  title TEXT NOT NULL,                          -- 建议标题
  description TEXT NOT NULL,                    -- 建议描述
  impact TEXT,                                  -- 预期影响（JSON：{metric: 'clicks', value: '+15%'}）
  parameters TEXT,                              -- 建议参数（JSON：具体的优化参数）

  -- 状态追踪
  status TEXT NOT NULL DEFAULT 'pending',       -- 状态：pending | applied | dismissed | expired
  applied_at TEXT,                              -- 应用时间
  dismissed_at TEXT,                            -- 忽略时间
  dismissed_reason TEXT,                        -- 忽略原因

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_group_id) REFERENCES ad_groups(id) ON DELETE CASCADE
);

-- 创建索引以提升查询性能
CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_user_id
  ON optimization_recommendations(user_id);

CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_campaign_id
  ON optimization_recommendations(campaign_id);

CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_status
  ON optimization_recommendations(status);

CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_category
  ON optimization_recommendations(category);

CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_created_at
  ON optimization_recommendations(created_at);

-- 创建复合索引（常用查询组合）
CREATE INDEX IF NOT EXISTS idx_optimization_recommendations_user_status
  ON optimization_recommendations(user_id, status);
