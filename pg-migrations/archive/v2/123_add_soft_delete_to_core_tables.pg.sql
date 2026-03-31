-- ============================================
-- PostgreSQL 迁移编号：123
-- 标题：为核心表添加软删除支持
-- 日期：2025-12-29
-- 数据库：PostgreSQL
-- 描述：为 ad_creatives, google_ads_accounts, scraped_products 添加软删除
-- ============================================

-- ✅ 幂等性保证：使用 IF NOT EXISTS 和条件检查，确保可以安全重复执行

-- ==========================================
-- 1. ad_creatives - 广告创意软删除
-- ==========================================

-- 1.1 添加 is_deleted 列
-- 理由：防止创意performance数据丢失，保留创意效果分析历史
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE ad_creatives
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ 1.1: 已添加 ad_creatives.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  1.1: ad_creatives.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 1.2 添加 deleted_at 列（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE ad_creatives
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ 1.2: 已添加 ad_creatives.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  1.2: ad_creatives.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 1.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_ad_creatives_user_is_deleted
ON ad_creatives(user_id, is_deleted, created_at DESC);

-- ==========================================
-- 2. google_ads_accounts - Google Ads账户软删除
-- ==========================================

-- 2.1 添加 is_deleted 列
-- 理由：防止campaigns关联断裂，保留账户级别performance统计
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_accounts' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE google_ads_accounts
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ 2.1: 已添加 google_ads_accounts.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  2.1: google_ads_accounts.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 2.2 添加 deleted_at 列（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_accounts' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE google_ads_accounts
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ 2.2: 已添加 google_ads_accounts.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  2.2: google_ads_accounts.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 2.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_user_is_deleted
ON google_ads_accounts(user_id, is_deleted);

-- ==========================================
-- 3. scraped_products - 抓取产品数据软删除
-- ==========================================

-- 3.1 添加 is_deleted 列
-- 理由：保留产品抓取历史，用于数据变化趋势分析
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE scraped_products
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ 3.1: 已添加 scraped_products.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  3.1: scraped_products.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 3.2 添加 deleted_at 列（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE scraped_products
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ 3.2: 已添加 scraped_products.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  3.2: scraped_products.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 3.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_scraped_products_is_deleted
ON scraped_products(is_deleted, created_at DESC);

-- ==========================================
-- 4. 数据验证
-- ==========================================

DO $$
DECLARE
  null_creatives INTEGER;
  null_accounts INTEGER;
  null_products INTEGER;
BEGIN
  -- 检查NULL值
  SELECT COUNT(*) INTO null_creatives
  FROM ad_creatives
  WHERE is_deleted IS NULL;

  SELECT COUNT(*) INTO null_accounts
  FROM google_ads_accounts
  WHERE is_deleted IS NULL;

  SELECT COUNT(*) INTO null_products
  FROM scraped_products
  WHERE is_deleted IS NULL;

  RAISE NOTICE 'Part 4: Data Validation - ad_creatives without is_deleted: %', null_creatives;
  RAISE NOTICE 'Part 4: Data Validation - google_ads_accounts without is_deleted: %', null_accounts;
  RAISE NOTICE 'Part 4: Data Validation - scraped_products without is_deleted: %', null_products;
END $$;

-- ==========================================
-- 5. 修复NULL值（防御性修复）
-- ==========================================

UPDATE ad_creatives
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE google_ads_accounts
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE scraped_products
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

-- ==========================================
-- 6. 最终验证
-- ==========================================

DO $$
DECLARE
  deleted_creatives INTEGER;
  deleted_accounts INTEGER;
  deleted_products INTEGER;
BEGIN
  SELECT COUNT(*) INTO deleted_creatives FROM ad_creatives WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO deleted_accounts FROM google_ads_accounts WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO deleted_products FROM scraped_products WHERE is_deleted = TRUE;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUCCESS: Migration 123 completed';
  RAISE NOTICE 'Deleted ad_creatives: %', deleted_creatives;
  RAISE NOTICE 'Deleted google_ads_accounts: %', deleted_accounts;
  RAISE NOTICE 'Deleted scraped_products: %', deleted_products;
  RAISE NOTICE '========================================';
END $$;
