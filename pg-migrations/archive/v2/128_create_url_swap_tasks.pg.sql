-- Migration: 128_create_url_swap_tasks
-- Description: 创建换链接任务表（URL Swap Task System）
-- PostgreSQL版本
-- Date: 2025-01-03
--
-- 换链接任务系统：自动监测和更新Google Ads广告链接
-- 当Offer的推广链接发生变化时，系统能够自动检测并更新广告系列的Final URL Suffix

-- Step 1: 创建换链接任务表
CREATE TABLE IF NOT EXISTS url_swap_tasks (
  -- === 基础信息 ===
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  swap_history JSONB DEFAULT '[]'::jsonb,  -- JSON数组，记录每次换链结果

  -- === 状态管理 ===
  -- 状态：enabled(已启用)/disabled(已禁用)/error(错误)/completed(已完成)
  status TEXT NOT NULL DEFAULT 'enabled',
  error_message TEXT,
  error_at TIMESTAMP WITH TIME ZONE,

  -- === 调度时间（简单UTC时间） ===
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  next_swap_at TIMESTAMP WITH TIME ZONE,    -- 下次执行时间（UTC时间）

  -- === 软删除 ===
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- === 时间戳 ===
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- === 外键约束 ===
  CONSTRAINT fk_url_swap_offer
    FOREIGN KEY (offer_id)
    REFERENCES offers(id)
    ON DELETE CASCADE,

  -- === 唯一约束 ===
  CONSTRAINT uq_url_swap_offer UNIQUE (offer_id)
);

-- Step 2: 创建索引

-- 用户+状态查询（用户查看自己的任务列表）
CREATE INDEX IF NOT EXISTS idx_url_swap_user_status
  ON url_swap_tasks(user_id, status);

-- 调度查询（优化Cron调度器）
-- PostgreSQL partial index
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

-- JSONB索引（用于swap_history查询）
CREATE INDEX IF NOT EXISTS idx_url_swap_history_jsonb
  ON url_swap_tasks USING GIN (swap_history);

-- Step 3: 添加表注释
COMMENT ON TABLE url_swap_tasks IS '换链接任务表 - 自动监测和更新Google Ads广告链接';
COMMENT ON COLUMN url_swap_tasks.id IS '任务唯一标识（UUID）';
COMMENT ON COLUMN url_swap_tasks.user_id IS '用户ID（数据隔离）';
COMMENT ON COLUMN url_swap_tasks.offer_id IS '关联的Offer ID';
COMMENT ON COLUMN url_swap_tasks.swap_interval_minutes IS '换链间隔（分钟）';
COMMENT ON COLUMN url_swap_tasks.enabled IS '是否启用';
COMMENT ON COLUMN url_swap_tasks.duration_days IS '任务持续天数（-1表示无限期）';
COMMENT ON COLUMN url_swap_tasks.google_customer_id IS 'Google Ads Customer ID';
COMMENT ON COLUMN url_swap_tasks.google_campaign_id IS 'Google Ads Campaign ID';
COMMENT ON COLUMN url_swap_tasks.current_final_url IS '当前Final URL（不含查询参数）';
COMMENT ON COLUMN url_swap_tasks.current_final_url_suffix IS '当前Final URL Suffix（查询参数部分）';
COMMENT ON COLUMN url_swap_tasks.status IS '任务状态：enabled/disabled/error/completed';
COMMENT ON COLUMN url_swap_tasks.swap_history IS '换链历史记录（JSON数组）';
COMMENT ON COLUMN url_swap_tasks.next_swap_at IS '下次执行时间（UTC）';

-- Step 4: 创建更新updated_at的触发器
CREATE OR REPLACE FUNCTION update_url_swap_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_url_swap_tasks_updated ON url_swap_tasks;
CREATE TRIGGER trigger_url_swap_tasks_updated
  BEFORE UPDATE ON url_swap_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_url_swap_tasks_timestamp();

-- Step 5: 验证
DO $$
BEGIN
  RAISE NOTICE 'URL Swap Tasks表创建成功';
  RAISE NOTICE '索引创建完成';
  RAISE NOTICE '更新时间戳触发器创建完成';
END $$;
