-- 修复时间戳列类型问题
-- 问题：PostgreSQL中 TEXT 类型的日期列无法与 TIMESTAMP WITH TIME ZONE 进行比较
-- 错误：operator does not exist: text >= timestamp with time zone
-- 影响：link_check_history.checked_at 列

-- 1. 修改 link_check_history 表的 checked_at 列类型从 TEXT 改为 TIMESTAMP WITH TIME ZONE
-- 使用 USING 子句将现有的 TEXT 格式转换为 TIMESTAMP
-- TEXT 格式应为 'YYYY-MM-DD HH24:MI:SS' 或 ISO 8601 格式

ALTER TABLE link_check_history
ALTER COLUMN checked_at TYPE TIMESTAMP WITH TIME ZONE
USING checked_at::TIMESTAMP WITH TIME ZONE;

-- 2. 确保 DEFAULT 值也是 TIMESTAMP WITH TIME ZONE 类型
ALTER TABLE link_check_history
ALTER COLUMN checked_at SET DEFAULT NOW();
