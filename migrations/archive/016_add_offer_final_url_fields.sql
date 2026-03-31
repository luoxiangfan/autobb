-- Migration: 016_add_offer_final_url_fields
-- Description: 添加final_url和final_url_suffix字段到offers表
-- 用于存储解析后的最终落地页URL（去除参数）和URL后缀（查询参数）
-- Date: 2024-11-22

-- 添加final_url字段：存储解析后的最终URL（不含查询参数）
-- 例如：https://amazon.com/stores/page/ABC
ALTER TABLE offers ADD COLUMN final_url TEXT;

-- 添加final_url_suffix字段：存储查询参数（不含?）
-- 例如：maas=XXX&aa_campaignid=YYY&utm_source=google
ALTER TABLE offers ADD COLUMN final_url_suffix TEXT;

-- 添加索引以支持按final_url查询
CREATE INDEX IF NOT EXISTS idx_offers_final_url ON offers(final_url);
