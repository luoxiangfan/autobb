-- 添加广告系列自定义名称字段 (PostgreSQL)
-- 允许用户为广告系列设置自定义显示名称，与 campaign_name 区分

ALTER TABLE campaigns ADD COLUMN custom_name TEXT;

-- 添加索引以优化按自定义名称搜索
CREATE INDEX IF NOT EXISTS idx_campaigns_custom_name ON campaigns(custom_name);
