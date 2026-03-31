-- Migration: 143_url_swap_tasks_manual_suffix_mode.pg.sql
-- Description: url_swap_tasks支持手动轮询Final URL suffix（方式二）
-- Date: 2026-01-21
-- Database: PostgreSQL

-- 方式字段：auto=自动解析推广链接；manual=用户配置suffix列表轮询
ALTER TABLE url_swap_tasks
  ADD COLUMN IF NOT EXISTS swap_mode TEXT NOT NULL DEFAULT 'auto';

-- 手动模式：用户配置的Final URL suffix列表（JSON数组，字符串不含?）
ALTER TABLE url_swap_tasks
  ADD COLUMN IF NOT EXISTS manual_final_url_suffixes JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 手动模式：轮询游标（下一次要使用的suffix索引）
ALTER TABLE url_swap_tasks
  ADD COLUMN IF NOT EXISTS manual_suffix_cursor INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN url_swap_tasks.swap_mode IS '换链方式：auto=自动解析推广链接；manual=用户配置suffix列表轮询';
COMMENT ON COLUMN url_swap_tasks.manual_final_url_suffixes IS '手动模式下的Final URL suffix列表（JSON数组，字符串不含?）';
COMMENT ON COLUMN url_swap_tasks.manual_suffix_cursor IS '手动模式轮询游标（下一次要使用的suffix索引）';

