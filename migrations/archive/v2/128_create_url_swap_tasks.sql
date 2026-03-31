-- Migration: 128_create_url_swap_tasks
-- Description: 创建换链接任务表（URL Swap Task System）
-- SQLite版本
-- Date: 2025-01-03
--
-- 换链接任务系统：自动监测和更新Google Ads广告链接
-- 当Offer的推广链接发生变化时，系统能够自动检测并更新广告系列的Final URL Suffix

-- Step 1: 开启外键检查
PRAGMA foreign_keys = ON;

-- Step 2: 创建换链接任务表
CREATE TABLE IF NOT EXISTS url_swap_tasks (
  -- === 基础信息 ===
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- === 任务配置 ===
  swap_interval_minutes INTEGER NOT NULL DEFAULT 5,  -- 换链间隔（分钟）：5, 10, 30, 60, 120, 240, 480, 1440
  enabled BOOLEAN DEFAULT TRUE,             -- 是否启用
  duration_days INTEGER NOT NULL DEFAULT 7, -- 持续天数：-1表示无限期

  -- === Google Ads关联 ===
  google_customer_id TEXT,
  google_campaign_id TEXT,

  -- === 当前生效的URL ===
  current_final_url TEXT,
  current_final_url_suffix TEXT,

  -- === 实时统计 ===
  progress INTEGER DEFAULT 0,               -- 完成百分比（0-100）
  total_swaps INTEGER DEFAULT 0,            -- 总执行次数
  success_swaps INTEGER DEFAULT 0,          -- 成功次数
  failed_swaps INTEGER DEFAULT 0,           -- 失败次数
  url_changed_count INTEGER DEFAULT 0,      -- URL实际变化次数

  -- === 历史数据（简化版） ===
  swap_history TEXT DEFAULT '[]',          -- JSON数组，记录每次换链结果

  -- === 状态管理 ===
  -- 状态：enabled(已启用)/disabled(已禁用)/error(错误)/completed(已完成)
  status TEXT NOT NULL DEFAULT 'enabled',
  error_message TEXT,
  error_at TEXT,

  -- === 调度时间（简单UTC时间） ===
  started_at TEXT,
  completed_at TEXT,
  next_swap_at TEXT,                        -- 下次执行时间（UTC时间）

  -- === 软删除 ===
  is_deleted INTEGER DEFAULT 0,
  deleted_at TEXT,

  -- === 时间戳 ===
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  -- === 外键约束 ===
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,

  -- === 唯一约束 ===
  CONSTRAINT uq_url_swap_offer UNIQUE (offer_id)
);

-- Step 3: 创建索引

-- 用户+状态查询（用户查看自己的任务列表）
CREATE INDEX IF NOT EXISTS idx_url_swap_user_status
  ON url_swap_tasks(user_id, status);

-- 调度查询（优化Cron调度器）
-- 查询条件：WHERE status = 'enabled' AND next_swap_at <= datetime('now') AND started_at <= datetime('now')
CREATE INDEX IF NOT EXISTS idx_url_swap_scheduled
  ON url_swap_tasks(next_swap_at, started_at)
  WHERE status = 'enabled';

-- 用户任务按创建时间排序
CREATE INDEX IF NOT EXISTS idx_url_swap_created
  ON url_swap_tasks(user_id, created_at DESC);

-- Offer关联查询
CREATE INDEX IF NOT EXISTS idx_url_swap_offer
  ON url_swap_tasks(offer_id);

-- 统计查询：按状态分组
CREATE INDEX IF NOT EXISTS idx_url_swap_status
  ON url_swap_tasks(status);

-- Step 4: 验证表结构
SELECT 'url_swap_tasks表创建成功' AS result;
SELECT name, type, "notnull", dflt_value
FROM pragma_table_info('url_swap_tasks')
WHERE name IN ('id', 'user_id', 'offer_id', 'swap_interval_minutes', 'enabled',
               'duration_days', 'status', 'next_swap_at', 'created_at');

-- Step 5: 验证索引
SELECT '索引创建成功' AS result;
SELECT name, tbl_name
FROM sqlite_master
WHERE type = 'index'
AND tbl_name = 'url_swap_tasks';
