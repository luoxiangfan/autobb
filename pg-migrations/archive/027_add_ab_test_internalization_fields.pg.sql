-- ==========================================
-- Migration: A/B测试内化到发布和优化流程 (PostgreSQL version)
-- 版本：027
-- 日期：2025-12-02
-- 描述：为ab_tests表添加自动测试相关字段
-- ==========================================

-- 1. 添加 is_auto_test 字段（是否为自动测试）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ab_tests' AND column_name = 'is_auto_test'
  ) THEN
    ALTER TABLE ab_tests ADD COLUMN is_auto_test BOOLEAN DEFAULT TRUE;
    RAISE NOTICE '✅ 添加 is_auto_test 字段';
  ELSE
    RAISE NOTICE '⏭️  is_auto_test 字段已存在';
  END IF;
END $$;

-- 2. 添加 test_mode 字段（测试模式）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ab_tests' AND column_name = 'test_mode'
  ) THEN
    ALTER TABLE ab_tests ADD COLUMN test_mode TEXT DEFAULT 'manual'
      CHECK(test_mode IN ('launch_multi_variant', 'optimization_challenge', 'manual'));
    RAISE NOTICE '✅ 添加 test_mode 字段';
  ELSE
    RAISE NOTICE '⏭️  test_mode 字段已存在';
  END IF;
END $$;

-- 3. 添加 parent_campaign_id 字段（关联的父Campaign）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ab_tests' AND column_name = 'parent_campaign_id'
  ) THEN
    ALTER TABLE ab_tests ADD COLUMN parent_campaign_id INTEGER REFERENCES campaigns(id) ON DELETE SET NULL;
    CREATE INDEX IF NOT EXISTS idx_ab_tests_parent_campaign ON ab_tests(parent_campaign_id);
    RAISE NOTICE '✅ 添加 parent_campaign_id 字段及索引';
  ELSE
    RAISE NOTICE '⏭️  parent_campaign_id 字段已存在';
  END IF;
END $$;

-- 4. 添加 test_dimension 字段（测试维度：creative=创意维度 | strategy=投放策略维度）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ab_tests' AND column_name = 'test_dimension'
  ) THEN
    ALTER TABLE ab_tests ADD COLUMN test_dimension TEXT DEFAULT 'creative'
      CHECK(test_dimension IN ('creative', 'strategy'));
    RAISE NOTICE '✅ 添加 test_dimension 字段';
  ELSE
    RAISE NOTICE '⏭️  test_dimension 字段已存在';
  END IF;
END $$;

-- 5. 迁移旧的test_type数据（将image/cta改为full_creative）
UPDATE ab_tests
SET test_type = 'full_creative'
WHERE test_type IN ('image', 'cta');

-- 6. 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('027_add_ab_test_internalization_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;

-- ==========================================
-- 说明
-- ==========================================
-- ab_tests表新字段:
--   - is_auto_test: 是否为自动测试（true=自动，false=手动）
--   - test_mode: 测试模式
--       * launch_multi_variant: 发布时多变体测试
--       * optimization_challenge: 优化时挑战测试
--       * manual: 手动测试
--   - parent_campaign_id: 关联的父Campaign ID（用于优化测试）
--   - test_dimension: 测试维度
--       * creative: 创意维度测试（找到表现最好的广告创意）
--       * strategy: 投放策略维度测试（降低CPC，获得更多点击）
-- ==========================================
