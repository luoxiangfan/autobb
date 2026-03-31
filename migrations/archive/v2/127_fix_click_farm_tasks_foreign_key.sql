-- Migration: 127_fix_click_farm_tasks_foreign_key
-- Description: 修复 click_farm_tasks 表的外键约束问题
-- SQLite版本
-- Date: 2024-12-30
--
-- 问题：click_farm_tasks 表定义了复合外键 (offer_id, user_id) REFERENCES offers(id, user_id)
-- 但 offers 表没有 (id, user_id) 的复合唯一索引，导致 "foreign key mismatch" 错误
--
-- 解决方案：删除现有的复合外键，创建只引用 offers(id) 的外键

-- Step 1: 开启外键检查（需要先禁用再启用才能修改外键）
PRAGMA foreign_keys = OFF;

-- Step 2: 备份数据到临时表
CREATE TABLE IF NOT EXISTS click_farm_tasks_backup AS SELECT * FROM click_farm_tasks;

-- Step 3: 删除旧表
DROP TABLE IF EXISTS click_farm_tasks;

-- Step 4: 创建新表（只引用 offers.id）
CREATE TABLE IF NOT EXISTS click_farm_tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  daily_click_count INTEGER NOT NULL DEFAULT 216,
  start_time TEXT NOT NULL DEFAULT '06:00',
  end_time TEXT NOT NULL DEFAULT '24:00',
  duration_days INTEGER NOT NULL DEFAULT 7,
  hourly_distribution TEXT NOT NULL,

  scheduled_start_date TEXT DEFAULT (DATE('now')),

  status TEXT NOT NULL DEFAULT 'pending',
  pause_reason TEXT,
  pause_message TEXT,
  paused_at TEXT,

  progress INTEGER DEFAULT 0,
  total_clicks INTEGER DEFAULT 0,
  success_clicks INTEGER DEFAULT 0,
  failed_clicks INTEGER DEFAULT 0,

  daily_history TEXT DEFAULT '[]',

  timezone TEXT NOT NULL DEFAULT 'America/New_York',

  is_deleted INTEGER DEFAULT 0,
  deleted_at TEXT,

  started_at TEXT,
  completed_at TEXT,
  next_run_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  referer_config TEXT DEFAULT NULL,

  -- 只引用 offers(id)，移除复合外键
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- Step 5: 恢复数据（显式列出所有列，不包含 referer_config）
INSERT INTO click_farm_tasks (
  id, user_id, offer_id, daily_click_count, start_time, end_time,
  duration_days, hourly_distribution, scheduled_start_date, status,
  pause_reason, pause_message, paused_at, progress, total_clicks,
  success_clicks, failed_clicks, daily_history, timezone, is_deleted,
  deleted_at, started_at, completed_at, next_run_at, created_at,
  updated_at
)
SELECT
  id, user_id, offer_id, daily_click_count, start_time, end_time,
  duration_days, hourly_distribution, scheduled_start_date, status,
  pause_reason, pause_message, paused_at, progress, total_clicks,
  success_clicks, failed_clicks, daily_history, timezone, is_deleted,
  deleted_at, started_at, completed_at, next_run_at, created_at,
  updated_at
FROM click_farm_tasks_backup;

-- Step 6: 删除备份表
DROP TABLE IF EXISTS click_farm_tasks_backup;

-- Step 7: 重新创建索引
CREATE INDEX IF NOT EXISTS idx_cft_user_status
  ON click_farm_tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_cft_next_run
  ON click_farm_tasks(next_run_at)
  WHERE status = 'running';

CREATE INDEX IF NOT EXISTS idx_cft_created
  ON click_farm_tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cft_offer
  ON click_farm_tasks(offer_id);

CREATE INDEX IF NOT EXISTS idx_cft_scheduled_start
  ON click_farm_tasks(scheduled_start_date, status);

CREATE INDEX IF NOT EXISTS idx_cft_timezone
  ON click_farm_tasks(timezone);

CREATE INDEX IF NOT EXISTS idx_click_farm_tasks_referer_config
  ON click_farm_tasks(referer_config);

-- Step 8: 恢复外键检查
PRAGMA foreign_keys = ON;

-- 验证外键约束
SELECT '外键约束验证:' AS info;
PRAGMA foreign_key_list(click_farm_tasks);
