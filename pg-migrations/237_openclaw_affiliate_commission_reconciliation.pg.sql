-- Migration: 237_openclaw_affiliate_commission_reconciliation.pg.sql
-- Date: 2026-05-09
-- Description: 联盟佣金日维度对账快照（PostgreSQL）

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_reconciliation (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  platform TEXT NOT NULL,
  api_total NUMERIC(14, 4) NOT NULL DEFAULT 0,
  entries_sum NUMERIC(14, 4) NOT NULL DEFAULT 0,
  attributed_sum NUMERIC(14, 4) NOT NULL DEFAULT 0,
  failure_sum NUMERIC(14, 4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  delta_entries_vs_api NUMERIC(14, 4) NOT NULL DEFAULT 0,
  delta_pipeline NUMERIC(14, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, report_date, platform)
);

CREATE INDEX IF NOT EXISTS idx_oc_acr_user_date
  ON openclaw_affiliate_commission_reconciliation(user_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_oc_acr_user_platform_date
  ON openclaw_affiliate_commission_reconciliation(user_id, platform, report_date DESC);
