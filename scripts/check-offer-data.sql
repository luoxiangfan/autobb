-- P0数据质量检查脚本
-- 用途: 快速检查单个或多个offer的scraped_data质量
-- 使用: sqlite3 data/autoads.db < scripts/check-offer-data.sql

.mode column
.headers on
.width 5 15 10 15 15 20 10 10

-- ============================================
-- 1. 单个Offer详细检查
-- ============================================
.print "=========================================="
.print "📊 单个Offer数据质量检查"
.print "=========================================="
.print ""
.print "请设置 OFFER_ID 变量，或修改下面的 WHERE 条件"
.print ""

-- 替换 {id} 为你要检查的offer ID
SELECT
  id,
  brand,
  substr(url, 1, 40) as url_preview,
  scrape_status,
  CASE WHEN scraped_data IS NOT NULL THEN 'YES' ELSE 'NO' END as has_data
FROM offers
WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')  -- 最新完成的offer
LIMIT 1;

.print ""
.print "详细数据字段:"
.print ""

SELECT
  '- Product Name' as field,
  json_extract(scraped_data, '$.productName') as value
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')
UNION ALL
SELECT
  '- Discount',
  json_extract(scraped_data, '$.discount')
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')
UNION ALL
SELECT
  '- Sales Rank',
  json_extract(scraped_data, '$.salesRank')
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')
UNION ALL
SELECT
  '- Badge',
  json_extract(scraped_data, '$.badge')
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')
UNION ALL
SELECT
  '- Prime Eligible',
  CASE
    WHEN json_extract(scraped_data, '$.primeEligible') = '1' OR json_extract(scraped_data, '$.primeEligible') = 'true' THEN 'Yes'
    WHEN json_extract(scraped_data, '$.primeEligible') = '0' OR json_extract(scraped_data, '$.primeEligible') = 'false' THEN 'No'
    ELSE 'Unknown'
  END
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')
UNION ALL
SELECT
  '- Availability',
  json_extract(scraped_data, '$.availability')
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')
UNION ALL
SELECT
  '- Rating',
  json_extract(scraped_data, '$.rating')
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed')
UNION ALL
SELECT
  '- Review Count',
  json_extract(scraped_data, '$.reviewCount')
FROM offers WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed');

.print ""
.print "数据完整性评分:"
.print ""

SELECT
  id,
  brand,
  -- 计算有多少字段有值
  CASE WHEN json_extract(scraped_data, '$.discount') IS NOT NULL AND json_extract(scraped_data, '$.discount') != 'null' THEN 1 ELSE 0 END +
  CASE WHEN json_extract(scraped_data, '$.salesRank') IS NOT NULL AND json_extract(scraped_data, '$.salesRank') != 'null' THEN 1 ELSE 0 END +
  CASE WHEN json_extract(scraped_data, '$.badge') IS NOT NULL AND json_extract(scraped_data, '$.badge') != 'null' THEN 1 ELSE 0 END +
  CASE WHEN json_extract(scraped_data, '$.primeEligible') IS NOT NULL AND json_extract(scraped_data, '$.primeEligible') != 'null' THEN 1 ELSE 0 END +
  CASE WHEN json_extract(scraped_data, '$.availability') IS NOT NULL AND json_extract(scraped_data, '$.availability') != 'null' THEN 1 ELSE 0 END +
  CASE WHEN json_extract(scraped_data, '$.reviewHighlights') IS NOT NULL AND json_extract(scraped_data, '$.reviewHighlights') != 'null' AND json_extract(scraped_data, '$.reviewHighlights') != '[]' THEN 1 ELSE 0 END +
  CASE WHEN json_extract(scraped_data, '$.technicalDetails') IS NOT NULL AND json_extract(scraped_data, '$.technicalDetails') != 'null' AND json_extract(scraped_data, '$.technicalDetails') != '{}' THEN 1 ELSE 0 END
  as score_out_of_7,

  CASE
    WHEN
      CASE WHEN json_extract(scraped_data, '$.discount') IS NOT NULL AND json_extract(scraped_data, '$.discount') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.salesRank') IS NOT NULL AND json_extract(scraped_data, '$.salesRank') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.badge') IS NOT NULL AND json_extract(scraped_data, '$.badge') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.primeEligible') IS NOT NULL AND json_extract(scraped_data, '$.primeEligible') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.availability') IS NOT NULL AND json_extract(scraped_data, '$.availability') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.reviewHighlights') IS NOT NULL AND json_extract(scraped_data, '$.reviewHighlights') != 'null' AND json_extract(scraped_data, '$.reviewHighlights') != '[]' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.technicalDetails') IS NOT NULL AND json_extract(scraped_data, '$.technicalDetails') != 'null' AND json_extract(scraped_data, '$.technicalDetails') != '{}' THEN 1 ELSE 0 END
    >= 6 THEN '🌟 优秀'
    WHEN
      CASE WHEN json_extract(scraped_data, '$.discount') IS NOT NULL AND json_extract(scraped_data, '$.discount') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.salesRank') IS NOT NULL AND json_extract(scraped_data, '$.salesRank') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.badge') IS NOT NULL AND json_extract(scraped_data, '$.badge') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.primeEligible') IS NOT NULL AND json_extract(scraped_data, '$.primeEligible') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.availability') IS NOT NULL AND json_extract(scraped_data, '$.availability') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.reviewHighlights') IS NOT NULL AND json_extract(scraped_data, '$.reviewHighlights') != 'null' AND json_extract(scraped_data, '$.reviewHighlights') != '[]' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.technicalDetails') IS NOT NULL AND json_extract(scraped_data, '$.technicalDetails') != 'null' AND json_extract(scraped_data, '$.technicalDetails') != '{}' THEN 1 ELSE 0 END
    >= 4 THEN '✅ 良好'
    WHEN
      CASE WHEN json_extract(scraped_data, '$.discount') IS NOT NULL AND json_extract(scraped_data, '$.discount') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.salesRank') IS NOT NULL AND json_extract(scraped_data, '$.salesRank') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.badge') IS NOT NULL AND json_extract(scraped_data, '$.badge') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.primeEligible') IS NOT NULL AND json_extract(scraped_data, '$.primeEligible') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.availability') IS NOT NULL AND json_extract(scraped_data, '$.availability') != 'null' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.reviewHighlights') IS NOT NULL AND json_extract(scraped_data, '$.reviewHighlights') != 'null' AND json_extract(scraped_data, '$.reviewHighlights') != '[]' THEN 1 ELSE 0 END +
      CASE WHEN json_extract(scraped_data, '$.technicalDetails') IS NOT NULL AND json_extract(scraped_data, '$.technicalDetails') != 'null' AND json_extract(scraped_data, '$.technicalDetails') != '{}' THEN 1 ELSE 0 END
    >= 2 THEN '⚠️ 一般'
    ELSE '❌ 差'
  END as quality_rating

