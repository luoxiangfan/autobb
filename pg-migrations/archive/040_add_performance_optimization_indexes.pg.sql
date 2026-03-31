-- 040_add_performance_optimization_indexes.sql
-- 添加性能优化索引，提升高频查询效率

-- 1. ad_creative_performance: 创意性能查询优化
-- 用于按creative聚合性能数据的查询
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_creative_sync
ON ad_creative_performance(ad_creative_id, sync_date DESC);

-- 2. optimization_tasks: 按用户和状态查询任务列表
-- 用于任务管理界面的查询
CREATE INDEX IF NOT EXISTS idx_optimization_tasks_user_status_created
ON optimization_tasks(user_id, status, created_at DESC);

-- 3. campaign_performance: 广告活动性能聚合
-- 用于dashboard和报表的性能数据查询
CREATE INDEX IF NOT EXISTS idx_campaign_performance_campaign_date
ON campaign_performance(campaign_id, date DESC, user_id);

-- 4. campaigns: 按账户和状态查询广告活动
-- 用于按Google Ads账户筛选广告活动
CREATE INDEX IF NOT EXISTS idx_campaigns_account_status
ON campaigns(google_ads_account_id, status, created_at DESC);

-- 5. ad_creatives: 按offer查询创意
-- 用于创意管理和A/B测试
CREATE INDEX IF NOT EXISTS idx_ad_creatives_offer_created
ON ad_creatives(offer_id, created_at DESC);


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('040_add_performance_optimization_indexes.pg')
ON CONFLICT (migration_name) DO NOTHING;
