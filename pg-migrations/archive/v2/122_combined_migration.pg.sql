-- ============================================
-- PostgreSQL 迁移编号：122
-- 标题：软删除机制修复
-- 日期：2025-12-29
-- 数据库：PostgreSQL
-- 描述：为campaigns表添加软删除支持
-- ============================================

-- ✅ 幂等性保证：使用 IF NOT EXISTS 和条件检查，确保可以安全重复执行

-- ==========================================
-- 软删除机制修复
-- ==========================================

-- 问题背景：
-- 1. Campaign删除使用了DELETE而非软删除，导致performance数据级联删除
-- 2. 统计查询不一致：部分过滤is_deleted，部分不过滤
-- 3. 已删除的campaigns无法体现在历史统计数据中

-- 修复内容：
-- 1. ✅ 添加 is_deleted 列到 campaigns 表（如果不存在）
-- 2. ✅ 代码层面：campaigns.ts deleteCampaign改为UPDATE软删除
-- 3. ✅ 代码层面：所有查询API统一处理is_deleted过滤
-- 4. 🔧 数据库层面：添加索引优化软删除查询性能
-- 5. 📊 数据验证：检查现有数据一致性

-- 1. 添加 is_deleted 列到 campaigns 表（PostgreSQL 幂等性处理）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE campaigns
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ Part 1: 已添加 campaigns.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  Part 1: campaigns.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 2. 添加 deleted_at 列到 campaigns 表（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE campaigns
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ Part 2: 已添加 campaigns.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  Part 2: campaigns.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 3. 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_campaigns_user_is_deleted
ON campaigns(user_id, is_deleted, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offers_user_is_deleted
ON offers(user_id, is_deleted);

-- 4. 数据验证和统计
DO $$
DECLARE
  null_count INTEGER;
  deleted_campaigns INTEGER;
  deleted_offers INTEGER;
  perf_count INTEGER;
BEGIN
  -- 检查NULL值
  SELECT COUNT(*) INTO null_count
  FROM campaigns
  WHERE is_deleted IS NULL;

  RAISE NOTICE 'Part 4: Data Validation - Campaigns without is_deleted field: %', null_count;

  -- 统计软删除数量
  SELECT COUNT(*) INTO deleted_campaigns
  FROM campaigns
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Part 4: Statistics - Soft-deleted campaigns: %', deleted_campaigns;

  SELECT COUNT(*) INTO deleted_offers
  FROM offers
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Part 4: Statistics - Soft-deleted offers: %', deleted_offers;

  -- 检查已删除campaigns的performance数据
  SELECT COUNT(DISTINCT cp.campaign_id) INTO perf_count
  FROM campaign_performance cp
  INNER JOIN campaigns c ON cp.campaign_id = c.id
  WHERE c.is_deleted = TRUE;

  RAISE NOTICE 'Part 4: Performance data for deleted campaigns: %', perf_count;
END $$;

-- 5. 修复NULL值（防御性修复）
UPDATE campaigns
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE offers
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

-- 6. 最终验证
DO $$
DECLARE
  deleted_campaigns INTEGER;
  deleted_offers INTEGER;
  total_performance INTEGER;
BEGIN
  SELECT COUNT(*) INTO deleted_campaigns FROM campaigns WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO deleted_offers FROM offers WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO total_performance FROM campaign_performance;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUCCESS: Migration 122 completed';
  RAISE NOTICE 'Deleted campaigns: %', deleted_campaigns;
  RAISE NOTICE 'Deleted offers: %', deleted_offers;
  RAISE NOTICE 'Total performance records: %', total_performance;
  RAISE NOTICE '========================================';
END $$;
