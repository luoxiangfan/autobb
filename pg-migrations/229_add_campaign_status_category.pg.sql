-- 添加广告系列状态分类字段 (PostgreSQL)
-- 用于标识广告系列的运营状态：待定/观察/合格

ALTER TABLE campaigns ADD COLUMN status_category TEXT NOT NULL DEFAULT 'pending';

-- 添加索引以优化按状态筛选
CREATE INDEX IF NOT EXISTS idx_campaigns_status_category ON campaigns(status_category);
