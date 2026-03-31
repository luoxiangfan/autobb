-- 048_remove_redundant_offer_fields.pg.sql
-- Remove redundant fields from offers table
-- Rationale: Data is duplicated in scraped_data and *_analysis fields
--
-- Fields to remove:
-- - pricing: Duplicates scraped_data (productPrice, originalPrice, discount)
--            AI-inferred data less reliable than raw scraped data
--
-- Note: reviews and competitive_edges don't exist in PostgreSQL schema

BEGIN;

-- Remove pricing column (PostgreSQL supports ALTER TABLE DROP COLUMN)
ALTER TABLE offers DROP COLUMN IF EXISTS pricing;

-- Verification: Check remaining analysis fields
SELECT
  COUNT(*) as total_offers,
  COUNT(scraped_data) as has_scraped_data,
  COUNT(review_analysis) as has_review_analysis,
  COUNT(competitor_analysis) as has_competitor_analysis
FROM offers;

COMMIT;
