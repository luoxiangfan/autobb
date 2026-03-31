-- 添加reviews和competitive_edges字段到offers表
-- 这些字段在offers.ts的updateOfferScrapeStatus中使用

ALTER TABLE offers ADD COLUMN reviews TEXT;
ALTER TABLE offers ADD COLUMN competitive_edges TEXT;
