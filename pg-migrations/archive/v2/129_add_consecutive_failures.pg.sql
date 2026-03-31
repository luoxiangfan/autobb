-- Migration: 129_add_consecutive_failures
-- Description: 为url_swap_tasks表添加连续失败跟踪字段
-- PostgreSQL版本
-- Date: 2025-01-03

-- 添加连续失败次数字段
ALTER TABLE url_swap_tasks
ADD COLUMN consecutive_failures INTEGER DEFAULT 0;

-- 验证字段添加成功
SELECT 'consecutive_failures字段添加成功' AS result;
