-- 添加reviews和competitive_edges字段到offers表
-- 这些字段在offers.ts的updateOfferScrapeStatus中使用

ALTER TABLE offers ADD COLUMN IF NOT EXISTS reviews TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS competitive_edges TEXT;
