-- Migration: 017_add_creative_final_url_suffix
-- Description: 添加final_url_suffix字段到creatives表
-- Date: 2024-11-22

-- 添加final_url_suffix字段
ALTER TABLE creatives ADD COLUMN final_url_suffix TEXT;
