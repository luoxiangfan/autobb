-- Migration: Remove risk_type field from risk_alerts table (PostgreSQL)
-- Date: 2026-01-06
-- Description: risk_type 和 alert_type 是重复字段，删除 risk_type 简化数据结构

DO $$
BEGIN
    -- 检查 risk_type 是否存在
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_alerts' AND column_name = 'risk_type') THEN
        -- 删除外键约束（如果有）
        ALTER TABLE risk_alerts DROP CONSTRAINT IF EXISTS risk_alerts_risk_type_fkey;

        -- 删除 risk_type 字段
        ALTER TABLE risk_alerts DROP COLUMN risk_type;

        RAISE NOTICE 'risk_type column removed from risk_alerts table';
    ELSE
        RAISE NOTICE 'risk_type column does not exist, skipping';
    END IF;
END $$;

-- 清理可能存在的孤立索引
DROP INDEX IF EXISTS idx_risk_alerts_risk_type;
