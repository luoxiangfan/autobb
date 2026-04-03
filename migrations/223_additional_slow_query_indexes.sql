-- Migration: 223_additional_slow_query_indexes.sql
-- Date: 2026-04-02
-- Description: 为已识别的其他高耗时业务查询补充索引（评分调度、归因品牌回填、全局关键词检索）

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_asin_brand_nonnull
  ON affiliate_products(user_id, asin, brand)
  WHERE asin IS NOT NULL
    AND brand IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_affiliate_products_due_score_scheduler_user
  ON affiliate_products(user_id)
  WHERE recommendation_score IS NULL
    OR score_calculated_at IS NULL
    OR (
      last_synced_at IS NOT NULL
      AND datetime(score_calculated_at) < datetime(last_synced_at)
    )
    OR (
      NULLIF(TRIM(COALESCE(asin, '')), '') IS NOT NULL
      AND TRIM(COALESCE(product_url, '')) = ''
      AND COALESCE(recommendation_reasons, '') LIKE '%非Amazon落地页,信任度相对较低%'
    );

CREATE INDEX IF NOT EXISTS idx_global_keywords_country_language_search_volume
  ON global_keywords(country, language, search_volume DESC);

CREATE INDEX IF NOT EXISTS idx_global_keywords_lower_keyword
  ON global_keywords(LOWER(keyword));
