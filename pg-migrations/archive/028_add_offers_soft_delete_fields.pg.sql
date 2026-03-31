-- Migration: Add soft delete fields to offers table (PostgreSQL version)
-- Created: 2024-12-02
-- Description: Adds is_deleted and deleted_at columns for soft delete functionality

-- 添加 is_deleted 字段
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'is_deleted') THEN
        ALTER TABLE offers ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
        RAISE NOTICE '✅ 添加 is_deleted 字段';
    ELSE
        RAISE NOTICE '⏭️  is_deleted 字段已存在';
    END IF;
END $$;

-- 添加 deleted_at 字段
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'deleted_at') THEN
        ALTER TABLE offers ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;
        RAISE NOTICE '✅ 添加 deleted_at 字段';
    ELSE
        RAISE NOTICE '⏭️  deleted_at 字段已存在';
    END IF;
END $$;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_offers_deleted_at ON offers(deleted_at);

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('028_add_offers_soft_delete_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;
