-- 038_fix_optimization_tasks_schema.sql
-- 修复optimization_tasks表schema与代码不匹配的问题
-- 问题：初始schema与006_create_optimization_tasks_table.sql定义不一致

-- 由于表内无数据，直接重建表

-- Step 1: 删除旧表
DROP TABLE IF EXISTS optimization_tasks;

-- Step 2: 重建表（与006迁移定义一致）
CREATE TABLE optimization_tasks (
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
  metrics_snapshot TEXT NOT NULL,

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

-- Step 3: 重建索引
CREATE INDEX IF NOT EXISTS idx_optimization_tasks_user_status
ON optimization_tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_optimization_tasks_campaign
ON optimization_tasks(campaign_id);

CREATE INDEX IF NOT EXISTS idx_optimization_tasks_created
ON optimization_tasks(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_optimization_tasks_priority
ON optimization_tasks(user_id, priority, status);
