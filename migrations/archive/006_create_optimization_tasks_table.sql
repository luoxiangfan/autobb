-- 006_create_optimization_tasks_table.sql
-- 创建优化任务表，用于每周优化清单

CREATE TABLE IF NOT EXISTS optimization_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,

  -- 任务信息
  task_type TEXT NOT NULL CHECK (task_type IN (
    'pause_campaign',
    'increase_budget',
    'decrease_budget',
    'optimize_creative',
    'adjust_keywords',
    'lower_cpc',
    'improve_landing_page',
    'expand_targeting'
  )),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),

  -- 问题描述
  reason TEXT NOT NULL,
  action TEXT NOT NULL,
  expected_impact TEXT,

  -- 相关数据快照（JSON格式）
  metrics_snapshot TEXT NOT NULL, -- 生成任务时的Campaign指标

  -- 任务状态
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed')),

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  dismissed_at TEXT,

  -- 完成备注
  completion_note TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_optimization_tasks_user_status
ON optimization_tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_optimization_tasks_campaign
ON optimization_tasks(campaign_id);

CREATE INDEX IF NOT EXISTS idx_optimization_tasks_created
ON optimization_tasks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_optimization_tasks_priority
ON optimization_tasks(user_id, priority, status);
