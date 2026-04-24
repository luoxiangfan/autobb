-- Migration: Add offer unlinked fields for tracking disassociation from Google Ads accounts
-- Purpose: Track when offers are unlinked from Google Ads accounts (customerId)
-- Created: 2026-04-22

-- SQLite 迁移
ALTER TABLE offers ADD COLUMN unlinked_from_customer_ids TEXT;  -- 已解除关联的 Google Ads customer_id 列表 (JSON 数组)
ALTER TABLE offers ADD COLUMN last_unlinked_at TEXT;  -- 最近一次解除关联的时间(ISO 8601 timestamp)

-- 添加索引加速查询
CREATE INDEX IF NOT EXISTS idx_offers_last_unlinked_at ON offers(last_unlinked_at);
