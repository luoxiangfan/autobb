-- Migration: 249_campaign_backups_partial_unique
-- Description: Dedupe campaign_backups, then enforce partial unique (user_id, offer_id)
-- SQLite

-- 1) 与 pruneCampaignBackupsForOffer 一致：每组仅保留 canonical + google_ads v2+
WITH ranked AS (
  SELECT
    id,
    user_id,
    offer_id,
    backup_source,
    backup_version,
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
),
canonical AS (
  SELECT user_id, offer_id, id AS canonical_id
  FROM ranked
  WHERE rn = 1
),
keeper_ids AS (
  SELECT cb.id
  FROM campaign_backups cb
  INNER JOIN canonical c
    ON cb.user_id = c.user_id AND cb.offer_id = c.offer_id
  WHERE cb.id = c.canonical_id
     OR (cb.backup_source = 'google_ads' AND cb.backup_version >= 2)
)
DELETE FROM campaign_backups
WHERE id NOT IN (SELECT id FROM keeper_ids);

-- 2) 同组多条 autoads/publish 时只留排名最高的一条
DELETE FROM campaign_backups
WHERE id IN (
  SELECT id FROM (
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
    WHERE backup_source IN ('autoads', 'publish')
  ) AS dup
  WHERE rn > 1
);

-- 3) 同组多条 google_ads 终态备份只留一条
DELETE FROM campaign_backups
WHERE id IN (
  SELECT id FROM (
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
    WHERE backup_source = 'google_ads' AND backup_version >= 2
  ) AS dup
  WHERE rn > 1
);

UPDATE campaign_backups
SET backup_source = 'autoads', updated_at = datetime('now')
WHERE backup_source = 'publish';

-- 每个 Offer 至多一条 autoads/publish 备份
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_backups_user_offer_autoads_unique
ON campaign_backups(user_id, offer_id)
WHERE backup_source IN ('autoads', 'publish');

-- 每个 Offer 至多一条 google_ads 终态（v2+）备份
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_backups_user_offer_google_final_unique
ON campaign_backups(user_id, offer_id)
WHERE backup_source = 'google_ads' AND backup_version >= 2;
