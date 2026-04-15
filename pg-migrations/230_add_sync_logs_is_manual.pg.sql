-- Migration: Add is_manual column to sync_logs table (PostgreSQL)
-- Purpose: Distinguish between manual and automatic sync triggers
-- Created: 2026-04-15

ALTER TABLE sync_logs ADD COLUMN is_manual BOOLEAN DEFAULT FALSE;

-- 更新现有记录为自动触发
UPDATE sync_logs SET is_manual = FALSE WHERE is_manual IS NULL;

-- 添加注释
COMMENT ON COLUMN sync_logs.is_manual IS '是否手动触发：FALSE=自动（定时/队列），TRUE=手动（用户点击）';

-- 创建索引（可选，用于加速查询）
CREATE INDEX IF NOT EXISTS idx_sync_logs_is_manual ON sync_logs(is_manual);
CREATE INDEX IF NOT EXISTS idx_sync_logs_is_manual_started_at ON sync_logs(is_manual, started_at DESC);
