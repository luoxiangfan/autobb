-- Migration: 160_add_openclaw_enabled_to_users.sql
-- Date: 2026-02-06
-- Description: 为 users 表增加 openclaw_enabled 字段，用于按用户控制 OpenClaw 功能访问
-- Note: SQLite 不支持 IF NOT EXISTS，重复执行会触发 duplicate column，迁移框架会自动忽略

ALTER TABLE users
  ADD COLUMN openclaw_enabled INTEGER NOT NULL DEFAULT 0;

-- 管理员默认开启 OpenClaw
UPDATE users
SET openclaw_enabled = 1
WHERE role = 'admin';
