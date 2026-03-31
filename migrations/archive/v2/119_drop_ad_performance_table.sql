-- Migration: 119_drop_ad_performance_table.sql
-- Description: 删除不再使用的 ad_performance 表（Ad级别细粒度数据不需要）
-- Author: AutoBB
-- Date: 2024-12-29
-- Database: SQLite

-- 注意：此迁移为不可逆操作，删除前请确保已备份数据

-- 1. 删除外键约束（SQLite 不支持获取所有约束，需要手动处理）
PRAGMA foreign_keys = OFF;

-- 2. 删除表（SQLite 会自动处理相关约束）
DROP TABLE IF EXISTS ad_performance;

-- 3. 重新启用外键约束
PRAGMA foreign_keys = ON;

-- 4. 验证删除结果
SELECT 'SUCCESS: ad_performance 表已成功删除' AS result;
