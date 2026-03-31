#!/usr/bin/env bash

# Test YeahPromos API enhancement for user lxl0333019

echo "=== Testing YeahPromos API Enhancement ==="
echo ""

# Test 1: Check if missing ASINs exist in global product pool
echo "Test 1: Checking global product pool for missing ASINs"
echo "-------------------------------------------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

WITH missing_asins AS (
  SELECT DISTINCT source_asin
  FROM affiliate_commission_attributions
  WHERE user_id = 62
    AND source_asin IS NOT NULL
    AND source_asin NOT IN (
      SELECT DISTINCT
        CASE
          WHEN url ~ 'amazon.com/dp/([A-Z0-9]{10})' THEN substring(url from 'amazon.com/dp/([A-Z0-9]{10})')
          WHEN final_url ~ 'amazon.com/dp/([A-Z0-9]{10})' THEN substring(final_url from 'amazon.com/dp/([A-Z0-9]{10})')
        END
      FROM offers
      WHERE user_id = 62 AND (is_deleted = false OR is_deleted IS NULL)
    )
)
SELECT
  ma.source_asin,
  ap.brand as global_brand,
  ap.product_name as global_product_name,
  (SELECT COUNT(*) FROM affiliate_commission_attributions WHERE user_id = 62 AND source_asin = ma.source_asin) as commission_count,
  (SELECT SUM(commission_amount) FROM affiliate_commission_attributions WHERE user_id = 62 AND source_asin = ma.source_asin) as total_commission
FROM missing_asins ma
LEFT JOIN affiliate_products ap ON ap.asin = ma.source_asin AND ap.platform = 'yeahpromos' AND ap.user_id = 1
ORDER BY total_commission DESC;

EOF

echo ""
echo "Test 2: Verify brand normalization will work"
echo "---------------------------------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

-- Check if global brands match user's offer brands after normalization
WITH global_brands AS (
  SELECT DISTINCT
    ap.asin,
    LOWER(TRIM(ap.brand)) as normalized_brand
  FROM affiliate_products ap
  WHERE ap.platform = 'yeahpromos'
    AND ap.user_id = 1
    AND ap.asin IN ('B00HSR1B9W', 'B007BISCT0', 'B00HSR1DHM', 'B085FS4JTD', 'B0DQVMHVFD')
),
user_brands AS (
  SELECT DISTINCT
    LOWER(TRIM(brand)) as normalized_brand,
    COUNT(*) as campaign_count
  FROM offers o
  JOIN campaigns c ON c.offer_id = o.id
  WHERE o.user_id = 62
    AND (o.is_deleted = false OR o.is_deleted IS NULL)
    AND (c.is_deleted = false OR c.is_deleted IS NULL)
  GROUP BY LOWER(TRIM(brand))
)
SELECT
  gb.asin,
  gb.normalized_brand as global_brand,
  CASE
    WHEN gb.normalized_brand = 'squatty potty' THEN 'squatty potty'
    WHEN gb.normalized_brand = 'squatty' THEN 'squatty potty'
    ELSE gb.normalized_brand
  END as after_alias_mapping,
  ub.campaign_count as matching_campaigns
FROM global_brands gb
LEFT JOIN user_brands ub ON (
  CASE
    WHEN gb.normalized_brand = 'squatty' THEN 'squatty potty'
    ELSE gb.normalized_brand
  END = ub.normalized_brand
)
ORDER BY gb.asin;

EOF

echo ""
echo "=== Summary ==="
echo ""
echo "Expected improvements with YeahPromos support:"
echo "1. Missing ASINs will be looked up in global product pool (user_id=1)"
echo "2. Brand information will be retrieved and normalized"
echo "3. Brand alias mapping will unify 'Squatty' and 'Squatty Potty'"
echo "4. Attribution will use enhanced brand information for better matching"
