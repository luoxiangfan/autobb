-- Migration: Fill pricing, promotions, scraped_data JSON fields for existing offers (PostgreSQL)
-- Date: 2025-12-03
-- Description: 为现有offers记录填充pricing、promotions、scraped_data JSON字段

-- ============================================================================
-- 说明：
-- 1. pricing: 从product_price解析生成（如果有）
-- 2. promotions: 初始化为空数组结构
-- 3. scraped_data: 包含price信息的初始结构
-- ============================================================================

-- 步骤1: 为所有pricing为空但product_price有值的记录填充pricing JSON
UPDATE offers
SET pricing = (
  CASE 
    -- 简单价格格式（如 "$99.99"）
    WHEN product_price LIKE '$%' AND product_price NOT LIKE '%→%' AND product_price NOT LIKE '%(%' THEN
      jsonb_build_object(
        'original', product_price,
        'current', product_price,
        'currency', 'USD'
      )::text
    -- 欧元价格
    WHEN product_price LIKE '€%' AND product_price NOT LIKE '%→%' AND product_price NOT LIKE '%(%' THEN
      jsonb_build_object(
        'original', product_price,
        'current', product_price,
        'currency', 'EUR'
      )::text
    -- 英镑价格
    WHEN product_price LIKE '£%' AND product_price NOT LIKE '%→%' AND product_price NOT LIKE '%(%' THEN
      jsonb_build_object(
        'original', product_price,
        'current', product_price,
        'currency', 'GBP'
      )::text
    -- 其他情况保持空
    ELSE NULL
  END
)
WHERE product_price IS NOT NULL 
  AND product_price != ''
  AND (pricing IS NULL OR pricing = '');

-- 步骤2: 为所有promotions为空的记录初始化空结构
UPDATE offers
SET promotions = '{"active":[]}'::text
WHERE promotions IS NULL OR promotions = '';

-- 步骤3: 为所有scraped_data为空的记录初始化结构
UPDATE offers
SET scraped_data = (
  CASE
    -- 如果有pricing，从pricing中提取price信息
    WHEN pricing IS NOT NULL AND pricing != '' THEN
      jsonb_build_object(
        'price', jsonb_build_object(
          'original', (pricing::jsonb->>'original'),
          'current', (pricing::jsonb->>'current'),
          'discount', null
        ),
        'reviews', null,
        'salesRank', null,
        'badge', null,
        'availability', null,
        'shipping', null
      )::text
    -- 否则创建空price结构
    ELSE
      jsonb_build_object(
        'price', null,
        'reviews', null,
        'salesRank', null,
        'badge', null,
        'availability', null,
        'shipping', null
      )::text
  END
)
WHERE scraped_data IS NULL OR scraped_data = '';

-- 步骤4: 验证更新结果
SELECT 
  COUNT(*) as total_offers,
  COUNT(CASE WHEN pricing IS NOT NULL AND pricing != '' THEN 1 END) as offers_with_pricing,
  COUNT(CASE WHEN promotions IS NOT NULL AND promotions != '' THEN 1 END) as offers_with_promotions,
  COUNT(CASE WHEN scraped_data IS NOT NULL AND scraped_data != '' THEN 1 END) as offers_with_scraped_data,
  COUNT(CASE WHEN product_price IS NOT NULL AND product_price != '' THEN 1 END) as offers_with_product_price
FROM offers
WHERE is_deleted = 0 OR is_deleted IS NULL;
