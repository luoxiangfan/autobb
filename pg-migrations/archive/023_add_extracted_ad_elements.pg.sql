-- Migration: Add extracted ad elements fields to offers table
-- Purpose: Store extracted keywords, headlines, descriptions from scraping phase
-- Date: 2025-11-24

-- Add fields for extracted ad elements

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'extracted_keywords') THEN
    ALTER TABLE offers ADD COLUMN extracted_keywords TEXT;
    RAISE NOTICE '✅ 添加 extracted_keywords 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  extracted_keywords 字段已存在于 offers';
  END IF;
END $$; -- JSON array with metadata

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'extracted_headlines') THEN
    ALTER TABLE offers ADD COLUMN extracted_headlines TEXT;
    RAISE NOTICE '✅ 添加 extracted_headlines 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  extracted_headlines 字段已存在于 offers';
  END IF;
END $$; -- JSON array of 15 headlines

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'extracted_descriptions') THEN
    ALTER TABLE offers ADD COLUMN extracted_descriptions TEXT;
    RAISE NOTICE '✅ 添加 extracted_descriptions 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  extracted_descriptions 字段已存在于 offers';
  END IF;
END $$; -- JSON array of 4 descriptions

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'extraction_metadata') THEN
    ALTER TABLE offers ADD COLUMN extraction_metadata TEXT;
    RAISE NOTICE '✅ 添加 extraction_metadata 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  extraction_metadata 字段已存在于 offers';
  END IF;
END $$; -- JSON object with sources, product count, etc.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'extracted_at') THEN
    ALTER TABLE offers ADD COLUMN extracted_at TEXT;
    RAISE NOTICE '✅ 添加 extracted_at 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  extracted_at 字段已存在于 offers';
  END IF;
END $$; -- ISO timestamp of extraction

-- Notes:
-- 1. extracted_keywords format: [{"keyword": "...", "source": "product_title|google_suggest|brand_variant", "searchVolume": 1000, "priority": "HIGH|MEDIUM|LOW"}]
-- 2. extracted_headlines format: ["headline1", "headline2", ...] (15 items, ≤30 chars each)
-- 3. extracted_descriptions format: ["desc1", "desc2", "desc3", "desc4"] (4 items, ≤90 chars each)
-- 4. extraction_metadata format: {"productCount": 1, "keywordSources": {"product_title": 3, "google_suggest": 5}, "topProducts": [...]}
-- 5. extracted_at format: ISO 8601 datetime string


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('023_add_extracted_ad_elements.pg')
ON CONFLICT (migration_name) DO NOTHING;
