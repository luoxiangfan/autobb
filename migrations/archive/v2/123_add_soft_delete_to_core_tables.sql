-- ============================================
-- 迁移编号：123
-- 标题：为核心表添加软删除支持
-- 日期：2025-12-29
-- 数据库：SQLite
-- 描述：为 ad_creatives, google_ads_accounts, scraped_products 添加软删除
-- ============================================

-- ✅ 幂等性保证：ALTER TABLE 在列已存在时会报错，但不影响后续操作

-- ==========================================
-- 1. ad_creatives - 广告创意软删除
-- ==========================================

-- 1.1 添加 is_deleted 列
-- 理由：防止创意performance数据丢失，保留创意效果分析历史
ALTER TABLE ad_creatives
ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- 1.2 添加 deleted_at 列（记录删除时间）
ALTER TABLE ad_creatives
ADD COLUMN deleted_at TIMESTAMP NULL;

-- 1.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_ad_creatives_user_is_deleted
ON ad_creatives(user_id, is_deleted, created_at DESC);

-- ==========================================
-- 2. google_ads_accounts - Google Ads账户软删除
-- ==========================================

-- 2.1 添加 is_deleted 列
-- 理由：防止campaigns关联断裂，保留账户级别performance统计
ALTER TABLE google_ads_accounts
ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- 2.2 添加 deleted_at 列（记录删除时间）
ALTER TABLE google_ads_accounts
ADD COLUMN deleted_at TIMESTAMP NULL;

-- 2.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_user_is_deleted
ON google_ads_accounts(user_id, is_deleted);

-- ==========================================
-- 3. scraped_products - 抓取产品数据软删除
-- ==========================================

-- 3.1 添加 is_deleted 列
-- 理由：保留产品抓取历史，用于数据变化趋势分析
ALTER TABLE scraped_products
ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- 3.2 添加 deleted_at 列（记录删除时间）
ALTER TABLE scraped_products
ADD COLUMN deleted_at TIMESTAMP NULL;

-- 3.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_scraped_products_is_deleted
ON scraped_products(is_deleted, created_at DESC);

-- ==========================================
-- 4. 数据验证
-- ==========================================

-- 验证：检查是否有记录没有正确设置is_deleted字段
SELECT 'Data Validation: ad_creatives without is_deleted field' AS check_name,
       COUNT(*) as count
FROM ad_creatives
WHERE is_deleted IS NULL;

SELECT 'Data Validation: google_ads_accounts without is_deleted field' AS check_name,
       COUNT(*) as count
FROM google_ads_accounts
WHERE is_deleted IS NULL;

SELECT 'Data Validation: scraped_products without is_deleted field' AS check_name,
       COUNT(*) as count
FROM scraped_products
WHERE is_deleted IS NULL;

-- ==========================================
-- 5. 修复NULL值（防御性修复）
-- ==========================================

-- 将NULL is_deleted字段设置为0（未删除）
UPDATE ad_creatives
SET is_deleted = 0
WHERE is_deleted IS NULL;

UPDATE google_ads_accounts
SET is_deleted = 0
WHERE is_deleted IS NULL;

UPDATE scraped_products
SET is_deleted = 0
WHERE is_deleted IS NULL;

-- ==========================================
-- 6. 最终验证
-- ==========================================

SELECT 'SUCCESS: Migration 123 completed' AS result,
       (SELECT COUNT(*) FROM ad_creatives WHERE is_deleted = 1) as deleted_ad_creatives,
       (SELECT COUNT(*) FROM google_ads_accounts WHERE is_deleted = 1) as deleted_accounts,
       (SELECT COUNT(*) FROM scraped_products WHERE is_deleted = 1) as deleted_products;
