-- Migration: 125_fix_click_farm_tasks_foreign_key
-- Description: 修复 click_farm_tasks 表的外键约束问题
-- PostgreSQL版本
-- Date: 2024-12-30
--
-- 问题：click_farm_tasks 表定义了复合外键 (offer_id, user_id) REFERENCES offers(id, user_id)
-- 但 offers 表没有 (id, user_id) 的复合唯一索引，导致 "foreign key mismatch" 错误
--
-- 解决方案：删除现有的复合外键，创建只引用 offers(id) 的外键

-- Step 1: 删除现有的外键约束
DO $$
DECLARE
    fk_name TEXT;
BEGIN
    SELECT conname INTO fk_name
    FROM pg_constraint
    WHERE conrelid = 'click_farm_tasks'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[2, 3]::smallint[];  -- 🔧 修复：显式指定smallint[]类型

    IF fk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE click_farm_tasks DROP CONSTRAINT ' || fk_name;
        RAISE NOTICE 'Dropped foreign key constraint: %', fk_name;
    ELSE
        RAISE NOTICE 'No matching foreign key constraint found';
    END IF;
END $$;

-- Step 2: 创建新的外键约束（只引用 offers.id）
DO $$
DECLARE
    cons_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'click_farm_tasks'::regclass
        AND contype = 'f'
        AND conkey = ARRAY[3]::smallint[]  -- 🔧 修复：显式指定smallint[]类型
        AND confrelid = 'offers'::regclass
    ) INTO cons_exists;

    IF NOT cons_exists THEN
        ALTER TABLE click_farm_tasks
        ADD CONSTRAINT fk_click_farm_tasks_offer_id
        FOREIGN KEY (offer_id)
        REFERENCES offers(id)
        ON DELETE CASCADE;
        RAISE NOTICE 'Created new foreign key constraint: fk_click_farm_tasks_offer_id';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists';
    END IF;
END $$;

-- 验证外键约束
SELECT
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    a.attname AS column_name,
    confrelid::regclass AS referenced_table,
    pf.attname AS referenced_column
FROM pg_constraint
JOIN pg_attribute a ON a.attrelid = pg_constraint.conrelid AND a.attnum = ANY(pg_constraint.conkey)
JOIN pg_attribute pf ON pf.attrelid = pg_constraint.confrelid AND pf.attnum = ANY(pg_constraint.confkey)
WHERE pg_constraint.conrelid = 'click_farm_tasks'::regclass
AND pg_constraint.contype = 'f';
