-- 数据库性能索引优化迁移
-- 日期：2025-11-18
-- 目的：添加缺失的索引以优化常见查询性能

-- ============================================
-- Offers表索引优化
-- ============================================

-- 用于列表查询过滤（is_active）
CREATE INDEX IF NOT EXISTS idx_offers_is_active
ON offers(is_active);

-- 用于按国家过滤
CREATE INDEX IF NOT EXISTS idx_offers_target_country
ON offers(target_country);

-- 用于排序和范围查询
CREATE INDEX IF NOT EXISTS idx_offers_created_at
ON offers(created_at DESC);

-- 复合索引：用于常见的过滤+排序查询（user_id + is_active + created_at）
CREATE INDEX IF NOT EXISTS idx_offers_user_active_created
ON offers(user_id, is_active, created_at DESC);

-- 用于爬取状态过滤
CREATE INDEX IF NOT EXISTS idx_offers_scrape_status
ON offers(scrape_status);

-- ============================================
-- Creatives表索引优化
-- ============================================

-- 用于列表查询（缺失的user_id索引）
CREATE INDEX IF NOT EXISTS idx_creatives_user_id
ON creatives(user_id);

-- 用于审批状态过滤
CREATE INDEX IF NOT EXISTS idx_creatives_is_approved
ON creatives(is_approved);

-- 用于排序
CREATE INDEX IF NOT EXISTS idx_creatives_created_at
ON creatives(created_at DESC);

-- 复合索引：user_id + offer_id + is_approved（常见查询组合）
CREATE INDEX IF NOT EXISTS idx_creatives_user_offer_approved
ON creatives(user_id, offer_id, is_approved);

-- ============================================
-- Campaigns表索引优化
-- ============================================

-- 用于状态过滤（Dashboard常用）
CREATE INDEX IF NOT EXISTS idx_campaigns_status
ON campaigns(status);

-- 用于排序
CREATE INDEX IF NOT EXISTS idx_campaigns_created_at
ON campaigns(created_at DESC);

-- 复合索引：user_id + status（Dashboard KPI查询）
CREATE INDEX IF NOT EXISTS idx_campaigns_user_status
ON campaigns(user_id, status);

-- 用于Google Ads账号关联查询
CREATE INDEX IF NOT EXISTS idx_campaigns_google_ads_account
ON campaigns(google_ads_account_id);

-- ============================================
-- Launch Scores表索引优化
-- ============================================

-- 用于用户查询
CREATE INDEX IF NOT EXISTS idx_launch_scores_user_id
ON launch_scores(user_id);

-- 用于Offer关联查询和排序
CREATE INDEX IF NOT EXISTS idx_launch_scores_offer_calculated
ON launch_scores(offer_id, calculated_at DESC);

-- 用于查找最新评分
CREATE INDEX IF NOT EXISTS idx_launch_scores_calculated_at
ON launch_scores(calculated_at DESC);

-- ============================================
-- Ad Groups表索引优化
-- ============================================

-- 用于状态过滤
CREATE INDEX IF NOT EXISTS idx_ad_groups_status
ON ad_groups(status);

-- 复合索引：campaign_id + status（常见查询）
CREATE INDEX IF NOT EXISTS idx_ad_groups_campaign_status
ON ad_groups(campaign_id, status);

-- ============================================
-- Campaign Performance表索引优化
-- ============================================

-- 用于用户数据聚合查询
CREATE INDEX IF NOT EXISTS idx_performance_user_date
ON campaign_performance(user_id, date DESC);

-- 用于Dashboard趋势查询（已有campaign_id+date，这里补充user_id维度）
CREATE INDEX IF NOT EXISTS idx_performance_user_campaign
ON campaign_performance(user_id, campaign_id);

-- ============================================
-- Search Term Reports表索引优化
-- ============================================

-- 用于用户查询
CREATE INDEX IF NOT EXISTS idx_search_terms_user_id
ON search_term_reports(user_id);

-- 用于Campaign关联和日期过滤
CREATE INDEX IF NOT EXISTS idx_search_terms_campaign_date
ON search_term_reports(campaign_id, date DESC);

-- 用于搜索词分析
CREATE INDEX IF NOT EXISTS idx_search_terms_term
ON search_term_reports(search_term);

-- ============================================
-- Google Ads Accounts表索引优化
-- ============================================

-- 复合索引：user_id + is_active（列表查询）
CREATE INDEX IF NOT EXISTS idx_google_ads_user_active
ON google_ads_accounts(user_id, is_active);

-- 用于同步状态查询
CREATE INDEX IF NOT EXISTS idx_google_ads_last_sync
ON google_ads_accounts(last_sync_at DESC);

-- ============================================
-- Weekly Recommendations表索引优化
-- ============================================

-- 复合索引：user_id + status + week_start_date
CREATE INDEX IF NOT EXISTS idx_recommendations_user_status_week
ON weekly_recommendations(user_id, status, week_start_date DESC);

-- 用于优先级过滤
CREATE INDEX IF NOT EXISTS idx_recommendations_priority
ON weekly_recommendations(priority);

-- ============================================
-- System Settings表索引优化
-- ============================================

-- 复合索引：category + config_key（配置查询的主要方式）
CREATE INDEX IF NOT EXISTS idx_settings_category_key
ON system_settings(category, config_key);

-- 用于用户特定设置查询
CREATE INDEX IF NOT EXISTS idx_settings_user_category
ON system_settings(user_id, category)
WHERE user_id IS NOT NULL;

-- ============================================
-- Risk Alerts表索引优化（补充）
-- ============================================

-- 用于风险类型过滤
CREATE INDEX IF NOT EXISTS idx_risk_alerts_type
ON risk_alerts(risk_type);

-- 用于严重程度过滤
CREATE INDEX IF NOT EXISTS idx_risk_alerts_severity
ON risk_alerts(severity);

-- 复合索引：user_id + severity + status（Dashboard警报查询）
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_severity_status
ON risk_alerts(user_id, severity, status);

-- ============================================
-- Link Check History表索引优化
-- ============================================

-- 用于用户查询
CREATE INDEX IF NOT EXISTS idx_link_check_user_id
ON link_check_history(user_id);

-- 复合索引：offer_id + checked_at（查询最近检查结果）
CREATE INDEX IF NOT EXISTS idx_link_check_offer_checked
ON link_check_history(offer_id, checked_at DESC);

-- 用于失败链接查询
CREATE INDEX IF NOT EXISTS idx_link_check_accessible
ON link_check_history(is_accessible, checked_at DESC);

-- ============================================
-- Rate Limits表索引优化
-- ============================================

-- 复合索引：user_id + api_name + window_start（限流检查）
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_api_window
ON rate_limits(user_id, api_name, window_start DESC);

-- 用于清理过期记录
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_end
ON rate_limits(window_end);

-- ============================================
-- CPC Adjustment History表索引优化
-- ============================================

-- 复合索引：user_id + offer_id + created_at（历史记录查询）
CREATE INDEX IF NOT EXISTS idx_cpc_history_user_offer_created
ON cpc_adjustment_history(user_id, offer_id, created_at DESC);

-- 用于调整类型分析
CREATE INDEX IF NOT EXISTS idx_cpc_history_adjustment_type
ON cpc_adjustment_history(adjustment_type);

-- ============================================
-- 完成标记
-- ============================================

-- 记录迁移完成
INSERT INTO migrations_history (migration_file)
VALUES ('008_add_performance_indexes.sql')
ON CONFLICT(migration_file) DO NOTHING;
