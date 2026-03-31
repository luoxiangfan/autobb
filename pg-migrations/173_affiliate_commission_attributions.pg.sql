-- Migration: 173_affiliate_commission_attributions.pg.sql
-- Date: 2026-02-09
-- Description: 新增联盟佣金归因表（按用户/日期关联到 Offer 和 Campaign）

CREATE TABLE IF NOT EXISTS affiliate_commission_attributions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  platform TEXT NOT NULL,
  source_order_id TEXT,
  source_mid TEXT,
  source_asin TEXT,
  offer_id BIGINT REFERENCES offers(id) ON DELETE SET NULL,
  campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL,
  commission_amount NUMERIC(14, 4) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aca_user_date
  ON affiliate_commission_attributions(user_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_aca_offer_date
  ON affiliate_commission_attributions(user_id, offer_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_aca_campaign_date
  ON affiliate_commission_attributions(user_id, campaign_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_aca_source
  ON affiliate_commission_attributions(user_id, platform, source_mid, source_asin, report_date DESC);
