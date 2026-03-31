-- Migration: 129_add_consecutive_failures
-- Description: 为url_swap_tasks表添加连续失败跟踪字段
-- SQLite版本
-- Date: 2025-01-03

-- 添加连续失败次数字段
-- 用于实现"连续N个时间间隔失败后自动暂停"策略
ALTER TABLE url_swap_tasks
ADD COLUMN consecutive_failures INTEGER DEFAULT 0;

-- 验证字段添加成功
SELECT 'consecutive_failures字段添加成功' AS result;
SELECT name, type, "notnull", dflt_value
FROM pragma_table_info('url_swap_tasks')
WHERE name = 'consecutive_failures';
