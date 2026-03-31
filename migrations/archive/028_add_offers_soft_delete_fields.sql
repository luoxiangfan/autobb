-- Migration: Add soft delete fields to offers table
-- Created: 2024-12-02
-- Description: Adds is_deleted and deleted_at columns for soft delete functionality

-- PostgreSQL version
-- ALTER TABLE offers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
-- ALTER TABLE offers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP DEFAULT NULL;
-- CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted);
-- CREATE INDEX IF NOT EXISTS idx_offers_deleted_at ON offers(deleted_at);

-- SQLite version (SQLite doesn't support IF NOT EXISTS for ALTER TABLE)
-- Run these manually or handle in application code:
-- ALTER TABLE offers ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE offers ADD COLUMN deleted_at TEXT DEFAULT NULL;
-- CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted);
-- CREATE INDEX IF NOT EXISTS idx_offers_deleted_at ON offers(deleted_at);

-- Unified migration script (handles both PostgreSQL and SQLite)
-- The application should detect database type and run appropriate statements

-- For PostgreSQL:
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'is_deleted') THEN
        ALTER TABLE offers ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'deleted_at') THEN
        ALTER TABLE offers ADD COLUMN deleted_at TIMESTAMP DEFAULT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_offers_deleted_at ON offers(deleted_at);
