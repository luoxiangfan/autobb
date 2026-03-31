-- Migration: 160_add_openclaw_enabled_to_users.pg.sql
-- Date: 2026-02-06
-- Description: 为 users 表增加 openclaw_enabled 字段，用于按用户控制 OpenClaw 功能访问

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS openclaw_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 管理员默认开启 OpenClaw
UPDATE users
SET openclaw_enabled = TRUE
WHERE role = 'admin';
