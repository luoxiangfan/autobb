-- Migration: 188_openclaw_affiliate_attribution_failures.pg.sql
-- Date: 2026-02-24
-- Description: 新增联盟佣金归因失败审计表（记录未归因原因码，支持每日对账告警）

CREATE TABLE IF NOT EXISTS openclaw_affiliate_attribution_failures (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  platform TEXT NOT NULL,
  source_order_id TEXT,
  source_mid TEXT,
  source_asin TEXT,
  source_link_id TEXT,
  offer_id BIGINT REFERENCES offers(id) ON DELETE SET NULL,
  commission_amount NUMERIC(14, 4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  reason_code TEXT NOT NULL,
  reason_detail TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oc_aaf_user_date
  ON openclaw_affiliate_attribution_failures(user_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_oc_aaf_user_reason_date
  ON openclaw_affiliate_attribution_failures(user_id, reason_code, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_oc_aaf_user_offer_date
  ON openclaw_affiliate_attribution_failures(user_id, offer_id, report_date DESC);
