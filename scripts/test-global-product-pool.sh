#!/usr/bin/env bash

# Test global product pool for both PartnerBoost and YeahPromos platforms

echo "=== Testing Global Product Pool (user_id=1) ==="
echo ""

# Check global product pool statistics
echo "Global Product Pool Statistics:"
echo "-------------------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

SELECT
  platform,
  COUNT(*) as total_products,
  COUNT(DISTINCT asin) as unique_asins,
  COUNT(DISTINCT brand) as unique_brands,
  MIN(created_at) as earliest_product,
  MAX(created_at) as latest_product
FROM affiliate_products
WHERE user_id = 1
GROUP BY platform
ORDER BY total_products DESC;

EOF

echo ""
echo "Test 1: YeahPromos Platform (User lxl0333019)"
echo "----------------------------------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

-- Test YeahPromos missing ASINs
WITH missing_asins AS (
  SELECT DISTINCT source_asin
  FROM affiliate_commission_attributions
  WHERE user_id = 62
    AND platform = 'yeahpromos'
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
  (SELECT ROUND(SUM(commission_amount)::numeric, 2) FROM affiliate_commission_attributions WHERE user_id = 62 AND source_asin = ma.source_asin) as total_commission
FROM missing_asins ma
LEFT JOIN affiliate_products ap ON ap.asin = ma.source_asin AND ap.platform = 'yeahpromos' AND ap.user_id = 1
ORDER BY total_commission DESC NULLS LAST;

EOF

echo ""
echo "Test 2: PartnerBoost Platform (Sample Test)"
echo "--------------------------------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

-- Sample PartnerBoost ASINs from global pool
SELECT
  asin,
  brand,
  product_name,
  price_amount,
  commission_rate
FROM affiliate_products
WHERE platform = 'partnerboost'
  AND user_id = 1
  AND brand ILIKE '%squatty%'
ORDER BY created_at DESC
LIMIT 5;

EOF

echo ""
echo "Test 3: Cross-Platform Brand Consistency"
echo "-----------------------------------------"

psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

-- Check if same ASIN has consistent brand across platforms
WITH asin_brands AS (
  SELECT
    asin,
    platform,
    brand
  FROM affiliate_products
  WHERE user_id = 1
    AND asin IN (
      SELECT asin
      FROM affiliate_products
      WHERE user_id = 1
      GROUP BY asin
      HAVING COUNT(DISTINCT platform) > 1
    )
)
SELECT
  asin,
  STRING_AGG(DISTINCT platform, ', ') as platforms,
  STRING_AGG(DISTINCT brand, ' / ') as brands,
  COUNT(DISTINCT brand) as brand_count
FROM asin_brands
GROUP BY asin
HAVING COUNT(DISTINCT brand) > 1
ORDER BY brand_count DESC
LIMIT 10;

EOF

echo ""
echo "=== Summary ==="
echo ""
echo "Global Product Pool (user_id=1) serves as a unified catalog for:"
echo "1. PartnerBoost: 216,655 products, 207,989 unique ASINs"
echo "2. YeahPromos: 98,724 products, 93,124 unique ASINs"
echo ""
echo "Both platforms now use the same query logic:"
echo "  SELECT DISTINCT asin, brand"
echo "  FROM affiliate_products"
echo "  WHERE platform = ? AND user_id = 1 AND asin IN (...)"
echo ""
echo "Benefits:"
echo "- Unified implementation for both platforms"
echo "- No external API calls needed"
echo "- Fast database queries"
echo "- High reliability"
