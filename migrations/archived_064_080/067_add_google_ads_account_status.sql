-- Migration: 067_add_google_ads_account_status.sql
-- Description: 添加 status 字段到 google_ads_accounts 表
-- Date: 2025-12-10
--
-- 变更内容:
-- 1. 添加 status 字段，记录 Google Ads 账户在 Google 端的真实状态
-- 2. 状态值: ENABLED(启用), CANCELED(已取消), SUSPENDED(已暂停), CLOSED(已关闭)
-- 3. 默认值为 ENABLED，现有账户初始化为 ENABLED

-- 添加 status 字段
ALTER TABLE google_ads_accounts ADD COLUMN status TEXT DEFAULT 'ENABLED';

-- 将现有账户的 status 设置为 ENABLED（假设现有账户都是正常的）
UPDATE google_ads_accounts SET status = 'ENABLED' WHERE status IS NULL;
