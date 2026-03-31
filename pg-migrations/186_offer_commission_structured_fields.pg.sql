-- Migration 186: add structured commission fields to offers (PostgreSQL)
-- Purpose:
-- 1) Persist user intent explicitly: percent vs amount
-- 2) Keep legacy commission_payout as read/write compatibility layer
-- Note: no historical backfill in this migration

ALTER TABLE offers ADD COLUMN IF NOT EXISTS commission_type TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS commission_value TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS commission_currency TEXT;
