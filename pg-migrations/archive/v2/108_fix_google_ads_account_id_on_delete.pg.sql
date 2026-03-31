-- Migration: 108_fix_google_ads_account_id_on_delete
-- Date: 2025-12-25
-- Description: 修改google_ads_account_id外键约束，删除Ads账号时保留历史数据，设为NULL
-- Tables affected: campaigns, weekly_recommendations, optimization_recommendations, sync_logs

-- PostgreSQL支持ALTER TABLE FOREIGN KEY，比SQLite简单

-- =============================================================================
-- 1. campaigns 表
-- =============================================================================

-- 步骤1.1: 删除旧的外键约束
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_google_ads_account_id_fkey;

-- 步骤1.2: 先将列设为可空（如果之前是NOT NULL）
ALTER TABLE campaigns ALTER COLUMN google_ads_account_id DROP NOT NULL;

-- 步骤1.3: 添加新的外键约束（SET NULL）
ALTER TABLE campaigns
ADD CONSTRAINT campaigns_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;

-- =============================================================================
-- 2. weekly_recommendations 表
-- =============================================================================

ALTER TABLE weekly_recommendations DROP CONSTRAINT IF EXISTS weekly_recommendations_google_ads_account_id_fkey;
ALTER TABLE weekly_recommendations ALTER COLUMN google_ads_account_id DROP NOT NULL;

ALTER TABLE weekly_recommendations
ADD CONSTRAINT weekly_recommendations_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;

-- =============================================================================
-- 3. optimization_recommendations 表
-- =============================================================================

ALTER TABLE optimization_recommendations DROP CONSTRAINT IF EXISTS optimization_recommendations_google_ads_account_id_fkey;
ALTER TABLE optimization_recommendations ALTER COLUMN google_ads_account_id DROP NOT NULL;

ALTER TABLE optimization_recommendations
ADD CONSTRAINT optimization_recommendations_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;

-- =============================================================================
-- 4. sync_logs 表
-- =============================================================================

ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_google_ads_account_id_fkey;
ALTER TABLE sync_logs ALTER COLUMN google_ads_account_id DROP NOT NULL;

ALTER TABLE sync_logs
ADD CONSTRAINT sync_logs_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;
