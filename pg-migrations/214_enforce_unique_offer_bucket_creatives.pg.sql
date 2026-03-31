-- Migration: 214_enforce_unique_offer_bucket_creatives.pg.sql
-- Description: Enforce one active creative per offer+bucket (A/B/D) and clean historical duplicates
-- Date: 2026-03-18
-- Database: PostgreSQL

-- 1) 统一历史桶值到 A/B/D（兼容旧值 C/S）
UPDATE ad_creatives
SET keyword_bucket = CASE
  WHEN UPPER(BTRIM(keyword_bucket)) = 'C' THEN 'B'
  WHEN UPPER(BTRIM(keyword_bucket)) = 'S' THEN 'D'
  ELSE UPPER(BTRIM(keyword_bucket))
END
WHERE keyword_bucket IS NOT NULL
  AND BTRIM(keyword_bucket) <> ''
  AND UPPER(BTRIM(keyword_bucket)) IN ('A', 'B', 'C', 'D', 'S');

-- 2) 软删除重复的活跃创意（同 offer + 同 bucket 仅保留一条）
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY offer_id, keyword_bucket
      ORDER BY
        CASE
          WHEN LOWER(COALESCE(creation_status, '')) = 'generating'
               AND (
                 COALESCE(headlines, '') LIKE '%生成中%'
                 OR COALESCE(descriptions, '') LIKE '%正在生成%'
               )
          THEN 1
          ELSE 0
        END ASC,
        COALESCE(updated_at, created_at) DESC,
        id DESC
    ) AS rn
  FROM ad_creatives
  WHERE is_deleted = FALSE
    AND deleted_at IS NULL
    AND keyword_bucket IN ('A', 'B', 'D')
)
UPDATE ad_creatives AS ac
SET
  is_deleted = TRUE,
  deleted_at = NOW(),
  creation_status = CASE
    WHEN LOWER(COALESCE(ac.creation_status, '')) = 'generating' THEN 'failed'
    ELSE ac.creation_status
  END,
  creation_error = COALESCE(ac.creation_error, '系统去重: 同 offer 同桶重复创意自动软删除'),
  updated_at = NOW()
FROM ranked
WHERE ac.id = ranked.id
  AND ranked.rn > 1
  AND ac.is_deleted = FALSE;

-- 3) 强约束：同一 offer 的活跃创意在同一桶（A/B/D）只能有一条
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_creatives_offer_bucket_unique_active
ON ad_creatives (offer_id, keyword_bucket)
WHERE is_deleted = FALSE
  AND deleted_at IS NULL
  AND keyword_bucket IN ('A', 'B', 'D');
