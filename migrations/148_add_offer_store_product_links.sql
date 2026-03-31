-- Migration 148: add store product links and page_type to offer tasks
ALTER TABLE offers ADD COLUMN store_product_links TEXT;
ALTER TABLE offer_tasks ADD COLUMN page_type TEXT;
ALTER TABLE offer_tasks ADD COLUMN store_product_links TEXT;
