-- Migration: 240_openclaw_affiliate_commission_raw_sync_payloads.pg.sql
-- Date: 2026-05-12
-- Description: 保存联盟佣金同步接口完整原始 JSON（按用户/日期/平台）

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_raw_sync_payloads (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  platform TEXT NOT NULL,
  source_api TEXT NOT NULL,
  page_no INTEGER NOT NULL DEFAULT 1,
  request_payload JSONB,
  response_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oacrsp_user_date_platform
  ON openclaw_affiliate_commission_raw_sync_payloads(user_id, report_date DESC, platform);

CREATE INDEX IF NOT EXISTS idx_oacrsp_user_date_source
  ON openclaw_affiliate_commission_raw_sync_payloads(user_id, report_date DESC, source_api);
