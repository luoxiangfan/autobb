-- 078_fix_boolean_columns.pg.sql
-- 修复 PostgreSQL 中应该是 BOOLEAN 但实际是 INTEGER 的列
-- 问题：某些表的 is_deleted, is_active 列可能从 SQLite 迁移时保留了 INTEGER 类型
-- 导致错误：operator does not exist: integer = boolean

-- 安全检查：只在列类型是 INTEGER 时才执行转换
-- 这样可以在已经是 BOOLEAN 的数据库上安全运行

-- 1. 修复 offers 表的 is_deleted 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offers' AND column_name = 'is_deleted'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE offers
        ALTER COLUMN is_deleted TYPE BOOLEAN
        USING (is_deleted = 1 OR is_deleted::text = 'true');

        ALTER TABLE offers
        ALTER COLUMN is_deleted SET DEFAULT FALSE;

        RAISE NOTICE 'offers.is_deleted 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'offers.is_deleted 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 2. 修复 offers 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offers' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE offers
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE offers
        ALTER COLUMN is_active SET DEFAULT TRUE;

        RAISE NOTICE 'offers.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'offers.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 3. 修复 campaigns 表的 is_deleted 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'campaigns' AND column_name = 'is_deleted'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE campaigns
        ALTER COLUMN is_deleted TYPE BOOLEAN
        USING (is_deleted = 1 OR is_deleted::text = 'true');

        ALTER TABLE campaigns
        ALTER COLUMN is_deleted SET DEFAULT FALSE;

        RAISE NOTICE 'campaigns.is_deleted 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'campaigns.is_deleted 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 4. 修复 campaigns 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'campaigns' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE campaigns
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE campaigns
        ALTER COLUMN is_active SET DEFAULT FALSE;

        RAISE NOTICE 'campaigns.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'campaigns.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 5. 修复 google_ads_accounts 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'google_ads_accounts' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE google_ads_accounts
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE google_ads_accounts
        ALTER COLUMN is_active SET DEFAULT TRUE;

        RAISE NOTICE 'google_ads_accounts.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'google_ads_accounts.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 6. 修复 prompt_versions 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'prompt_versions' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE prompt_versions
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE prompt_versions
        ALTER COLUMN is_active SET DEFAULT FALSE;

        RAISE NOTICE 'prompt_versions.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'prompt_versions.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 7. 修复 system_settings 表的布尔列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name = 'is_sensitive'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE system_settings
        ALTER COLUMN is_sensitive TYPE BOOLEAN
        USING (is_sensitive = 1 OR is_sensitive::text = 'true');

        ALTER TABLE system_settings
        ALTER COLUMN is_sensitive SET DEFAULT FALSE;

        RAISE NOTICE 'system_settings.is_sensitive 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'system_settings.is_sensitive 已经是 BOOLEAN 类型或不存在，跳过';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name = 'is_required'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE system_settings
        ALTER COLUMN is_required TYPE BOOLEAN
        USING (is_required = 1 OR is_required::text = 'true');

        ALTER TABLE system_settings
        ALTER COLUMN is_required SET DEFAULT FALSE;

        RAISE NOTICE 'system_settings.is_required 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'system_settings.is_required 已经是 BOOLEAN 类型或不存在，跳过';
    END IF;
END $$;

-- 验证转换结果
SELECT
    table_name,
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND column_name IN ('is_deleted', 'is_active', 'is_sensitive', 'is_required')
ORDER BY table_name, column_name;
