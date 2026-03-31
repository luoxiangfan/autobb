-- Migration: Add enhanced extraction fields to offers table (PostgreSQL version)
-- Purpose: Store AI-enhanced analysis results (P0/P1/P2/P3 optimization features)
-- Date: 2025-12-01

-- P0优化: 增强的关键词和产品信息
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'enhanced_keywords') THEN
    ALTER TABLE offers ADD COLUMN enhanced_keywords TEXT;
    RAISE NOTICE '✅ 添加 enhanced_keywords 字段';
  ELSE
    RAISE NOTICE '⏭️  enhanced_keywords 字段已存在';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'enhanced_product_info') THEN
    ALTER TABLE offers ADD COLUMN enhanced_product_info TEXT;
    RAISE NOTICE '✅ 添加 enhanced_product_info 字段';
  ELSE
    RAISE NOTICE '⏭️  enhanced_product_info 字段已存在';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'enhanced_review_analysis') THEN
    ALTER TABLE offers ADD COLUMN enhanced_review_analysis TEXT;
    RAISE NOTICE '✅ 添加 enhanced_review_analysis 字段';
  ELSE
    RAISE NOTICE '⏭️  enhanced_review_analysis 字段已存在';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'extraction_quality_score') THEN
    ALTER TABLE offers ADD COLUMN extraction_quality_score INTEGER;
    RAISE NOTICE '✅ 添加 extraction_quality_score 字段';
  ELSE
    RAISE NOTICE '⏭️  extraction_quality_score 字段已存在';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'extraction_enhanced_at') THEN
    ALTER TABLE offers ADD COLUMN extraction_enhanced_at TIMESTAMP;
    RAISE NOTICE '✅ 添加 extraction_enhanced_at 字段';
  ELSE
    RAISE NOTICE '⏭️  extraction_enhanced_at 字段已存在';
  END IF;
END $$;

-- P1优化: 增强的标题和描述
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'enhanced_headlines') THEN
    ALTER TABLE offers ADD COLUMN enhanced_headlines TEXT;
    RAISE NOTICE '✅ 添加 enhanced_headlines 字段';
  ELSE
    RAISE NOTICE '⏭️  enhanced_headlines 字段已存在';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'enhanced_descriptions') THEN
    ALTER TABLE offers ADD COLUMN enhanced_descriptions TEXT;
    RAISE NOTICE '✅ 添加 enhanced_descriptions 字段';
  ELSE
    RAISE NOTICE '⏭️  enhanced_descriptions 字段已存在';
  END IF;
END $$;

-- P2优化: 本地化适配
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'localization_adapt') THEN
    ALTER TABLE offers ADD COLUMN localization_adapt TEXT;
    RAISE NOTICE '✅ 添加 localization_adapt 字段';
  ELSE
    RAISE NOTICE '⏭️  localization_adapt 字段已存在';
  END IF;
END $$;

-- P3优化: 品牌分析
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'brand_analysis') THEN
    ALTER TABLE offers ADD COLUMN brand_analysis TEXT;
    RAISE NOTICE '✅ 添加 brand_analysis 字段';
  ELSE
    RAISE NOTICE '⏭️  brand_analysis 字段已存在';
  END IF;
END $$;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_offers_extraction_quality ON offers(extraction_quality_score);
CREATE INDEX IF NOT EXISTS idx_offers_enhanced_at ON offers(extraction_enhanced_at);

-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('024_add_enhanced_extraction_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;
