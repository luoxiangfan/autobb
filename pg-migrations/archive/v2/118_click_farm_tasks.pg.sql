-- Migration: 118_click_farm_tasks
-- Description: 创建补点击任务表（Click Farm Tasks），支持未来日期开始任务
-- PostgreSQL版本
-- Author: Claude
-- Date: 2024-12-28
--
-- ==============================================================================
-- SQLite vs PostgreSQL 语法差异对照：
-- ==============================================================================
-- | 特性          | SQLite                          | PostgreSQL                    |
-- |--------------|---------------------------------|-------------------------------|
-- | ID生成       | TEXT DEFAULT (lower(hex(...)))  | UUID PRIMARY KEY DEFAULT ...  |
-- | 布尔类型     | INTEGER (0/1)                   | BOOLEAN                       |
-- | 时间戳       | TEXT                            | TIMESTAMP                     |
-- | JSON存储     | TEXT                            | JSONB                         |
-- | 默认时间函数 | datetime('now')                 | NOW() / CURRENT_DATE          |
-- | 日期函数     | DATE('now')                     | CURRENT_DATE                  |
-- | 外键约束     | 行内定义                         | CONSTRAINT ... FOREIGN KEY    |
-- ==============================================================================

-- 补点击任务表
CREATE TABLE IF NOT EXISTS click_farm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 任务配置
  daily_click_count INTEGER NOT NULL DEFAULT 216,
  start_time TEXT NOT NULL DEFAULT '06:00',  -- 存储为TEXT格式 HH:mm，因为支持'24:00'这样的特殊值
  end_time TEXT NOT NULL DEFAULT '24:00',    -- TEXT格式支持'24:00'特殊值（表示午夜）
  duration_days INTEGER NOT NULL DEFAULT 7,  -- -1表示无限期
  hourly_distribution JSONB NOT NULL,  -- 24个整数的JSON数组

  -- 🆕 计划开始日期（DATE类型，相对于任务时区的本地日期）
  -- 例如：timezone = "America/New_York"，scheduled_start_date = '2024-12-30'
  -- 表示任务在纽约时间 2024-12-30 的 start_time 时刻开始执行
  scheduled_start_date DATE DEFAULT CURRENT_DATE,

  -- 状态管理
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/running/paused/stopped/completed
  pause_reason TEXT,  -- no_proxy / manual / offer_deleted / null
  pause_message TEXT,
  paused_at TIMESTAMP,

  -- 实时统计
  progress INTEGER DEFAULT 0,  -- 完成百分比
  total_clicks INTEGER DEFAULT 0,
  success_clicks INTEGER DEFAULT 0,
  failed_clicks INTEGER DEFAULT 0,

  -- 历史数据（JSONB数组，任务删除后仍可用于累计统计）
  daily_history JSONB DEFAULT '[]'::jsonb,
  -- 🆕 每日历史记录示例（含hourly_breakdown用于追踪每小时的执行分布）
  -- [
  --   {
  --     "date": "2024-01-15",
  --     "target": 216,
  --     "actual": 210,
  --     "success": 205,
  --     "failed": 5,
  --     "hourly_breakdown": [
  --       {"target": 10, "actual": 10, "success": 10, "failed": 0},
  --       {"target": 15, "actual": 14, "success": 14, "failed": 0},
  --       ...  -- 24个小时
  --     ]
  --   }
  -- ]

  -- 时区配置
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  -- ⚠️ 时区说明：所有时间相关字段都相对于这个时区：
  -- - start_time/end_time: 该时区的本地时间
  -- - scheduled_start_date: 该时区的本地日期
  -- - hourly_distribution[i]: 该时区第i个小时的点击数
  -- - started_at: 当Cron在该时区达到scheduled_start_date时设置

  -- 软删除
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP,

  -- 时间戳
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- 外键约束
  CONSTRAINT fk_click_farm_offer
    FOREIGN KEY (offer_id)
    REFERENCES offers(id)
    ON DELETE CASCADE
);

-- 索引：用户+状态查询
CREATE INDEX IF NOT EXISTS idx_cft_user_status
  ON click_farm_tasks(user_id, status);

-- 索引：运行中任务的下次执行时间
CREATE INDEX IF NOT EXISTS idx_cft_next_run
  ON click_farm_tasks(next_run_at)
  WHERE status = 'running';

-- 索引：用户任务按创建时间排序
CREATE INDEX IF NOT EXISTS idx_cft_created
  ON click_farm_tasks(user_id, created_at DESC);

-- 索引：Offer关联查询
CREATE INDEX IF NOT EXISTS idx_cft_offer
  ON click_farm_tasks(offer_id);

-- 🆕 索引：计划开始日期+状态（优化Cron调度器查询）
CREATE INDEX IF NOT EXISTS idx_cft_scheduled_start
  ON click_farm_tasks(scheduled_start_date, status);

-- 🆕 索引：任务时区（用于时区相关的日期计算）
CREATE INDEX IF NOT EXISTS idx_cft_timezone
  ON click_farm_tasks(timezone);

-- 🆕 索引：JSONB字段索引（用于daily_history查询优化）
CREATE INDEX IF NOT EXISTS idx_cft_daily_history
  ON click_farm_tasks USING GIN (daily_history);
