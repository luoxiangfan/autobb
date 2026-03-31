-- ==========================================
-- creative_tasks Table (Ad Creative Generation Task Queue)
-- ==========================================
-- 用于管理广告创意生成任务的队列表
-- 支持多轮优化、进度追踪、用户级隔离

CREATE TABLE IF NOT EXISTS creative_tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 任务状态
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  stage TEXT DEFAULT 'init',  -- init, generating, evaluating, saving, complete
  progress INTEGER DEFAULT 0,  -- 0-100
  message TEXT,

  -- 输入参数
  max_retries INTEGER DEFAULT 3,
  target_rating TEXT DEFAULT 'EXCELLENT',

  -- 执行状态
  current_attempt INTEGER DEFAULT 0,
  optimization_history TEXT,  -- JSON: [{attempt, rating, score, suggestions}]

  -- 结果数据
  creative_id INTEGER,  -- 关联到 ad_creatives.id
  result TEXT,  -- JSON: 完整的创意生成结果
  error TEXT,   -- JSON: 错误详情

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);

-- Performance indexes
CREATE INDEX idx_creative_tasks_user_status ON creative_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_creative_tasks_status_created ON creative_tasks(status, created_at);
CREATE INDEX idx_creative_tasks_offer_id ON creative_tasks(offer_id);
CREATE INDEX idx_creative_tasks_updated ON creative_tasks(updated_at DESC);
