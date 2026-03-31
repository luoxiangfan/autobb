-- Migration: 215_normalize_offer_country_uk_to_gb.sql
-- Description: Normalize offers.target_country from UK to GB and migrate offer_name token _UK_ -> _GB_
-- Date: 2026-03-19
-- Database: SQLite

DROP TABLE IF EXISTS _tmp_offer_uk_to_gb;
CREATE TEMP TABLE _tmp_offer_uk_to_gb AS
SELECT
  id,
  user_id,
  COALESCE(
    NULLIF(
      CASE
        WHEN offer_name IS NOT NULL AND INSTR(offer_name, '_UK_') > 1
          THEN SUBSTR(offer_name, 1, INSTR(offer_name, '_UK_') - 1)
        ELSE NULL
      END,
      ''
    ),
    NULLIF(TRIM(brand), ''),
    'Offer' || id
  ) AS name_prefix,
  CASE
    WHEN offer_name IS NOT NULL AND INSTR(offer_name, '_UK_') > 0 THEN 1
    ELSE 0
  END AS should_rename_name
FROM offers
WHERE UPPER(TRIM(COALESCE(target_country, ''))) = 'UK';

-- 先改目标国家
UPDATE offers
SET target_country = 'GB'
WHERE id IN (SELECT id FROM _tmp_offer_uk_to_gb);

-- 仅对包含 _UK_ 片段的 offer_name 做格式迁移
UPDATE offers
SET offer_name = '__MIG_UK_GB_' || id
WHERE id IN (
  SELECT id
  FROM _tmp_offer_uk_to_gb
  WHERE should_rename_name = 1
);

DROP TABLE IF EXISTS _tmp_offer_uk_to_gb_seq;
CREATE TEMP TABLE _tmp_offer_uk_to_gb_seq AS
WITH current_max AS (
  SELECT
    m.id,
    m.user_id,
    m.name_prefix,
    COALESCE((
      SELECT MAX(CAST(SUBSTR(o.offer_name, LENGTH(m.name_prefix) + 5) AS INTEGER))
      FROM offers o
      WHERE o.user_id = m.user_id
        AND o.id NOT IN (
          SELECT id
          FROM _tmp_offer_uk_to_gb
          WHERE should_rename_name = 1
        )
        AND o.offer_name LIKE m.name_prefix || '_GB_%'
        AND SUBSTR(o.offer_name, LENGTH(m.name_prefix) + 5) GLOB '[0-9]*'
    ), 0) AS base_seq
  FROM _tmp_offer_uk_to_gb m
  WHERE m.should_rename_name = 1
),
ranked AS (
  SELECT
    id,
    name_prefix,
    base_seq,
    ROW_NUMBER() OVER (PARTITION BY user_id, name_prefix ORDER BY id) AS rn
  FROM current_max
)
SELECT
  id,
  name_prefix,
  base_seq + rn AS final_seq
FROM ranked;

UPDATE offers
SET offer_name = (
  SELECT s.name_prefix || '_GB_' || PRINTF('%02d', s.final_seq)
  FROM _tmp_offer_uk_to_gb_seq s
  WHERE s.id = offers.id
)
WHERE id IN (SELECT id FROM _tmp_offer_uk_to_gb_seq);

DROP TABLE IF EXISTS _tmp_offer_uk_to_gb_seq;
DROP TABLE IF EXISTS _tmp_offer_uk_to_gb;
