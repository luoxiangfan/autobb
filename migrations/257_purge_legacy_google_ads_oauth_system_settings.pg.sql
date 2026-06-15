-- 257: Finalize Google Ads OAuth settings migration (SQL-only backfill + purge)
-- Replaces runtime migrateLegacyGoogleAdsSettingsStorage() in db:migrate.

WITH legacy AS (
  SELECT
    user_id,
    MAX(CASE WHEN key = 'client_id' THEN NULLIF(TRIM(value), '') END) AS client_id,
    MAX(CASE WHEN key = 'client_secret' THEN NULLIF(TRIM(value), '') END) AS client_secret,
    MAX(CASE WHEN key = 'developer_token' THEN NULLIF(TRIM(value), '') END) AS developer_token,
    MAX(CASE WHEN key = 'login_customer_id' THEN NULLIF(TRIM(value), '') END) AS login_customer_id
  FROM system_settings
  WHERE category = 'google_ads'
    AND user_id IS NOT NULL
    AND key IN ('login_customer_id', 'client_id', 'client_secret', 'developer_token')
  GROUP BY user_id
  HAVING COUNT(*) > 0
)
INSERT INTO google_ads_credentials (
  user_id,
  client_id,
  client_secret,
  refresh_token,
  developer_token,
  login_customer_id,
  is_active,
  updated_at
)
SELECT
  l.user_id,
  COALESCE(l.client_id, ''),
  COALESCE(l.client_secret, ''),
  '',
  COALESCE(l.developer_token, ''),
  COALESCE(l.login_customer_id, ''),
  TRUE,
  CURRENT_TIMESTAMP
FROM legacy l
LEFT JOIN google_ads_credentials g ON g.user_id = l.user_id
WHERE g.user_id IS NULL
  AND (
    l.client_id IS NOT NULL
    OR l.client_secret IS NOT NULL
    OR l.developer_token IS NOT NULL
    OR l.login_customer_id IS NOT NULL
  );

WITH legacy AS (
  SELECT
    user_id,
    MAX(CASE WHEN key = 'client_id' THEN NULLIF(TRIM(value), '') END) AS client_id,
    MAX(CASE WHEN key = 'client_secret' THEN NULLIF(TRIM(value), '') END) AS client_secret,
    MAX(CASE WHEN key = 'developer_token' THEN NULLIF(TRIM(value), '') END) AS developer_token,
    MAX(CASE WHEN key = 'login_customer_id' THEN NULLIF(TRIM(value), '') END) AS login_customer_id
  FROM system_settings
  WHERE category = 'google_ads'
    AND user_id IS NOT NULL
    AND key IN ('login_customer_id', 'client_id', 'client_secret', 'developer_token')
  GROUP BY user_id
  HAVING COUNT(*) > 0
)
UPDATE google_ads_credentials g
SET
  client_id = CASE
    WHEN NULLIF(TRIM(g.client_id), '') IS NULL AND l.client_id IS NOT NULL THEN l.client_id
    ELSE g.client_id
  END,
  client_secret = CASE
    WHEN NULLIF(TRIM(g.client_secret), '') IS NULL AND l.client_secret IS NOT NULL THEN l.client_secret
    ELSE g.client_secret
  END,
  developer_token = CASE
    WHEN NULLIF(TRIM(g.developer_token), '') IS NULL AND l.developer_token IS NOT NULL THEN l.developer_token
    ELSE g.developer_token
  END,
  login_customer_id = CASE
    WHEN NULLIF(TRIM(g.login_customer_id), '') IS NULL AND l.login_customer_id IS NOT NULL THEN l.login_customer_id
    ELSE g.login_customer_id
  END,
  is_active = TRUE,
  updated_at = CURRENT_TIMESTAMP
FROM legacy l
WHERE g.user_id = l.user_id;

DELETE FROM system_settings
WHERE category = 'google_ads'
  AND user_id IS NOT NULL
  AND key IN ('login_customer_id', 'client_id', 'client_secret', 'developer_token');
