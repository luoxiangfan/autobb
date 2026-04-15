-- Migration: Add is_manual column to sync_logs table
-- Purpose: Distinguish between manual and automatic sync triggers
-- Created: 2026-04-15

-- SQLite 迁移
-- ALTER TABLE sync_logs ADD COLUMN is_manual INTEGER DEFAULT 0;
-- UPDATE sync_logs SET is_manual = 0 WHERE is_manual IS NULL;

-- PostgreSQL 迁移
-- ALTER TABLE sync_logs ADD COLUMN is_manual BOOLEAN DEFAULT FALSE;
-- UPDATE sync_logs SET is_manual = FALSE WHERE is_manual IS NULL;

-- 说明：
-- is_manual = 0 (SQLite) / FALSE (PostgreSQL) : 自动触发（定时任务、队列任务）
-- is_manual = 1 (SQLite) / TRUE (PostgreSQL)  : 手动触发（用户点击按钮）

-- SQLite 执行语句
ALTER TABLE sync_logs ADD COLUMN is_manual INTEGER DEFAULT 0;

-- PostgreSQL 执行语句（在 pg-migrations 中创建对应文件）
-- ALTER TABLE sync_logs ADD COLUMN is_manual BOOLEAN DEFAULT FALSE;

-- 注释说明
COMMENT ON COLUMN sync_logs.is_manual IS '是否手动触发：0=自动（定时/队列），1=手动（用户点击）';
