-- Migration: 240_openclaw_affiliate_commission_raw_sync_payloads.sql
-- Date: 2026-05-12
-- Description: 保存联盟佣金同步接口完整原始 JSON（按用户/日期/平台）

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_raw_sync_payloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_api TEXT NOT NULL,
  page_no INTEGER NOT NULL DEFAULT 1,
  request_payload TEXT,
  response_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oacrsp_user_date_platform
  ON openclaw_affiliate_commission_raw_sync_payloads(user_id, report_date DESC, platform);

CREATE INDEX IF NOT EXISTS idx_oacrsp_user_date_source
  ON openclaw_affiliate_commission_raw_sync_payloads(user_id, report_date DESC, source_api);
