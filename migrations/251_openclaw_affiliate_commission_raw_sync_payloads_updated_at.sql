-- Migration: 251_openclaw_affiliate_commission_raw_sync_payloads_updated_at.sql
-- Description: 联盟佣金原始同步 payload 表增加更新时间

ALTER TABLE openclaw_affiliate_commission_raw_sync_payloads
  ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));

UPDATE openclaw_affiliate_commission_raw_sync_payloads
  SET updated_at = created_at;
