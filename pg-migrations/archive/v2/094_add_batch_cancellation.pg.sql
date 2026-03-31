-- ===================================================
-- Migration: 094_add_batch_cancellation.pg.sql
-- Description: 为batch_tasks添加取消功能支持 (PostgreSQL)
-- Created: 2025-12-23
-- ===================================================

-- 🔥 问题背景：
-- 当代理质量差导致批量任务大量失败时，无法及时终止任务
-- 用户需要等待所有任务执行完毕才能重新上传

-- 🎯 解决方案：
-- 1. 添加'cancelled'状态支持
-- 2. 记录取消时间和取消原因
-- 3. 支持用户主动取消批量任务

-- Step 1: 添加新字段到batch_tasks
ALTER TABLE batch_tasks ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE batch_tasks ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE batch_tasks ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Step 2: 更新status约束以包含'cancelled'状态
-- 删除旧约束
ALTER TABLE batch_tasks DROP CONSTRAINT IF EXISTS batch_tasks_status_check;

-- 添加新约束
ALTER TABLE batch_tasks ADD CONSTRAINT batch_tasks_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'partial', 'cancelled'));

-- Step 3: 为upload_records添加cancelled状态支持
-- 删除旧约束
ALTER TABLE upload_records DROP CONSTRAINT IF EXISTS upload_records_status_check;

-- 添加新约束
ALTER TABLE upload_records ADD CONSTRAINT upload_records_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial', 'cancelled'));

-- ✅ Migration complete!
-- 用户现在可以通过 POST /api/offers/batch/[batchId]/cancel 取消批量任务
