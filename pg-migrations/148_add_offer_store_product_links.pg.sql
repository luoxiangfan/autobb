-- Migration 148: add store product links and page_type to offer tasks (PostgreSQL)
ALTER TABLE offers ADD COLUMN IF NOT EXISTS store_product_links TEXT;
ALTER TABLE offer_tasks ADD COLUMN IF NOT EXISTS page_type TEXT;
ALTER TABLE offer_tasks ADD COLUMN IF NOT EXISTS store_product_links TEXT;
