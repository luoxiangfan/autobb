-- 262: Backfill legacy expand_keywords keywordCoverageCount in persisted recommendations
-- Replaces runtime repairLegacyExpandKeywordCoverage() on strategy list reads.

WITH keyword_inventory AS (
  SELECT
    ag.user_id,
    ag.campaign_id,
    lower(trim(k.keyword_text)) AS keyword_key
  FROM ad_groups ag
  INNER JOIN keywords k ON k.ad_group_id = ag.id AND k.user_id = ag.user_id
  WHERE COALESCE(k.is_negative, false) = false
    AND NULLIF(trim(k.keyword_text), '') IS NOT NULL

  UNION

  SELECT
    c.user_id,
    c.id AS campaign_id,
    lower(trim(kw.elem->>'text')) AS keyword_key
  FROM campaigns c
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(c.campaign_config->'keywords') = 'array'
      THEN c.campaign_config->'keywords'
      ELSE '[]'::jsonb
    END
  ) AS kw(elem)
  WHERE NULLIF(trim(kw.elem->>'text'), '') IS NOT NULL
),
coverage AS (
  SELECT
    user_id,
    campaign_id,
    COUNT(DISTINCT keyword_key) AS coverage_count
  FROM keyword_inventory
  WHERE keyword_key IS NOT NULL
    AND keyword_key <> ''
  GROUP BY user_id, campaign_id
),
legacy AS (
  SELECT
    scr.id,
    scr.summary,
    c.coverage_count
  FROM strategy_center_recommendations scr
  INNER JOIN coverage c
    ON c.user_id = scr.user_id
   AND c.campaign_id = scr.campaign_id
  WHERE scr.recommendation_type = 'expand_keywords'
    AND COALESCE((scr.data_json->>'keywordCoverageCount')::numeric, 0) <= 0
    AND c.coverage_count > 0
)
UPDATE strategy_center_recommendations scr
SET
  data_json = jsonb_set(
    COALESCE(scr.data_json, '{}'::jsonb),
    '{keywordCoverageCount}',
    to_jsonb(legacy.coverage_count::int),
    true
  ),
  summary = CASE
    WHEN scr.summary ~ '当前关键词\s+\d+\s+个'
    THEN regexp_replace(
      scr.summary,
      '当前关键词\s+\d+\s+个',
      '当前关键词 ' || legacy.coverage_count::text || ' 个',
      'g'
    )
    ELSE scr.summary
  END,
  updated_at = CURRENT_TIMESTAMP
FROM legacy
WHERE scr.id = legacy.id;
