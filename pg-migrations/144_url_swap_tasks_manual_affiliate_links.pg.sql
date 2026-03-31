-- Migration: 144_url_swap_tasks_manual_affiliate_links.pg.sql
-- Description: url_swap_tasks新增推广链接列表字段（方式二）
-- Date: 2026-01-22
-- Database: PostgreSQL

-- 手动模式：推广链接列表（JSON数组，完整URL）
ALTER TABLE url_swap_tasks
  ADD COLUMN IF NOT EXISTS manual_affiliate_links JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN url_swap_tasks.manual_affiliate_links IS '手动模式下的推广链接列表（JSON数组，完整URL）';

-- 兼容历史数据：将旧字段内容拷贝到新字段（不做格式校验）
UPDATE url_swap_tasks
SET manual_affiliate_links = manual_final_url_suffixes
WHERE (manual_affiliate_links IS NULL OR manual_affiliate_links = '[]'::jsonb)
  AND manual_final_url_suffixes IS NOT NULL;
