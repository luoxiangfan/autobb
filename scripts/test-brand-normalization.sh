#!/usr/bin/env bash

# Test script to verify brand normalization improvement
# This simulates the effect of the brand alias mapping

echo "=== Brand Normalization Test ==="
echo ""
echo "Before enhancement:"
echo "  'Squatty' → 'squatty'"
echo "  'Squatty Potty' → 'squatty potty'"
echo "  Result: Treated as DIFFERENT brands"
echo ""
echo "After enhancement:"
echo "  'Squatty' → 'squatty' → 'squatty potty' (alias)"
echo "  'Squatty Potty' → 'squatty potty'"
echo "  Result: Treated as SAME brand"
echo ""

# Query to show the impact
psql "postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads" << 'EOF'

-- Show current attribution split
SELECT
  'Current State' as scenario,
  o.brand,
  COUNT(DISTINCT aca.campaign_id) as campaigns_receiving_commission,
  COUNT(*) as attribution_records,
  ROUND(SUM(aca.commission_amount)::numeric, 2) as total_commission
FROM affiliate_commission_attributions aca
JOIN campaigns c ON c.id = aca.campaign_id
JOIN offers o ON o.id = c.offer_id
WHERE aca.user_id = 62
  AND o.brand ILIKE '%squatty%'
GROUP BY o.brand
ORDER BY total_commission DESC;

-- Show what would happen with brand normalization
SELECT
  'After Enhancement' as scenario,
  'squatty potty' as normalized_brand,
  COUNT(DISTINCT c.id) as total_campaigns_available,
  (SELECT COUNT(DISTINCT aca2.campaign_id)
   FROM affiliate_commission_attributions aca2
   JOIN campaigns c2 ON c2.id = aca2.campaign_id
   JOIN offers o2 ON o2.id = c2.offer_id
   WHERE aca2.user_id = 62 AND o2.brand ILIKE '%squatty%'
  ) as campaigns_that_received_commission,
  (SELECT ROUND(SUM(aca2.commission_amount)::numeric, 2)
   FROM affiliate_commission_attributions aca2
   JOIN campaigns c2 ON c2.id = aca2.campaign_id
   JOIN offers o2 ON o2.id = c2.offer_id
   WHERE aca2.user_id = 62 AND o2.brand ILIKE '%squatty%'
  ) as total_commission
FROM campaigns c
JOIN offers o ON o.id = c.offer_id
WHERE c.user_id = 62
  AND (c.is_deleted = false OR c.is_deleted IS NULL)
  AND o.brand ILIKE '%squatty%';

EOF

echo ""
echo "=== Analysis ==="
echo ""
echo "Impact of brand normalization:"
echo "1. All 'Squatty' and 'Squatty Potty' campaigns will be treated as the same brand"
echo "2. Commission attribution will consider ALL campaigns together"
echo "3. This doesn't change the brand fallback behavior, but ensures correct brand matching"
echo ""
echo "Note: The user's commissions are from YeahPromos, so the PartnerBoost API"
echo "enhancement won't help. However, the brand normalization fix will ensure"
echo "that 'Squatty' and 'Squatty Potty' are treated as the same brand."
