-- SQLite 不需要修改 - TEXT 类型可以正常使用 datetime() 函数处理日期比较
-- 此迁移文件仅用于保持与 PostgreSQL 迁移编号同步

-- SQLite 使用 TEXT 存储 ISO 8601 格式日期，下面的查询在 SQLite 中正常工作：
-- WHERE lch.checked_at >= datetime('now', '-24 hours')

-- PostgreSQL 需要迁移到 TIMESTAMP WITH TIME ZONE 类型
-- 请运行 pg-migrations/104_fix_timestamp_columns.pg.sql
