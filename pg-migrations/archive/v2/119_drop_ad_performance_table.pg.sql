-- Migration: 119_drop_ad_performance_table.pg.sql
-- Description: 删除不再使用的 ad_performance 表（Ad级别细粒度数据不需要）
-- Author: AutoBB
-- Date: 2024-12-29

-- 注意：此迁移为不可逆操作，删除前请确保已备份数据

-- 1. 检查表是否存在
SELECT '检查 ad_performance 表是否存在...' AS status;

-- 2. 如果表存在，先删除外键约束和主键约束
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- 获取并删除所有外键约束
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'ad_performance'::regclass
        AND contype = 'f'
    LOOP
        EXECUTE 'ALTER TABLE ad_performance DROP CONSTRAINT ' || quote_ident(constraint_name);
        RAISE NOTICE '已删除外键约束: %', constraint_name;
    END LOOP;

    -- 删除主键约束（这会自动删除相关的主键索引）
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'ad_performance'::regclass
        AND contype = 'p'
    LOOP
        EXECUTE 'ALTER TABLE ad_performance DROP CONSTRAINT ' || quote_ident(constraint_name);
        RAISE NOTICE '已删除主键约束: %', constraint_name;
    END LOOP;

    -- 删除所有其他约束（如唯一约束）
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'ad_performance'::regclass
        AND contype IN ('u', 'c')
    LOOP
        EXECUTE 'ALTER TABLE ad_performance DROP CONSTRAINT ' || quote_ident(constraint_name);
        RAISE NOTICE '已删除约束: %', constraint_name;
    END LOOP;
END $$;

-- 3. 删除表
SELECT '删除 ad_performance 表...' AS status;

DROP TABLE IF EXISTS ad_performance CASCADE;

-- 4. 验证删除结果
SELECT '验证: ad_performance 表已删除' AS status;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ad_performance'
    ) THEN
        RAISE EXCEPTION '表删除失败！';
    ELSE
        RAISE NOTICE 'SUCCESS: ad_performance 表已成功删除';
    END IF;
END $$;

-- 5. 记录迁移完成
SELECT '迁移 119 完成: ad_performance 表已删除' AS status;
