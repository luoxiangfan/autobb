-- 048_remove_redundant_offer_fields.sql
-- Remove redundant fields: pricing, reviews, competitive_edges
-- Rationale: Data is duplicated in scraped_data and *_analysis fields
--
-- ============================================================
-- SQLite Status: NO ACTION NEEDED
-- ============================================================
-- These fields were never added to the SQLite database:
-- - pricing: Not in schema
-- - reviews: Migration 043 created but never executed
-- - competitive_edges: Migration 043 created but never executed
--
-- Current SQLite schema already clean (verified via PRAGMA table_info)
-- ============================================================

-- No migration needed for SQLite
-- See PostgreSQL migration (048_remove_redundant_offer_fields.pg.sql) for actual changes

SELECT 'SQLite: No action needed - fields do not exist in table' as status;
