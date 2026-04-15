-- Migration: Add is_manual column to sync_logs table
-- Purpose: Distinguish between manual and automatic sync triggers
-- Created: 2026-04-15

-- 说明：
-- is_manual = 0 (SQLite) / FALSE (PostgreSQL) : 自动触发（定时任务、队列任务）
-- is_manual = 1 (SQLite) / TRUE (PostgreSQL)  : 手动触发（用户点击按钮）

-- SQLite 执行语句
ALTER TABLE sync_logs ADD COLUMN is_manual INTEGER DEFAULT 0; -- 是否手动触发：0=自动（定时/队列），1=手动（用户点击）
