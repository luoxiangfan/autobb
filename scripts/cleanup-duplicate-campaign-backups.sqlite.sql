-- =============================================================================
-- 一次性清理：campaign_backups 历史重复行（SQLite）
-- =============================================================================
--
-- 背景：
--   发布流程曾额外 INSERT backup_source='publish'，与 autoads 自动备份并存，
--   导致同一 (user_id, offer_id) 出现多条记录。
--
-- 保留规则（每个 user_id + offer_id 仅留 1 条）：
--   1. backup_version 更高优先
--   2. 有有效 campaign_config 优先
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
-- 直接执行 SQL（建议先备份 data/autoads.db）：
--   sqlite3 data/autoads.db < scripts/cleanup-duplicate-campaign-backups.sqlite.sql
--
-- 若只想预览：在 STEP 4 之前停止，或把末尾 COMMIT 改为 ROLLBACK。
-- 需要 SQLite 3.25+（支持窗口函数）。
-- =============================================================================

.headers on
.mode column

BEGIN TRANSACTION;

-- -----------------------------------------------------------------------------
-- STEP 1: 清理前统计
-- -----------------------------------------------------------------------------
.print ''
.print '=== STEP 1: 清理前统计 ==='
.print ''

SELECT
  COUNT(*) AS total_rows,
  COUNT(DISTINCT user_id || '-' || offer_id) AS distinct_user_offer_pairs,
  COUNT(*) - COUNT(DISTINCT user_id || '-' || offer_id) AS duplicate_rows_to_remove
FROM campaign_backups;

SELECT backup_source, COUNT(*) AS row_count
FROM campaign_backups
GROUP BY backup_source
ORDER BY row_count DESC;

SELECT
  user_id,
  offer_id,
  COUNT(*) AS backup_count,
  GROUP_CONCAT(id) AS backup_ids,
  GROUP_CONCAT(backup_source) AS sources
FROM campaign_backups
GROUP BY user_id, offer_id
HAVING COUNT(*) > 1
ORDER BY backup_count DESC
LIMIT 50;

-- -----------------------------------------------------------------------------
-- STEP 2: 预览将删除的行
-- -----------------------------------------------------------------------------
.print ''
.print '=== STEP 2: 将删除的重复行（预览）==='
.print ''

WITH ranked AS (
  SELECT
    id,
    user_id,
    offer_id,
    backup_source,
    backup_version,
    campaign_config IS NOT NULL
      AND TRIM(campaign_config) NOT IN ('', '{}', 'null') AS has_config,
    updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, offer_id
      ORDER BY
        backup_version DESC,
        CASE
          WHEN campaign_config IS NOT NULL
            AND TRIM(campaign_config) NOT IN ('', '{}', 'null')
          THEN 0
          ELSE 1
        END,
        updated_at DESC,
        id DESC
    ) AS rn
  FROM campaign_backups
)
SELECT id, user_id, offer_id, backup_source, backup_version, has_config, updated_at, rn
FROM ranked
WHERE rn > 1
ORDER BY user_id, offer_id;

-- -----------------------------------------------------------------------------
-- STEP 3: 归一保留行的 backup_source（publish -> autoads）
-- -----------------------------------------------------------------------------
UPDATE campaign_backups
SET
  backup_source = 'autoads',
  updated_at = datetime('now')
WHERE backup_source = 'publish'
  AND id IN (
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
                AND TRIM(campaign_config) NOT IN ('', '{}', 'null')
              THEN 0
              ELSE 1
            END,
            updated_at DESC,
            id DESC
        ) AS rn
      FROM campaign_backups
    )
    WHERE rn = 1
  );

-- -----------------------------------------------------------------------------
-- STEP 4: 删除重复行
-- -----------------------------------------------------------------------------
DELETE FROM campaign_backups
WHERE id IN (
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
              AND TRIM(campaign_config) NOT IN ('', '{}', 'null')
            THEN 0
            ELSE 1
          END,
          updated_at DESC,
          id DESC
      ) AS rn
    FROM campaign_backups
  )
  WHERE rn > 1
);

-- -----------------------------------------------------------------------------
-- STEP 5: 清理后验证
-- -----------------------------------------------------------------------------
.print ''
.print '=== STEP 5: 清理后验证 ==='
.print ''

SELECT
  COUNT(*) AS total_rows_after,
  COUNT(DISTINCT user_id || '-' || offer_id) AS distinct_pairs_after
FROM campaign_backups;

SELECT user_id, offer_id, COUNT(*) AS cnt
FROM campaign_backups
GROUP BY user_id, offer_id
HAVING COUNT(*) > 1;

SELECT backup_source, COUNT(*) AS row_count
FROM campaign_backups
GROUP BY backup_source
ORDER BY row_count DESC;

COMMIT;

.print ''
.print 'Done. 若需撤销本次清理，请从备份文件恢复数据库。'
.print ''
