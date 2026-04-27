-- Migration: Add offer unlinked fields for tracking disassociation from Google Ads accounts (PostgreSQL)
-- Purpose: Track when offers are unlinked from Google Ads accounts (customerId)
-- Created: 2026-04-22

-- PostgreSQL 迁移
ALTER TABLE offers ADD COLUMN IF NOT EXISTS unlinked_from_customer_ids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS last_unlinked_at TIMESTAMP;

-- 添加索引加速查询
CREATE INDEX IF NOT EXISTS idx_offers_last_unlinked_at ON offers(last_unlinked_at);
CREATE INDEX IF NOT EXISTS idx_offers_unlinked_from_customer_ids ON offers USING GIN (unlinked_from_customer_ids);

-- 添加注释说明
COMMENT ON COLUMN offers.unlinked_from_customer_ids IS '已解除关联的 Google Ads customer_id 列表 (JSONB 数组)';
COMMENT ON COLUMN offers.last_unlinked_at IS '最近一次解除关联的时间';
