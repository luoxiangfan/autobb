-- 255: 移除未使用的 Google Ads 测试 MCC OAuth（google_ads_test_credentials）
DROP TABLE IF EXISTS google_ads_test_credentials;

DELETE FROM system_settings
WHERE category = 'google_ads'
  AND key IN (
    'test_login_customer_id',
    'test_client_id',
    'test_client_secret',
    'test_developer_token'
  )
  AND user_id IS NULL;
