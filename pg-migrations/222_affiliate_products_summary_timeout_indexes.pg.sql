-- Migration: 222_affiliate_products_summary_timeout_indexes.pg.sql
-- Date: 2026-04-02
-- Description: 为 /api/products/summary 关键聚合查询补充索引，避免大用户触发 statement timeout

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_platform_asin_summary
  ON affiliate_products(user_id, platform, asin);

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_score_recent_effective
  ON affiliate_products(user_id, score_calculated_at DESC)
  WHERE recommendation_score IS NOT NULL
    AND recommendation_score >= 1
    AND score_calculated_at IS NOT NULL;
