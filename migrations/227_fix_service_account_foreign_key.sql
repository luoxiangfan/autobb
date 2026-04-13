-- 修复 google_ads_accounts 服务账号外键约束
-- 添加 ON DELETE CASCADE，删除服务账号时自动清理关联账户

-- no-op for SQLite

-- SQLite (SQLite 不支持修改外键约束，需要重建表)
-- 注意：SQLite 的外键约束在表创建时定义，无法动态修改
-- 如果需要支持 SQLite，需要手动处理删除逻辑