FROM offers
WHERE id = (SELECT MAX(id) FROM offers WHERE scrape_status = 'completed');

.print ""
.print "=========================================="
.print "📈 批量统计（最近的offers）"
.print "=========================================="
.print ""

SELECT
  COUNT(*) as total_offers,
  SUM(CASE WHEN scraped_data IS NOT NULL THEN 1 ELSE 0 END) as with_scraped_data,
  ROUND(100.0 * SUM(CASE WHEN scraped_data IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 2) || '%' as save_rate,

  SUM(CASE WHEN json_extract(scraped_data, '$.discount') IS NOT NULL AND json_extract(scraped_data, '$.discount') != 'null' THEN 1 ELSE 0 END) as with_discount,

  SUM(CASE WHEN json_extract(scraped_data, '$.salesRank') IS NOT NULL AND json_extract(scraped_data, '$.salesRank') != 'null' THEN 1 ELSE 0 END) as with_rank,

  SUM(CASE WHEN json_extract(scraped_data, '$.primeEligible') = '1' OR json_extract(scraped_data, '$.primeEligible') = 'true' THEN 1 ELSE 0 END) as prime_eligible

FROM offers
WHERE scrape_status = 'completed'
  AND scraped_at > datetime('now', '-7 days');  -- 最近7天

.print ""
.print "=========================================="
.print "🎯 真实数据使用情况"
.print "=========================================="
.print ""

SELECT
  COUNT(*) as total_with_creatives,

  SUM(CASE
    WHEN json_extract(scraped_data, '$.discount') IS NOT NULL
    AND (extracted_headlines LIKE '%Save%' OR extracted_headlines LIKE '%Off%' OR extracted_headlines LIKE '%Deal%')
    THEN 1 ELSE 0
  END) as using_promo,

  SUM(CASE
    WHEN json_extract(scraped_data, '$.primeEligible') = '1'
    AND (extracted_headlines LIKE '%Prime%' OR extracted_descriptions LIKE '%Prime%')
    THEN 1 ELSE 0
  END) as mentioning_prime,

  SUM(CASE
    WHEN (json_extract(scraped_data, '$.salesRank') IS NOT NULL OR json_extract(scraped_data, '$.badge') IS NOT NULL)
    AND (extracted_headlines LIKE '%Best Seller%' OR extracted_headlines LIKE '%Choice%' OR extracted_headlines LIKE '%#1%')
    THEN 1 ELSE 0
  END) as using_social_proof

FROM offers
WHERE extracted_headlines IS NOT NULL
  AND scraped_data IS NOT NULL
  AND scraped_at > datetime('now', '-7 days');

.print ""
.print "=========================================="
.print "💡 使用提示"
.print "=========================================="
.print ""
.print "1. 要检查特定offer，修改脚本中的 WHERE id = {id}"
.print "2. 要查看完整scraped_data，运行:"
.print "   sqlite3 data/autoads.db \"SELECT scraped_data FROM offers WHERE id = {id};\" | python3 -m json.tool"
.print ""
.print "3. 要检查headlines是否使用真实数据:"
.print "   sqlite3 data/autoads.db \"SELECT extracted_headlines FROM offers WHERE id = {id};\" | python3 -m json.tool"
.print ""
