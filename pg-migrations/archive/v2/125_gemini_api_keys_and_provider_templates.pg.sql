-- Migration: 125_gemini_api_keys_and_provider_templates.pg.sql
-- Description: 添加 gemini_relay_api_key 字段和补充全局模板记录
-- Date: 2025-12-30
-- 遵循 docs/BasicPrinciples/MustKnowV1.md 第31条：模板+实例双层架构
--
-- 包含：
-- 1. 添加 gemini_relay_api_key 列和全局模板
-- 2. 补充 gemini_provider 和 gemini_endpoint 全局模板

DO $$
DECLARE
  column_exists BOOLEAN;
BEGIN
  -- ============================================
  -- 第一部分：添加 gemini_relay_api_key 字段
  -- ============================================

  -- 1. 检查并添加字段
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings'
      AND column_name = 'gemini_relay_api_key'
  ) INTO column_exists;

  IF NOT column_exists THEN
    ALTER TABLE system_settings ADD COLUMN gemini_relay_api_key TEXT DEFAULT NULL;
    RAISE NOTICE 'Added column gemini_relay_api_key';
  ELSE
    RAISE NOTICE 'Column gemini_relay_api_key already exists, skipping';
  END IF;

  -- 2. 添加字段注释
  COMMENT ON COLUMN system_settings.gemini_relay_api_key IS '第三方中转服务 API Key（用于 relay 服务商）';

  -- 3. 插入全局模板记录（user_id=NULL, value=NULL）
  -- PostgreSQL: INSERT ... WHERE NOT EXISTS 实现幂等插入，布尔值使用 false/true
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_relay_api_key', NULL, 'string', true, false, '第三方中转服务 API Key'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_relay_api_key'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_relay_api_key inserted or already exists';

  -- ============================================
  -- 第二部分：补充 gemini_provider 和 gemini_endpoint 全局模板
  -- ============================================

  -- 4. 插入 gemini_provider 全局模板
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_provider', NULL, 'string', false, false, 'Gemini API 服务商（official/relay/vertex）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_provider'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_provider inserted or already exists';

  -- 5. 插入 gemini_endpoint 全局模板
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_endpoint', NULL, 'string', false, false, 'Gemini API 端点（系统自动计算）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_endpoint'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_endpoint inserted or already exists';
END $$;

-- ============================================
-- 第三部分：创建索引（加速查询）
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'system_settings'
      AND indexname = 'idx_system_settings_gemini_relay_api_key'
  ) THEN
    CREATE INDEX idx_system_settings_gemini_relay_api_key
    ON system_settings(category, key) WHERE gemini_relay_api_key IS NOT NULL;
    RAISE NOTICE 'Created index idx_system_settings_gemini_relay_api_key';
  END IF;
END $$;

-- ============================================
-- 第四部分：验证迁移结果
-- ============================================

DO $$
DECLARE
  template_count INTEGER;
  user_config_count INTEGER;
BEGIN
  -- 检查 AI 分类的全局模板数量
  SELECT COUNT(*) INTO template_count
  FROM system_settings
  WHERE user_id IS NULL
    AND value IS NULL
    AND category = 'ai';

  -- 检查用户配置
  SELECT COUNT(*) INTO user_config_count
  FROM system_settings
  WHERE user_id IS NOT NULL
    AND category = 'ai'
    AND key = 'gemini_relay_api_key'
    AND value IS NOT NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 125 complete:';
  RAISE NOTICE '  - AI global templates: %', template_count;
  RAISE NOTICE '  - gemini_relay_api_key user configs: %', user_config_count;
  RAISE NOTICE '========================================';
END $$;
