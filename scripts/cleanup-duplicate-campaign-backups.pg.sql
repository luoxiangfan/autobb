-- =============================================================================
-- 一次性清理：campaign_backups 历史重复行（PostgreSQL）
-- =============================================================================
--
-- 背景：
--   发布流程曾额外 INSERT backup_source='publish'，与 autoads 自动备份并存，
--   导致同一 (user_id, offer_id) 出现多条记录。
--
-- 保留规则（每个 user_id + offer_id 仅留 1 条）：
--   1. backup_version 更高优先
--   2. 有有效 campaign_config 优先（非 NULL / 非空对象）
--   3. updated_at 更新者优先
--   4. id 更大者优先（兜底）
--
-- 额外：将保留行的 backup_source='publish' 归一为 'autoads'
--
-- 运维说明：docs/operations/campaign-backups-dedup.md
--
-- 推荐（跨平台）：
--   npm run campaign-backups:dedup:preview
--   npm run campaign-backups:dedup
--
-- 直接执行 SQL（建议先备份库）：
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-duplicate-campaign-backups.pg.sql
--
-- 若只想预览、不删除，执行到 STEP 2 后 ROLLBACK 即可。
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- STEP 1: 清理前统计
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT (user_id, offer_id)) AS distinct_user_offer_pairs,
  COUNT(*) - COUNT(DISTINCT (user_id, offer_id)) AS duplicate_rows_to_remove
FROM campaign_backups;

SELECT
  backup_source,
  COUNT(*) AS row_count
FROM campaign_backups
GROUP BY backup_source
ORDER BY row_count DESC;

-- 存在重复的 (user_id, offer_id) 组合
SELECT
  user_id,
  offer_id,
  COUNT(*) AS backup_count,
  array_agg(id ORDER BY id) AS backup_ids,
  array_agg(backup_source ORDER BY id) AS sources
FROM campaign_backups
GROUP BY user_id, offer_id
HAVING COUNT(*) > 1
ORDER BY backup_count DESC, user_id, offer_id
LIMIT 50;

-- -----------------------------------------------------------------------------
-- STEP 2: 预览将删除的行（rn > 1）
-- -----------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    user_id,
    offer_id,
    backup_source,
    backup_version,
    campaign_config IS NOT NULL
      AND campaign_config::text NOT IN ('null', '{}') AS has_config,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, offer_id
      ORDER BY
        backup_version DESC,
        CASE
          WHEN campaign_config IS NOT NULL
            AND campaign_config::text NOT IN ('null', '{}')
          THEN 0
          ELSE 1
        END,
        updated_at DESC,
        id DESC
    ) AS rn
  FROM campaign_backups
)
SELECT
  id,
  user_id,
  offer_id,
  backup_source,
  backup_version,
  has_config,
  updated_at,
  rn
FROM ranked
WHERE rn > 1
ORDER BY user_id, offer_id, rn;

-- -----------------------------------------------------------------------------
-- STEP 3: 归一保留行的 backup_source（publish -> autoads）
-- -----------------------------------------------------------------------------
WITH keepers AS (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, offer_id
        ORDER BY
          backup_version DESC,
          CASE
            WHEN campaign_config IS NOT NULL
              AND campaign_config::text NOT IN ('null', '{}')
            THEN 0
            ELSE 1
          END,
          updated_at DESC,
          id DESC
      ) AS rn
    FROM campaign_backups
  ) ranked
  WHERE rn = 1
)
UPDATE campaign_backups cb
SET
  backup_source = 'autoads',
  updated_at = CURRENT_TIMESTAMP
FROM keepers k
WHERE cb.id = k.id
  AND cb.backup_source = 'publish';

-- -----------------------------------------------------------------------------
-- STEP 4: 删除重复行
-- -----------------------------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, offer_id
      ORDER BY
        backup_version DESC,
        CASE
          WHEN campaign_config IS NOT NULL
            AND campaign_config::text NOT IN ('null', '{}')
          THEN 0
          ELSE 1
        END,
        updated_at DESC,
        id DESC
    ) AS rn
  FROM campaign_backups
)
DELETE FROM campaign_backups cb
USING ranked r
WHERE cb.id = r.id
  AND r.rn > 1;

-- -----------------------------------------------------------------------------
-- STEP 5: 清理后验证（应无重复；publish 来源应为 0）
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) AS total_rows_after,
  COUNT(DISTINCT (user_id, offer_id)) AS distinct_pairs_after
FROM campaign_backups;

SELECT user_id, offer_id, COUNT(*) AS cnt
FROM campaign_backups
GROUP BY user_id, offer_id
HAVING COUNT(*) > 1;

SELECT backup_source, COUNT(*) AS row_count
FROM campaign_backups
GROUP BY backup_source
ORDER BY row_count DESC;

-- 确认无误后提交；若要仅预览则改为 ROLLBACK;
COMMIT;
