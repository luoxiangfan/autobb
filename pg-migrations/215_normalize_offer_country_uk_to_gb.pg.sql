-- Migration: 215_normalize_offer_country_uk_to_gb.pg.sql
-- Description: Normalize offers.target_country from UK to GB and migrate offer_name token _UK_ -> _GB_
-- Date: 2026-03-19
-- Database: PostgreSQL

DROP TABLE IF EXISTS tmp_offer_uk_to_gb;
CREATE TEMP TABLE tmp_offer_uk_to_gb AS
SELECT
  id,
  user_id,
  COALESCE(
    NULLIF(
      CASE
        WHEN offer_name IS NOT NULL AND POSITION('_UK_' IN offer_name) > 1
          THEN SPLIT_PART(offer_name, '_UK_', 1)
        ELSE NULL
      END,
      ''
    ),
    NULLIF(BTRIM(brand), ''),
    'Offer' || id::text
  ) AS name_prefix,
  CASE
    WHEN offer_name IS NOT NULL AND POSITION('_UK_' IN offer_name) > 0 THEN TRUE
    ELSE FALSE
  END AS should_rename_name
FROM offers
WHERE UPPER(BTRIM(COALESCE(target_country, ''))) = 'UK';

-- 先改目标国家
UPDATE offers
SET target_country = 'GB'
WHERE id IN (SELECT id FROM tmp_offer_uk_to_gb);

-- 仅对包含 _UK_ 片段的 offer_name 做格式迁移
UPDATE offers
SET offer_name = '__MIG_UK_GB_' || id::text
WHERE id IN (
  SELECT id
  FROM tmp_offer_uk_to_gb
  WHERE should_rename_name = TRUE
);

DROP TABLE IF EXISTS tmp_offer_uk_to_gb_seq;
CREATE TEMP TABLE tmp_offer_uk_to_gb_seq AS
WITH current_max AS (
  SELECT
    m.id,
    m.user_id,
    m.name_prefix,
    COALESCE((
      SELECT MAX((SUBSTRING(o.offer_name FROM (LENGTH(m.name_prefix) + 5)))::INT)
      FROM offers o
      WHERE o.user_id = m.user_id
        AND o.id NOT IN (
          SELECT id
          FROM tmp_offer_uk_to_gb
          WHERE should_rename_name = TRUE
        )
        AND o.offer_name LIKE (m.name_prefix || '_GB_%')
        AND SUBSTRING(o.offer_name FROM (LENGTH(m.name_prefix) + 5)) ~ '^[0-9]+$'
    ), 0) AS base_seq
  FROM tmp_offer_uk_to_gb m
  WHERE m.should_rename_name = TRUE
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

UPDATE offers AS o
SET offer_name = s.name_prefix || '_GB_' || LPAD(s.final_seq::text, 2, '0')
FROM tmp_offer_uk_to_gb_seq s
WHERE o.id = s.id;

DROP TABLE IF EXISTS tmp_offer_uk_to_gb_seq;
DROP TABLE IF EXISTS tmp_offer_uk_to_gb;
