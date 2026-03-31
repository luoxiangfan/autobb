-- 添加 API 访问级别字段 (PostgreSQL)
-- 支持三种权限级别：
-- - Test: 0次/天（只能访问测试账号）
-- - Explorer: 2,880次/天（默认权限）
-- - Basic: 15,000次/天（生产环境）

-- 为 google_ads_credentials 表添加 api_access_level 字段
ALTER TABLE google_ads_credentials
ADD COLUMN api_access_level TEXT DEFAULT 'explorer' CHECK (api_access_level IN ('test', 'explorer', 'basic'));

-- 为 google_ads_service_accounts 表添加 api_access_level 字段
ALTER TABLE google_ads_service_accounts
ADD COLUMN api_access_level TEXT DEFAULT 'explorer' CHECK (api_access_level IN ('test', 'explorer', 'basic'));
