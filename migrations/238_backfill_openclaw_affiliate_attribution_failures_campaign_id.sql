-- Migration: 238_backfill_openclaw_affiliate_attribution_failures_campaign_id.sql
-- Date: 2026-05-09
-- Description: 回填 openclaw_affiliate_attribution_failures.campaign_id（SQLite，与 PG 逻辑一致）

-- 1) 已有 offer_id
UPDATE openclaw_affiliate_attribution_failures
SET campaign_id = (
  SELECT c.id
  FROM campaigns c
  WHERE c.user_id = openclaw_affiliate_attribution_failures.user_id
    AND c.offer_id = openclaw_affiliate_attribution_failures.offer_id
    AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
  ORDER BY
    CASE UPPER(TRIM(IFNULL(c.status, ''))) WHEN 'ENABLED' THEN 1 WHEN 'PAUSED' THEN 2 ELSE 3 END,
    c.id
  LIMIT 1
)
WHERE campaign_id IS NULL
  AND offer_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM campaigns c
    WHERE c.user_id = openclaw_affiliate_attribution_failures.user_id
      AND c.offer_id = openclaw_affiliate_attribution_failures.offer_id
      AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
  );

-- 2) 无 offer_id，仅凭 source_asin 且唯一 offer
UPDATE openclaw_affiliate_attribution_failures AS f
SET campaign_id = (
  SELECT c.id
  FROM campaigns c
  WHERE c.user_id = f.user_id
    AND c.offer_id = (
      SELECT MIN(apol.offer_id)
      FROM affiliate_product_offer_links apol
      INNER JOIN affiliate_products ap ON ap.id = apol.product_id AND ap.user_id = f.user_id
      WHERE apol.user_id = f.user_id
        AND UPPER(TRIM(ap.asin)) = UPPER(TRIM(f.source_asin))
    )
    AND (c.is_deleted = 0 OR c.is_deleted IS NULL)
  ORDER BY
    CASE UPPER(TRIM(IFNULL(c.status, ''))) WHEN 'ENABLED' THEN 1 WHEN 'PAUSED' THEN 2 ELSE 3 END,
    c.id
  LIMIT 1
)
WHERE f.campaign_id IS NULL
  AND f.offer_id IS NULL
  AND f.source_asin IS NOT NULL
  AND TRIM(f.source_asin) <> ''
  AND (
    SELECT COUNT(DISTINCT apol2.offer_id)
    FROM affiliate_product_offer_links apol2
    INNER JOIN affiliate_products ap2 ON ap2.id = apol2.product_id AND ap2.user_id = f.user_id
    WHERE apol2.user_id = f.user_id
      AND UPPER(TRIM(ap2.asin)) = UPPER(TRIM(f.source_asin))
  ) = 1
  AND EXISTS (
    SELECT 1
    FROM campaigns c2
    WHERE c2.user_id = f.user_id
      AND c2.offer_id = (
        SELECT MIN(apol3.offer_id)
        FROM affiliate_product_offer_links apol3
        INNER JOIN affiliate_products ap3 ON ap3.id = apol3.product_id AND ap3.user_id = f.user_id
        WHERE apol3.user_id = f.user_id
          AND UPPER(TRIM(ap3.asin)) = UPPER(TRIM(f.source_asin))
      )
      AND (c2.is_deleted = 0 OR c2.is_deleted IS NULL)
  );
