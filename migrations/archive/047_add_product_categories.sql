-- Migration 047: Add product_categories column for Phase 2 Store Metadata Enhancement
-- Purpose: Store product category metadata from Amazon store pages to improve ad creative quality
-- Reference: STORE_DATA_FLOW_AUDIT_REPORT.md Phase 2 - Store Metadata Enhancement
-- Data Type: TEXT (JSON-serialized) for flexibility with varying category structures

-- Add product_categories column to offers table
ALTER TABLE offers ADD COLUMN product_categories TEXT;

-- Create index for filtering offers with category data
-- This enables efficient queries to find offers that have category metadata
CREATE INDEX idx_offers_product_categories ON offers(product_categories)
WHERE product_categories IS NOT NULL;

-- Example JSON structure stored in this column:
-- {
--   "primaryCategories": [
--     {"name": "Security Cameras", "count": 0, "url": "/s?node=123456"},
--     {"name": "Smart Home Devices", "count": 0, "url": "/s?node=789012"}
--   ],
--   "totalCategories": 2
-- }
