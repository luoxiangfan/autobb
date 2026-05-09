-- Migration: 238_backfill_openclaw_affiliate_attribution_failures_campaign_id.pg.sql
-- Date: 2026-05-09
-- Description: 回填 openclaw_affiliate_attribution_failures.campaign_id（在能唯一定位到本地 campaigns 时）

-- 1) 已有 offer_id：为该用户下该 offer 选一个未删除的 campaign（ENABLED > PAUSED > 其它，同 id 决胜）
UPDATE openclaw_affiliate_attribution_failures f
SET campaign_id = picked.campaign_id
FROM (
  SELECT DISTINCT ON (f2.id) f2.id, c.id AS campaign_id
  FROM openclaw_affiliate_attribution_failures f2
  INNER JOIN campaigns c
    ON c.user_id = f2.user_id
   AND c.offer_id = f2.offer_id
   AND (c.is_deleted IS NOT TRUE)
  WHERE f2.campaign_id IS NULL
    AND f2.offer_id IS NOT NULL
  ORDER BY f2.id,
    CASE UPPER(TRIM(COALESCE(c.status, ''))) WHEN 'ENABLED' THEN 1 WHEN 'PAUSED' THEN 2 ELSE 3 END,
    c.id
) picked
WHERE f.id = picked.id;

-- 2) 无 offer_id 但有 source_asin：仅当该 ASIN 在该用户下只关联到一个 offer 时回填
WITH single_asin_offer AS (
  SELECT
    f.id AS failure_id,
    MIN(apol.offer_id) AS offer_id
  FROM openclaw_affiliate_attribution_failures f
  INNER JOIN affiliate_product_offer_links apol ON apol.user_id = f.user_id
  INNER JOIN affiliate_products ap ON ap.id = apol.product_id AND ap.user_id = f.user_id
  WHERE f.campaign_id IS NULL
    AND f.offer_id IS NULL
    AND f.source_asin IS NOT NULL
    AND TRIM(f.source_asin) <> ''
    AND UPPER(TRIM(ap.asin)) = UPPER(TRIM(f.source_asin))
  GROUP BY f.id
  HAVING COUNT(DISTINCT apol.offer_id) = 1
),
asin_campaign AS (
  SELECT DISTINCT ON (s.failure_id) s.failure_id, c.id AS campaign_id
  FROM single_asin_offer s
  INNER JOIN openclaw_affiliate_attribution_failures f ON f.id = s.failure_id
  INNER JOIN campaigns c
    ON c.user_id = f.user_id
   AND c.offer_id = s.offer_id
   AND (c.is_deleted IS NOT TRUE)
  ORDER BY s.failure_id,
    CASE UPPER(TRIM(COALESCE(c.status, ''))) WHEN 'ENABLED' THEN 1 WHEN 'PAUSED' THEN 2 ELSE 3 END,
    c.id
)
UPDATE openclaw_affiliate_attribution_failures f
SET campaign_id = ac.campaign_id
FROM asin_campaign ac
WHERE f.id = ac.failure_id;
