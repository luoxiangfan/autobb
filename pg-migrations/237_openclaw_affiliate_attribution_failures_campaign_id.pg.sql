-- Migration: 237_openclaw_affiliate_attribution_failures_campaign_id.pg.sql
-- Date: 2026-05-09
-- Description: 为归因失败审计表增加 campaign_id，修复 Dashboard Campaign 列表与 ROI 查询引用不存在的列

ALTER TABLE openclaw_affiliate_attribution_failures
  ADD COLUMN IF NOT EXISTS campaign_id BIGINT REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oc_aaf_user_campaign_date
  ON openclaw_affiliate_attribution_failures(user_id, campaign_id, report_date DESC)
  WHERE campaign_id IS NOT NULL;
