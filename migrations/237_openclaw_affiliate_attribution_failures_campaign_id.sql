-- Migration: 237_openclaw_affiliate_attribution_failures_campaign_id.sql
-- Date: 2026-05-09
-- Description: 为归因失败审计表增加 campaign_id，供 Dashboard/ROI 按 Campaign 聚合未归因佣金（与 PostgreSQL 对齐）

ALTER TABLE openclaw_affiliate_attribution_failures
  ADD COLUMN campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oc_aaf_user_campaign_date
  ON openclaw_affiliate_attribution_failures(user_id, campaign_id, report_date DESC)
  WHERE campaign_id IS NOT NULL;
