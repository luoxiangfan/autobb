-- 007_create_risk_alerts_tables.sql
-- 创建风险提示相关表

-- 风险提示表
CREATE TABLE IF NOT EXISTS risk_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,

  -- 风险类型
  alert_type TEXT NOT NULL CHECK (alert_type IN (
    'link_broken',           -- 链接失效
    'link_redirect',         -- 链接重定向
    'link_timeout',          -- 链接超时
    'account_suspended',     -- 账号暂停
    'campaign_paused',       -- Campaign异常暂停
    'budget_exhausted',      -- 预算耗尽
    'low_quality_score'      -- 质量分过低
  )),

  -- 严重程度
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),

  -- 关联资源
  resource_type TEXT CHECK (resource_type IN ('campaign', 'creative', 'offer')),
  resource_id INTEGER,

  -- 提示内容
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT, -- JSON格式的详细信息

  -- 处理状态
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  resolved_at TEXT,

  -- 备注
  resolution_note TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 链接检查历史表
CREATE TABLE IF NOT EXISTS link_check_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 检查的URL
  url TEXT NOT NULL,

  -- 检查结果
  status_code INTEGER,
  response_time INTEGER, -- 毫秒
  is_accessible BOOLEAN NOT NULL,
  is_redirected BOOLEAN NOT NULL DEFAULT 0,
  final_url TEXT, -- 重定向后的最终URL

  -- 检查配置
  check_country TEXT NOT NULL DEFAULT 'US', -- 模拟检查的国家
  user_agent TEXT,

  -- 错误信息
  error_message TEXT,

  -- 时间戳
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_status
ON risk_alerts(user_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_type
ON risk_alerts(alert_type, status);

CREATE INDEX IF NOT EXISTS idx_risk_alerts_created
ON risk_alerts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_link_check_offer
ON link_check_history(offer_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_link_check_user
ON link_check_history(user_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_link_check_accessible
ON link_check_history(is_accessible, checked_at DESC);
