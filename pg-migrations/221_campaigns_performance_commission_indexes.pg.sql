-- Migration: 221_campaigns_performance_commission_indexes.pg.sql
-- Date: 2026-04-02
-- Description: 为 campaigns/performance 及相关佣金汇总查询补充复合索引

CREATE INDEX IF NOT EXISTS idx_cp_user_report_currency_campaign_metrics
  ON campaign_performance(user_id, date DESC, currency, campaign_id, impressions, clicks, cost);

CREATE INDEX IF NOT EXISTS idx_aca_user_report_currency_campaign_amount
  ON affiliate_commission_attributions(user_id, report_date DESC, currency, campaign_id, commission_amount);

CREATE INDEX IF NOT EXISTS idx_aca_user_platform_report_asin
  ON affiliate_commission_attributions(user_id, platform, report_date DESC, source_asin);

CREATE INDEX IF NOT EXISTS idx_oc_aaf_user_report_currency_amount
  ON openclaw_affiliate_attribution_failures(user_id, report_date DESC, currency, commission_amount);

CREATE INDEX IF NOT EXISTS idx_oc_aaf_user_platform_report_asin
  ON openclaw_affiliate_attribution_failures(user_id, platform, report_date DESC, source_asin);
