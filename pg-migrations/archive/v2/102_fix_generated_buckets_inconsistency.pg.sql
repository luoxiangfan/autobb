-- Migration: 修复 generated_buckets 字段不一致问题 (PostgreSQL)
-- Date: 2025-12-24
-- Description: 将 ad_creatives.keyword_bucket 聚合到 offers.generated_buckets 字段

-- 问题背景:
-- 1. v4.16 新增了 generated_buckets 字段用于跟踪已生成的创意类型
-- 2. 在该功能添加前生成的创意，数据库字段没有被更新
-- 3. 导致前端"创意类型进度"显示不正确

-- 解决方案:
-- 从 ad_creatives 表实时聚合 keyword_bucket，更新到 offers 表

-- 批量修复所有不一致的 offer
WITH bucket_aggregation AS (
  SELECT
    offer_id,
    json_agg(DISTINCT keyword_bucket ORDER BY keyword_bucket) as actual_buckets
  FROM ad_creatives
  WHERE keyword_bucket IS NOT NULL
  GROUP BY offer_id
)
UPDATE offers o
SET generated_buckets = ba.actual_buckets::text
FROM bucket_aggregation ba
WHERE o.id = ba.offer_id
  AND (o.generated_buckets IS NULL OR o.generated_buckets = '[]');

-- 验证修复结果
SELECT
  COUNT(*) as fixed_count
FROM offers o
INNER JOIN (
  SELECT
    offer_id,
    COUNT(DISTINCT keyword_bucket) as bucket_count
  FROM ad_creatives
  WHERE keyword_bucket IS NOT NULL
  GROUP BY offer_id
  HAVING COUNT(DISTINCT keyword_bucket) > 0
) ac ON o.id = ac.offer_id
WHERE o.generated_buckets IS NOT NULL
  AND o.generated_buckets != '[]';
