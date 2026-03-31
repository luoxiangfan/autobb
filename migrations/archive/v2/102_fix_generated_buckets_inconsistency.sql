-- Migration: 修复 generated_buckets 字段不一致问题 (SQLite)
-- Date: 2025-12-24
-- Description: 将 ad_creatives.keyword_bucket 聚合到 offers.generated_buckets 字段

-- 问题背景:
-- 1. v4.16 新增了 generated_buckets 字段用于跟踪已生成的创意类型
-- 2. 在该功能添加前生成的创意，数据库字段没有被更新
-- 3. 导致前端"创意类型进度"显示不正确

-- 解决方案:
-- 从 ad_creatives 表实时聚合 keyword_bucket，更新到 offers 表

-- ⚠️ SQLite版本: 由于SQLite不支持UPDATE...FROM语法，需要使用子查询

-- 批量修复所有不一致的 offer
UPDATE offers
SET generated_buckets = (
  SELECT json_group_array(DISTINCT keyword_bucket)
  FROM ad_creatives
  WHERE ad_creatives.offer_id = offers.id
    AND ad_creatives.keyword_bucket IS NOT NULL
)
WHERE id IN (
  SELECT DISTINCT offer_id
  FROM ad_creatives
  WHERE keyword_bucket IS NOT NULL
)
AND (generated_buckets IS NULL OR generated_buckets = '[]' OR generated_buckets = '');
