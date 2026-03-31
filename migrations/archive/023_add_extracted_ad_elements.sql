-- Migration: Add extracted ad elements fields to offers table
-- Purpose: Store extracted keywords, headlines, descriptions from scraping phase
-- Date: 2025-11-24

-- Add fields for extracted ad elements
ALTER TABLE offers ADD COLUMN extracted_keywords TEXT; -- JSON array with metadata
ALTER TABLE offers ADD COLUMN extracted_headlines TEXT; -- JSON array of 15 headlines
ALTER TABLE offers ADD COLUMN extracted_descriptions TEXT; -- JSON array of 4 descriptions
ALTER TABLE offers ADD COLUMN extraction_metadata TEXT; -- JSON object with sources, product count, etc.
ALTER TABLE offers ADD COLUMN extracted_at TEXT; -- ISO timestamp of extraction

-- Notes:
-- 1. extracted_keywords format: [{"keyword": "...", "source": "product_title|google_suggest|brand_variant", "searchVolume": 1000, "priority": "HIGH|MEDIUM|LOW"}]
-- 2. extracted_headlines format: ["headline1", "headline2", ...] (15 items, ≤30 chars each)
-- 3. extracted_descriptions format: ["desc1", "desc2", "desc3", "desc4"] (4 items, ≤90 chars each)
-- 4. extraction_metadata format: {"productCount": 1, "keywordSources": {"product_title": 3, "google_suggest": 5}, "topProducts": [...]}
-- 5. extracted_at format: ISO 8601 datetime string
