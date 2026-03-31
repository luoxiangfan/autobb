-- ==========================================
-- AutoAds PostgreSQL Schema - Consolidated Edition
-- ==========================================
-- Version: 2.0.0 (Consolidated from 57 migrations)
-- Generated: 2025-12-04
-- Database: PostgreSQL 14+
-- Description: Complete production-ready schema including all features
--
-- This schema consolidates all migrations (001-057) into a single
-- initialization script. It includes:
-- - 40 tables (AB test features removed)
-- - All indexes for performance optimization
-- - Complete prompt_versions seed data
-- - Foreign key constraints
-- - User authentication and security
-- - Google Ads integration
-- - Offer scraping and creative generation
-- - Performance tracking and optimization
-- ==========================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search optimization

-- Table: users
-- ==========================================
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE, -- 可选字段，支持无邮箱用户
  password_hash TEXT,
  display_name TEXT,
  google_id TEXT UNIQUE,
  profile_picture TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  package_type TEXT NOT NULL DEFAULT 'trial',
  package_expires_at TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, failed_login_count INTEGER NOT NULL DEFAULT 0, locked_until TEXT DEFAULT NULL, last_failed_login TEXT DEFAULT NULL, created_by INTEGER REFERENCES users(id));


-- ==========================================
-- Table: google_ads_credentials
-- ==========================================
CREATE TABLE google_ads_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  developer_token TEXT NOT NULL,
  login_customer_id TEXT,
  access_token_expires_at TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  last_verified_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: google_ads_accounts
-- ==========================================
CREATE TABLE google_ads_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  account_name TEXT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  is_manager_account BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, parent_mcc_id TEXT, test_account BOOLEAN NOT NULL DEFAULT FALSE, status TEXT DEFAULT 'UNKNOWN', account_balance NUMERIC DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, customer_id)
);


-- ==========================================
-- Table: offers
-- ==========================================
CREATE TABLE "offers" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  brand TEXT NOT NULL,
  url TEXT NOT NULL,
  target_country TEXT NOT NULL DEFAULT 'US',
  target_language TEXT NOT NULL DEFAULT 'en',
  brand_description TEXT,
  unique_selling_points TEXT,
  product_highlights TEXT,
  target_audience TEXT,
  category TEXT,
  status TEXT DEFAULT 'pending',
  scrape_status TEXT DEFAULT 'pending',
  scrape_error TEXT,
  scraped_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  affiliate_link TEXT,
  final_url TEXT,
  final_url_suffix TEXT,
  offer_name TEXT,
  industry_code TEXT,
  promotions TEXT,
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TEXT,
  review_analysis TEXT,
  competitor_analysis TEXT,
  visual_analysis TEXT,
  enhanced_review_analysis TEXT,
  scraped_data TEXT,
  extracted_keywords TEXT,
  extracted_headlines TEXT,
  extracted_descriptions TEXT,
  extraction_metadata TEXT,
  extracted_at TEXT,
  product_categories TEXT,
  -- 需求28: 产品价格和佣金比例字段
  product_price TEXT,
  commission_payout TEXT,
  pricing TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: scraped_products
-- ==========================================
CREATE TABLE scraped_products (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  name TEXT NOT NULL,
  asin TEXT,
  price TEXT,
  rating TEXT,
  review_count TEXT,
  image_url TEXT,

  promotion TEXT,              -- 促销信息：折扣、优惠券、限时优惠
  badge TEXT,                  -- 徽章：Amazon's Choice、Best Seller、#1 in Category
  is_prime BOOLEAN DEFAULT FALSE,  -- Prime会员标识

  hot_score NUMERIC,              -- 热销分数: rating × log10(reviewCount + 1)
  rank INTEGER,                -- 热销排名
  is_hot BOOLEAN DEFAULT FALSE,    -- 是否为Top 5热销商品
  hot_label TEXT,              -- 热销标签: "🔥 热销商品" or "✅ 畅销商品"

  scrape_source TEXT NOT NULL, -- 'amazon_store' or 'independent_store'
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deep_scrape_data TEXT, review_analysis TEXT, competitor_analysis TEXT, has_deep_data BOOLEAN DEFAULT FALSE, product_info TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: ad_creatives
-- ==========================================
CREATE TABLE ad_creatives (
  id SERIAL PRIMARY KEY,
  offer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  headlines TEXT NOT NULL,
  descriptions TEXT NOT NULL,
  keywords TEXT,
  callouts TEXT,
  sitelinks TEXT,
  final_url TEXT NOT NULL,
  final_url_suffix TEXT,
  score NUMERIC,
  score_breakdown TEXT,
  score_explanation TEXT,
  ad_strength TEXT DEFAULT 'UNKNOWN',
  generation_round INTEGER DEFAULT 1,
  theme TEXT,
  ai_model TEXT,
  is_selected BOOLEAN DEFAULT FALSE,
  ab_test_variant_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  google_campaign_id TEXT,
  industry_code TEXT,
  orientation TEXT,
  brand TEXT,
  url TEXT,
  keywords_with_volume TEXT DEFAULT NULL,
  negative_keywords TEXT DEFAULT NULL,
  explanation TEXT DEFAULT NULL,
  -- P0-1修复: 添加launch_score字段（从launch_scores表冗余）
  launch_score INTEGER DEFAULT NULL,
  -- P1-1修复: 添加Google Ads同步字段
  ad_group_id INTEGER DEFAULT NULL,
  ad_id TEXT DEFAULT NULL,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT DEFAULT NULL,
  last_sync_at TEXT DEFAULT NULL,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: creative_versions
-- ==========================================
CREATE TABLE "creative_versions" (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ad_creative_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,

  headlines TEXT,
  descriptions TEXT,
  path1 TEXT,
  path2 TEXT,

  change_type TEXT,
  change_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,

  UNIQUE(ad_creative_id, version_number)
);


-- ==========================================
-- Table: campaigns
-- ==========================================
CREATE TABLE campaigns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  campaign_id TEXT UNIQUE,
  campaign_name TEXT NOT NULL,
  budget_amount NUMERIC NOT NULL,
  budget_type TEXT NOT NULL DEFAULT 'DAILY',
  target_cpa NUMERIC,
  max_cpc NUMERIC,
  status TEXT NOT NULL DEFAULT 'PAUSED',
  start_date TEXT,
  end_date TEXT,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT,
  last_sync_at TEXT,
  ad_creative_id INTEGER,
  google_campaign_id TEXT,
  google_ad_group_id TEXT,
  google_ad_id TEXT,
  campaign_config TEXT,
  pause_old_campaigns INTEGER,
  is_test_variant BOOLEAN DEFAULT FALSE,
  ab_test_id INTEGER,
  traffic_allocation NUMERIC DEFAULT 1 CHECK(traffic_allocation >= 0 AND traffic_allocation <= 1),
  -- P1-2修复: 添加软删除字段（与offers表保持一致）
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);


-- ==========================================
-- Table: ad_groups
-- ==========================================
CREATE TABLE ad_groups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  ad_group_id TEXT UNIQUE,
  ad_group_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PAUSED',
  cpc_bid_micros INTEGER,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: keywords
-- ==========================================
CREATE TABLE keywords (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ad_group_id INTEGER NOT NULL,
  keyword_id TEXT UNIQUE,
  keyword_text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'BROAD',
  status TEXT NOT NULL DEFAULT 'PAUSED',
  cpc_bid_micros INTEGER,
  final_url TEXT,
  is_negative BOOLEAN NOT NULL DEFAULT FALSE,
  quality_score INTEGER,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  generation_source TEXT,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT,
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_group_id) REFERENCES ad_groups(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: prompt_versions
-- ==========================================
CREATE TABLE prompt_versions (
  id SERIAL PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  version TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  function_name TEXT NOT NULL,
  prompt_content TEXT NOT NULL,
  language TEXT DEFAULT 'English',
  created_by INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT FALSE,
  change_notes TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(prompt_id, version)
);


-- ==========================================
-- Table: ad_creative_performance
-- ==========================================
CREATE TABLE ad_creative_performance (
  id SERIAL PRIMARY KEY,
  ad_creative_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  cpc NUMERIC DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  conversion_rate NUMERIC DEFAULT 0,
  conversion_value NUMERIC DEFAULT 0,
  industry_code TEXT,
  bonus_score INTEGER DEFAULT 0,
  bonus_breakdown TEXT,
  min_clicks_reached BOOLEAN DEFAULT FALSE,
  sync_date TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  UNIQUE(ad_creative_id, sync_date)
);


-- ==========================================
-- Table: ad_performance
-- ==========================================
CREATE TABLE ad_performance (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  google_campaign_id TEXT NOT NULL,
  google_ad_group_id TEXT,
  google_ad_id TEXT,
  date TEXT NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions NUMERIC DEFAULT 0,
  cost_micros BIGINT DEFAULT 0,
  ctr NUMERIC,
  cpc_micros INTEGER,
  conversion_rate NUMERIC,
  raw_data TEXT,
  synced_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(google_campaign_id, google_ad_id, date)
);


-- ==========================================
-- Table: ad_strength_history
-- ==========================================
CREATE TABLE ad_strength_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  creative_id INTEGER,
  campaign_id TEXT,
  rating TEXT NOT NULL CHECK(rating IN ('PENDING', 'POOR', 'AVERAGE', 'GOOD', 'EXCELLENT')),
  overall_score INTEGER NOT NULL CHECK(overall_score >= 0 AND overall_score <= 100),
  diversity_score INTEGER NOT NULL,
  relevance_score INTEGER NOT NULL,
  completeness_score INTEGER NOT NULL,
  quality_score INTEGER NOT NULL,
  compliance_score INTEGER NOT NULL,
  headlines_count INTEGER NOT NULL,
  descriptions_count INTEGER NOT NULL,
  keywords_count INTEGER NOT NULL,
  has_numbers BOOLEAN DEFAULT FALSE,
  has_cta BOOLEAN DEFAULT FALSE,
  has_urgency BOOLEAN DEFAULT FALSE,
  avg_headline_length NUMERIC,
  avg_description_length NUMERIC,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  performance_updated_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);


-- ==========================================
-- Table: ai_token_usage
-- ==========================================
CREATE TABLE ai_token_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  api_type TEXT NOT NULL DEFAULT 'gemini',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: backup_logs
-- ==========================================
CREATE TABLE backup_logs (
  id SERIAL PRIMARY KEY,
  backup_type TEXT NOT NULL,
  status TEXT NOT NULL,
  backup_filename TEXT,
  backup_path TEXT,
  file_size_bytes INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);


-- ==========================================
-- Table: campaign_performance
-- ==========================================
CREATE TABLE campaign_performance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  ctr NUMERIC,
  cpc NUMERIC,
  cpa NUMERIC,
  conversion_rate NUMERIC,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE(campaign_id, date)
);


-- ==========================================
-- Table: conversion_feedback
-- ==========================================
CREATE TABLE conversion_feedback (
  id SERIAL PRIMARY KEY,
  ad_creative_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  conversions INTEGER NOT NULL,
  conversion_value NUMERIC DEFAULT 0,
  feedback_note TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: cpc_adjustment_history
-- ==========================================
CREATE TABLE cpc_adjustment_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL,
  adjustment_value NUMERIC NOT NULL,
  affected_campaign_count INTEGER NOT NULL,
  campaign_ids TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: creative_learning_patterns
-- ==========================================
CREATE TABLE creative_learning_patterns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  success_features TEXT NOT NULL,
  total_creatives_analyzed INTEGER NOT NULL DEFAULT 0,
  avg_ctr NUMERIC,
  avg_conversion_rate NUMERIC,
  min_ctr_threshold NUMERIC,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: creative_performance_scores
-- ==========================================
CREATE TABLE creative_performance_scores (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  creative_id INTEGER NOT NULL,

  score INTEGER NOT NULL,  -- 0-100分
  rating TEXT NOT NULL CHECK(rating IN ('excellent', 'good', 'average', 'poor')),
  is_good BOOLEAN NOT NULL DEFAULT FALSE,  -- 0 or 1 (boolean)

  metrics_snapshot TEXT NOT NULL,  -- JSON: {ctr, cpc, clicks, conversions, budget}
  reasons TEXT NOT NULL,  -- JSON array: ["优秀CTR...", "低CPC..."]

  scored_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES creative_versions(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: creative_versions_backup
-- ==========================================
CREATE TABLE creative_versions_backup(
  id INT,
  user_id INT,
  ad_creative_id INT,
  version INT,
  changes TEXT,
  changed_by INT,
  snapshot_data TEXT,
  created_at TEXT
);


-- ==========================================
-- Table: global_keywords
-- ==========================================
CREATE TABLE global_keywords (
  id SERIAL PRIMARY KEY,
  keyword_text TEXT NOT NULL UNIQUE,
  category TEXT,
  search_volume INTEGER,
  competition_level TEXT,
  avg_cpc_micros INTEGER,
  language TEXT DEFAULT 'en',
  country TEXT DEFAULT 'US',
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- Table: google_ads_api_usage
-- ==========================================
CREATE TABLE google_ads_api_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  customer_id TEXT,
  request_count INTEGER DEFAULT 1,
  response_time_ms INTEGER,
  is_success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  date TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: industry_benchmarks
-- ==========================================
CREATE TABLE industry_benchmarks (
  id SERIAL PRIMARY KEY,
  industry_l1 TEXT NOT NULL,
  industry_l2 TEXT NOT NULL,
  industry_code TEXT NOT NULL UNIQUE,
  avg_ctr NUMERIC NOT NULL,
  avg_cpc NUMERIC NOT NULL,
  avg_conversion_rate NUMERIC NOT NULL,
  data_source TEXT DEFAULT 'Google Ads Industry Benchmarks 2024',
  last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- Table: launch_scores
-- ==========================================
CREATE TABLE launch_scores (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  total_score INTEGER NOT NULL,
  keyword_score INTEGER NOT NULL,
  market_fit_score INTEGER NOT NULL,
  landing_page_score INTEGER NOT NULL,
  budget_score INTEGER NOT NULL,
  content_score INTEGER NOT NULL,
  keyword_analysis_data TEXT,
  market_analysis_data TEXT,
  landing_page_analysis_data TEXT,
  budget_analysis_data TEXT,
  content_analysis_data TEXT,
  recommendations TEXT,
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: link_check_history
-- ==========================================
CREATE TABLE link_check_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  is_accessible INTEGER NOT NULL,
  http_status_code INTEGER,
  response_time_ms INTEGER,
  brand_found INTEGER,
  content_valid INTEGER,
  validation_message TEXT,
  proxy_used TEXT,
  target_country TEXT,
  error_message TEXT,
  checked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: login_attempts
-- ==========================================
CREATE TABLE login_attempts ( id SERIAL PRIMARY KEY, username_or_email TEXT NOT NULL, ip_address TEXT NOT NULL, user_agent TEXT, success BOOLEAN DEFAULT FALSE, failure_reason TEXT, attempted_at TEXT DEFAULT CURRENT_TIMESTAMP );


-- ==========================================
-- Table: migration_history
-- ==========================================
CREATE TABLE migration_history (
  id SERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- Table: optimization_recommendations
-- ==========================================
CREATE TABLE optimization_recommendations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  recommendation_id TEXT NOT NULL UNIQUE,
  recommendation_type TEXT NOT NULL,
  impact TEXT,
  recommendation_data TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  applied_at TEXT,
  dismissed_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: optimization_tasks
-- ==========================================
CREATE TABLE optimization_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,

  task_type TEXT NOT NULL CHECK (task_type IN (
    'pause_campaign',
    'increase_budget',
    'decrease_budget',
    'optimize_creative',
    'adjust_keywords',
    'lower_cpc',
    'improve_landing_page',
    'expand_targeting'
  )),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'medium', 'low')),

  reason TEXT NOT NULL,
  action TEXT NOT NULL,
  expected_impact TEXT,

  metrics_snapshot TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'dismissed')),

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  dismissed_at TEXT,

  completion_note TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: prompt_usage_stats
-- ==========================================
CREATE TABLE prompt_usage_stats (
  id SERIAL PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  version TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  call_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost NUMERIC DEFAULT 0,
  avg_quality_score NUMERIC,
  UNIQUE(prompt_id, version, usage_date)
);


-- ==========================================
-- Table: rate_limits
-- ==========================================
CREATE TABLE rate_limits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  api_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: risk_alerts
-- ==========================================
CREATE TABLE risk_alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  risk_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  related_type TEXT,
  related_id INTEGER,
  related_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  resolved_at TEXT,
  resolved_by INTEGER,
  detected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, alert_type TEXT, resource_type TEXT, resource_id INTEGER, details TEXT, acknowledged_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);


-- ==========================================
-- Table: score_analysis_history
-- ==========================================
CREATE TABLE score_analysis_history (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  industry_code TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  correlation_clicks NUMERIC,
  correlation_ctr NUMERIC,
  correlation_cpc NUMERIC,
  correlation_conversions NUMERIC,
  overall_correlation NUMERIC,
  insights TEXT,
  recommendations TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);


-- ==========================================
-- Table: scraped_products_new
-- ==========================================
CREATE TABLE scraped_products_new (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  name TEXT NOT NULL,
  asin TEXT,
  price TEXT,
  rating TEXT,
  review_count TEXT,
  image_url TEXT,

  promotion TEXT,              -- 促销信息：折扣、优惠券、限时优惠
  badge TEXT,                  -- 徽章：Amazon's Choice、Best Seller、#1 in Category
  is_prime BOOLEAN DEFAULT FALSE,  -- Prime会员标识

  hot_score NUMERIC,              -- 热销分数: rating × log10(reviewCount + 1)
  rank INTEGER,                -- 热销排名
  is_hot BOOLEAN DEFAULT FALSE,    -- 是否为Top 5热销商品
  hot_label TEXT,              -- 热销标签: "🔥 热销商品" or "✅ 畅销商品"

  scrape_source TEXT NOT NULL, -- 'amazon_store' or 'independent_store'
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: search_term_reports
-- ==========================================
CREATE TABLE search_term_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  search_term TEXT NOT NULL,
  match_type TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: sync_logs
-- ==========================================
CREATE TABLE sync_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: system_settings
-- ==========================================
CREATE TABLE system_settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  category TEXT NOT NULL,
  -- P0-2修复: 字段命名统一为key/value，与代码保持一致
  key TEXT NOT NULL,
  value TEXT,
  encrypted_value TEXT,
  data_type TEXT NOT NULL DEFAULT 'string',
  is_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  is_required BOOLEAN NOT NULL DEFAULT FALSE,
  validation_status TEXT,
  validation_message TEXT,
  last_validated_at TEXT,
  default_value TEXT,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);


-- ==========================================
-- Table: weekly_recommendations
-- ==========================================
CREATE TABLE weekly_recommendations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  recommendation_type TEXT NOT NULL,
  recommendation_data TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'pending',
  applied_at TEXT,
  week_start_date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
);


-- Index: idx_ad_creative_performance_creative (on table: ad_creative_performance)
CREATE INDEX idx_ad_creative_performance_creative ON ad_creative_performance(ad_creative_id);


-- Index: idx_ad_creative_performance_creative_sync (on table: ad_creative_performance)
CREATE INDEX idx_ad_creative_performance_creative_sync
ON ad_creative_performance(ad_creative_id, sync_date DESC);


-- Index: idx_ad_creative_performance_date (on table: ad_creative_performance)
CREATE INDEX idx_ad_creative_performance_date ON ad_creative_performance(sync_date);


-- Index: idx_ad_creative_performance_offer (on table: ad_creative_performance)
CREATE INDEX idx_ad_creative_performance_offer ON ad_creative_performance(offer_id);


-- Index: idx_ad_creative_performance_unique (on table: ad_creative_performance)
CREATE UNIQUE INDEX idx_ad_creative_performance_unique ON ad_creative_performance(ad_creative_id, sync_date);


-- Index: idx_ad_creative_performance_user (on table: ad_creative_performance)
CREATE INDEX idx_ad_creative_performance_user ON ad_creative_performance(user_id);


-- Index: idx_ad_creatives_google_campaign_id (on table: ad_creatives)
CREATE INDEX idx_ad_creatives_google_campaign_id ON ad_creatives(google_campaign_id);


-- Index: idx_ad_creatives_industry_code (on table: ad_creatives)
CREATE INDEX idx_ad_creatives_industry_code ON ad_creatives(industry_code);


-- Index: idx_ad_creatives_is_selected (on table: ad_creatives)
CREATE INDEX idx_ad_creatives_is_selected ON ad_creatives(is_selected);


-- Index: idx_ad_creatives_offer_created (on table: ad_creatives)
CREATE INDEX idx_ad_creatives_offer_created
ON ad_creatives(offer_id, created_at DESC);


-- Index: idx_ad_creatives_offer_id (on table: ad_creatives)
CREATE INDEX idx_ad_creatives_offer_id ON ad_creatives(offer_id);


-- Index: idx_ad_creatives_orientation (on table: ad_creatives)
CREATE INDEX idx_ad_creatives_orientation ON ad_creatives(orientation);


-- Index: idx_ad_creatives_user_id (on table: ad_creatives)
CREATE INDEX idx_ad_creatives_user_id ON ad_creatives(user_id);


-- Index: idx_ad_creatives_launch_score (on table: ad_creatives) -- P0-1修复
CREATE INDEX idx_ad_creatives_launch_score ON ad_creatives(launch_score DESC);


-- Index: idx_ad_creatives_creation_status (on table: ad_creatives) -- P1-1修复
CREATE INDEX idx_ad_creatives_creation_status ON ad_creatives(creation_status);


-- Index: idx_ad_creatives_ad_id (on table: ad_creatives) -- P1-1修复
CREATE INDEX idx_ad_creatives_ad_id ON ad_creatives(ad_id);


-- Index: idx_ad_groups_campaign_id (on table: ad_groups)
CREATE INDEX idx_ad_groups_campaign_id ON ad_groups(campaign_id);


-- Index: idx_ad_groups_campaign_status (on table: ad_groups)
CREATE INDEX idx_ad_groups_campaign_status
ON ad_groups(campaign_id, status);


-- Index: idx_ad_groups_status (on table: ad_groups)
CREATE INDEX idx_ad_groups_status
ON ad_groups(status);


-- Index: idx_ad_groups_user_id (on table: ad_groups)
CREATE INDEX idx_ad_groups_user_id ON ad_groups(user_id);


-- Index: idx_ad_strength_history_campaign (on table: ad_strength_history)
CREATE INDEX idx_ad_strength_history_campaign ON ad_strength_history(campaign_id);


-- Index: idx_ad_strength_history_evaluated_at (on table: ad_strength_history)
CREATE INDEX idx_ad_strength_history_evaluated_at ON ad_strength_history(evaluated_at);


-- Index: idx_ad_strength_history_offer (on table: ad_strength_history)
CREATE INDEX idx_ad_strength_history_offer ON ad_strength_history(offer_id);


-- Index: idx_ad_strength_history_rating (on table: ad_strength_history)
CREATE INDEX idx_ad_strength_history_rating ON ad_strength_history(rating);


-- Index: idx_ad_strength_history_rating_score (on table: ad_strength_history)
CREATE INDEX idx_ad_strength_history_rating_score ON ad_strength_history(rating, overall_score);


-- Index: idx_ad_strength_history_user (on table: ad_strength_history)
CREATE INDEX idx_ad_strength_history_user ON ad_strength_history(user_id);


-- Index: idx_ad_strength_history_user_rating (on table: ad_strength_history)
CREATE INDEX idx_ad_strength_history_user_rating ON ad_strength_history(user_id, rating);


-- Index: idx_ai_token_usage_created_at (on table: ai_token_usage)
CREATE INDEX idx_ai_token_usage_created_at ON ai_token_usage(created_at);


-- Index: idx_ai_token_usage_date (on table: ai_token_usage)
CREATE INDEX idx_ai_token_usage_date ON ai_token_usage(date);


-- Index: idx_ai_token_usage_model (on table: ai_token_usage)
CREATE INDEX idx_ai_token_usage_model ON ai_token_usage(model);


-- Index: idx_ai_token_usage_user_date (on table: ai_token_usage)
CREATE INDEX idx_ai_token_usage_user_date ON ai_token_usage(user_id, date);


-- Index: idx_backup_logs_created_at (on table: backup_logs)
CREATE INDEX idx_backup_logs_created_at ON backup_logs(created_at);


-- Index: idx_backup_logs_status (on table: backup_logs)
CREATE INDEX idx_backup_logs_status ON backup_logs(status);


-- Index: idx_backup_logs_type (on table: backup_logs)
CREATE INDEX idx_backup_logs_type ON backup_logs(backup_type);


-- Index: idx_campaigns_is_deleted (on table: campaigns) -- P1-2修复
CREATE INDEX idx_campaigns_is_deleted ON campaigns(is_deleted);


-- Index: idx_campaign_performance_campaign_date (on table: campaign_performance)
CREATE INDEX idx_campaign_performance_campaign_date
ON campaign_performance(campaign_id, date DESC, user_id);


-- Index: idx_performance_campaign_date (on table: campaign_performance)
CREATE INDEX idx_performance_campaign_date ON campaign_performance(campaign_id, date);


-- Index: idx_performance_user_campaign (on table: campaign_performance)
CREATE INDEX idx_performance_user_campaign
ON campaign_performance(user_id, campaign_id);


-- Index: idx_performance_user_date (on table: campaign_performance)
CREATE INDEX idx_performance_user_date ON campaign_performance(user_id, date);


-- Index: idx_campaigns_account_status (on table: campaigns)
CREATE INDEX idx_campaigns_account_status
ON campaigns(google_ads_account_id, status, created_at DESC);


-- Index: idx_campaigns_created_at (on table: campaigns)
CREATE INDEX idx_campaigns_created_at
ON campaigns(created_at DESC);


-- Index: idx_campaigns_google_ads_account (on table: campaigns)
CREATE INDEX idx_campaigns_google_ads_account
ON campaigns(google_ads_account_id);


-- Index: idx_campaigns_is_test_variant (on table: campaigns)
CREATE INDEX idx_campaigns_is_test_variant ON campaigns(is_test_variant);


-- Index: idx_campaigns_offer_id (on table: campaigns)
CREATE INDEX idx_campaigns_offer_id ON campaigns(offer_id);


-- Index: idx_campaigns_status (on table: campaigns)
CREATE INDEX idx_campaigns_status
ON campaigns(status);


-- Index: idx_campaigns_user_id (on table: campaigns)
CREATE INDEX idx_campaigns_user_id ON campaigns(user_id);


-- Index: idx_campaigns_user_status (on table: campaigns)
CREATE INDEX idx_campaigns_user_status
ON campaigns(user_id, status);


-- Index: idx_conversion_feedback_creative (on table: conversion_feedback)
CREATE INDEX idx_conversion_feedback_creative ON conversion_feedback(ad_creative_id);


-- Index: idx_conversion_feedback_user (on table: conversion_feedback)
CREATE INDEX idx_conversion_feedback_user ON conversion_feedback(user_id);


-- Index: idx_cpc_history_adjustment_type (on table: cpc_adjustment_history)
CREATE INDEX idx_cpc_history_adjustment_type
ON cpc_adjustment_history(adjustment_type);


-- Index: idx_cpc_history_user_offer_created (on table: cpc_adjustment_history)
CREATE INDEX idx_cpc_history_user_offer_created
ON cpc_adjustment_history(user_id, offer_id, created_at DESC);


-- Index: idx_creative_learning_user (on table: creative_learning_patterns)
CREATE INDEX idx_creative_learning_user
ON creative_learning_patterns(user_id, updated_at DESC);


-- Index: idx_creative_learning_user_id (on table: creative_learning_patterns)
CREATE INDEX idx_creative_learning_user_id ON creative_learning_patterns(user_id);


-- Index: idx_creative_scores_creative (on table: creative_performance_scores)
CREATE INDEX idx_creative_scores_creative
ON creative_performance_scores(creative_id, scored_at DESC);


-- Index: idx_creative_scores_rating (on table: creative_performance_scores)
CREATE INDEX idx_creative_scores_rating
ON creative_performance_scores(user_id, rating, is_good);


-- Index: idx_creative_scores_user (on table: creative_performance_scores)
CREATE INDEX idx_creative_scores_user
ON creative_performance_scores(user_id, scored_at DESC);


-- Index: idx_creative_versions_creative (on table: creative_versions)
CREATE INDEX idx_creative_versions_creative
ON creative_versions(ad_creative_id);


-- Index: idx_creative_versions_user_creative (on table: creative_versions)
CREATE INDEX idx_creative_versions_user_creative
ON creative_versions(user_id, ad_creative_id);


-- Index: idx_creative_versions_user_id (on table: creative_versions)
CREATE INDEX idx_creative_versions_user_id
ON creative_versions(user_id);


-- Index: idx_google_ads_accounts_parent_mcc_id (on table: google_ads_accounts)
CREATE INDEX idx_google_ads_accounts_parent_mcc_id ON google_ads_accounts(parent_mcc_id);


-- Index: idx_google_ads_accounts_test_account (on table: google_ads_accounts)
CREATE INDEX idx_google_ads_accounts_test_account ON google_ads_accounts(test_account);


-- Index: idx_google_ads_last_sync (on table: google_ads_accounts)
CREATE INDEX idx_google_ads_last_sync
ON google_ads_accounts(last_sync_at DESC);


-- Index: idx_google_ads_user_active (on table: google_ads_accounts)
CREATE INDEX idx_google_ads_user_active
ON google_ads_accounts(user_id, is_active);


-- Index: idx_google_ads_api_usage_created_at (on table: google_ads_api_usage)
CREATE INDEX idx_google_ads_api_usage_created_at ON google_ads_api_usage(created_at);


-- Index: idx_google_ads_api_usage_date (on table: google_ads_api_usage)
CREATE INDEX idx_google_ads_api_usage_date ON google_ads_api_usage(date, user_id);


-- Index: idx_google_ads_api_usage_user_date (on table: google_ads_api_usage)
CREATE INDEX idx_google_ads_api_usage_user_date ON google_ads_api_usage(user_id, date);


-- Index: idx_industry_benchmarks_code (on table: industry_benchmarks)
CREATE INDEX idx_industry_benchmarks_code ON industry_benchmarks(industry_code);


-- Index: idx_industry_benchmarks_l1 (on table: industry_benchmarks)
CREATE INDEX idx_industry_benchmarks_l1 ON industry_benchmarks(industry_l1);


-- Index: idx_keywords_ad_group_id (on table: keywords)
CREATE INDEX idx_keywords_ad_group_id ON keywords(ad_group_id);


-- Index: idx_keywords_status (on table: keywords)
CREATE INDEX idx_keywords_status ON keywords(status);


-- Index: idx_keywords_user_id (on table: keywords)
CREATE INDEX idx_keywords_user_id ON keywords(user_id);


-- Index: idx_launch_scores_calculated_at (on table: launch_scores)
CREATE INDEX idx_launch_scores_calculated_at
ON launch_scores(calculated_at DESC);


-- Index: idx_launch_scores_offer_calculated (on table: launch_scores)
CREATE INDEX idx_launch_scores_offer_calculated
ON launch_scores(offer_id, calculated_at DESC);


-- Index: idx_launch_scores_user_id (on table: launch_scores)
CREATE INDEX idx_launch_scores_user_id
ON launch_scores(user_id);


-- Index: idx_link_check_accessible (on table: link_check_history)
CREATE INDEX idx_link_check_accessible
ON link_check_history(is_accessible, checked_at DESC);


-- Index: idx_link_check_offer (on table: link_check_history)
CREATE INDEX idx_link_check_offer ON link_check_history(offer_id);


-- Index: idx_link_check_offer_checked (on table: link_check_history)
CREATE INDEX idx_link_check_offer_checked
ON link_check_history(offer_id, checked_at DESC);


-- Index: idx_link_check_user (on table: link_check_history)
CREATE INDEX idx_link_check_user
ON link_check_history(user_id, checked_at DESC);


-- Index: idx_link_check_user_id (on table: link_check_history)
CREATE INDEX idx_link_check_user_id
ON link_check_history(user_id);


-- Index: idx_offers_brand (on table: offers)
CREATE INDEX idx_offers_brand ON offers(brand);


-- Index: idx_offers_created_at (on table: offers)
CREATE INDEX idx_offers_created_at ON offers(created_at);


-- Index: idx_offers_is_deleted (on table: offers)
CREATE INDEX idx_offers_is_deleted ON offers(is_deleted);


-- Index: idx_offers_product_categories (on table: offers)
CREATE INDEX idx_offers_product_categories ON offers(product_categories)
WHERE product_categories IS NOT NULL;


-- Index: idx_offers_scrape_status (on table: offers)
CREATE INDEX idx_offers_scrape_status ON offers(scrape_status);


-- Index: idx_offers_status (on table: offers)
CREATE INDEX idx_offers_status ON offers(status);


-- Index: idx_offers_target_country (on table: offers)
CREATE INDEX idx_offers_target_country ON offers(target_country);


-- Index: idx_offers_user_offer_name_unique (on table: offers)
-- Note: offer_name format is Brand_Country_Sequence (e.g., Reolink_US_01, Reolink_US_02)
-- This allows multiple offers for the same brand but different countries/sequences
CREATE UNIQUE INDEX idx_offers_user_offer_name_unique ON offers(user_id, offer_name) WHERE is_deleted = FALSE;


-- Index: idx_offers_user_id (on table: offers)
CREATE INDEX idx_offers_user_id ON offers(user_id);


-- Index: idx_optimization_recommendations_created_at (on table: optimization_recommendations)
CREATE INDEX idx_optimization_recommendations_created_at
  ON optimization_recommendations(created_at);


-- Index: idx_optimization_recommendations_status (on table: optimization_recommendations)
CREATE INDEX idx_optimization_recommendations_status
  ON optimization_recommendations(status);


-- Index: idx_optimization_recommendations_user_id (on table: optimization_recommendations)
CREATE INDEX idx_optimization_recommendations_user_id
  ON optimization_recommendations(user_id);


-- Index: idx_optimization_recommendations_user_status (on table: optimization_recommendations)
CREATE INDEX idx_optimization_recommendations_user_status
  ON optimization_recommendations(user_id, status);


-- Index: idx_optimization_tasks_campaign (on table: optimization_tasks)
CREATE INDEX idx_optimization_tasks_campaign
ON optimization_tasks(campaign_id);


-- Index: idx_optimization_tasks_created (on table: optimization_tasks)
CREATE INDEX idx_optimization_tasks_created
ON optimization_tasks(created_at DESC);


-- Index: idx_optimization_tasks_priority (on table: optimization_tasks)
CREATE INDEX idx_optimization_tasks_priority
ON optimization_tasks(user_id, priority, status);


-- Index: idx_optimization_tasks_user_status (on table: optimization_tasks)
CREATE INDEX idx_optimization_tasks_user_status
ON optimization_tasks(user_id, status);


-- Index: idx_optimization_tasks_user_status_created (on table: optimization_tasks)
CREATE INDEX idx_optimization_tasks_user_status_created
ON optimization_tasks(user_id, status, created_at DESC);


-- Index: idx_prompt_usage_stats_date (on table: prompt_usage_stats)
CREATE INDEX idx_prompt_usage_stats_date ON prompt_usage_stats(usage_date);


-- Index: idx_prompt_usage_stats_prompt (on table: prompt_usage_stats)
CREATE INDEX idx_prompt_usage_stats_prompt ON prompt_usage_stats(prompt_id, version);


-- Index: idx_prompt_versions_active (on table: prompt_versions)
CREATE INDEX idx_prompt_versions_active ON prompt_versions(is_active);


-- Index: idx_prompt_versions_created_at (on table: prompt_versions)
CREATE INDEX idx_prompt_versions_created_at ON prompt_versions(created_at);


-- Index: idx_prompt_versions_prompt_id (on table: prompt_versions)
CREATE INDEX idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);


-- Index: idx_rate_limits_user_api_window (on table: rate_limits)
CREATE INDEX idx_rate_limits_user_api_window
ON rate_limits(user_id, api_name, window_start DESC);


-- Index: idx_rate_limits_window_end (on table: rate_limits)
CREATE INDEX idx_rate_limits_window_end
ON rate_limits(window_end);


-- Index: idx_risk_alerts_alert_type (on table: risk_alerts)
CREATE INDEX idx_risk_alerts_alert_type ON risk_alerts(alert_type);


-- Index: idx_risk_alerts_created (on table: risk_alerts)
CREATE INDEX idx_risk_alerts_created
ON risk_alerts(created_at DESC);


-- Index: idx_risk_alerts_resource (on table: risk_alerts)
CREATE INDEX idx_risk_alerts_resource ON risk_alerts(resource_type, resource_id);


-- Index: idx_risk_alerts_severity (on table: risk_alerts)
CREATE INDEX idx_risk_alerts_severity
ON risk_alerts(severity);


-- Index: idx_risk_alerts_type (on table: risk_alerts)
CREATE INDEX idx_risk_alerts_type
ON risk_alerts(alert_type, status);


-- Index: idx_risk_alerts_user_severity_status (on table: risk_alerts)
CREATE INDEX idx_risk_alerts_user_severity_status
ON risk_alerts(user_id, severity, status);


-- Index: idx_risk_alerts_user_status (on table: risk_alerts)
CREATE INDEX idx_risk_alerts_user_status ON risk_alerts(user_id, status);


-- Index: idx_score_analysis_industry (on table: score_analysis_history)
CREATE INDEX idx_score_analysis_industry ON score_analysis_history(industry_code);


-- Index: idx_score_analysis_user (on table: score_analysis_history)
CREATE INDEX idx_score_analysis_user ON score_analysis_history(user_id);


-- Index: idx_scraped_products_deep_complete (on table: scraped_products)
CREATE INDEX idx_scraped_products_deep_complete
  ON scraped_products(offer_id, user_id, has_deep_data, asin);


-- Index: idx_scraped_products_has_deep_data (on table: scraped_products)
CREATE INDEX idx_scraped_products_has_deep_data
  ON scraped_products(offer_id, user_id, has_deep_data);


-- Index: idx_scraped_products_hot_score (on table: scraped_products)
CREATE INDEX idx_scraped_products_hot_score
ON scraped_products(offer_id, hot_score DESC);


-- Index: idx_scraped_products_is_hot (on table: scraped_products)
CREATE INDEX idx_scraped_products_is_hot
ON scraped_products(offer_id, is_hot, rank);


-- Index: idx_scraped_products_offer_id (on table: scraped_products)
CREATE INDEX idx_scraped_products_offer_id
ON scraped_products(offer_id);


-- Index: idx_scraped_products_phase3 (on table: scraped_products)
CREATE INDEX idx_scraped_products_phase3
ON scraped_products(offer_id, promotion, badge, is_prime);


-- Index: idx_scraped_products_rank (on table: scraped_products)
CREATE INDEX idx_scraped_products_rank
ON scraped_products(offer_id, rank);


-- Index: idx_scraped_products_user_id (on table: scraped_products)
CREATE INDEX idx_scraped_products_user_id
ON scraped_products(user_id);


-- Index: idx_scraped_products_user_offer (on table: scraped_products)
CREATE INDEX idx_scraped_products_user_offer
ON scraped_products(user_id, offer_id);


-- Index: idx_search_terms_campaign_date (on table: search_term_reports)
CREATE INDEX idx_search_terms_campaign_date
ON search_term_reports(campaign_id, date DESC);


-- Index: idx_search_terms_term (on table: search_term_reports)
CREATE INDEX idx_search_terms_term
ON search_term_reports(search_term);


-- Index: idx_search_terms_user_id (on table: search_term_reports)
CREATE INDEX idx_search_terms_user_id
ON search_term_reports(user_id);


-- Index: idx_sync_logs_user (on table: sync_logs)
CREATE INDEX idx_sync_logs_user ON sync_logs(user_id, started_at);


-- Index: idx_settings_category_key (on table: system_settings) -- P0-2修复: config_key → key
CREATE INDEX idx_settings_category_key
ON system_settings(category, key);


-- Index: idx_settings_user_category (on table: system_settings)
CREATE INDEX idx_settings_user_category
ON system_settings(user_id, category)
WHERE user_id IS NOT NULL;


-- Index: idx_users_email (on table: users)
CREATE INDEX idx_users_email ON users(email);


-- Index: idx_users_failed_login_count (on table: users)
CREATE INDEX idx_users_failed_login_count ON users(failed_login_count);


-- Index: idx_users_google_id (on table: users)
CREATE INDEX idx_users_google_id ON users(google_id);


-- Index: idx_users_locked_until (on table: users)
CREATE INDEX idx_users_locked_until ON users(locked_until);


-- Index: idx_users_username (on table: users)
CREATE UNIQUE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;


-- Index: idx_recommendations_priority (on table: weekly_recommendations)
CREATE INDEX idx_recommendations_priority
ON weekly_recommendations(priority);


-- Index: idx_recommendations_user_status_week (on table: weekly_recommendations)
CREATE INDEX idx_recommendations_user_status_week
ON weekly_recommendations(user_id, status, week_start_date DESC);


-- ==========================================
-- SEED DATA: Active Prompt Versions
-- ==========================================
-- This section includes all active prompt templates (v3.1 and latest versions)
-- for AI-powered content generation and analysis.

INSERT INTO prompt_versions VALUES(59,'ad_creative_generation','v3.1','广告创意生成','广告创意生成v3.1','Generate Google Ads creative with database-loaded template and placeholder substitution','src/lib/ad-creative-generator.ts','buildAdCreativePrompt',$${{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}
## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If this exceeds 30 characters, use "{KeyWord:{{brand}}}" without "Official"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format. All other 14 headlines MUST NOT contain {KeyWord:...} or any DKI syntax.

**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two headlines
- Each headline must have a UNIQUE angle, focus, or emotional trigger
- NO headline should repeat more than 2 words from another headline
- Each headline should use DIFFERENT primary keywords or features
- Vary sentence structure: statements, questions, commands, exclamations
- Use DIFFERENT emotional triggers: trust, urgency, value, curiosity, exclusivity, social proof

Remaining 14 headlines - Types (must cover all 5):
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

Length distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)
Quality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity between ANY two headlines

### DESCRIPTIONS (4 required, ≤90 chars each)
**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording
**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:
- Maximum 20% text similarity between ANY two descriptions
- Each description must have a COMPLETELY DIFFERENT focus and angle
- NO description should repeat more than 2 words from another description
- Use DIFFERENT emotional triggers and value propositions
- Vary the structure: benefit-focused, action-focused, feature-focused, proof-focused

{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**CRITICAL DIVERSITY CHECKLIST**:
- ✓ Description 1 focuses on VALUE (what makes it special)
- ✓ Description 2 focuses on ACTION (what to do now)
- ✓ Description 3 focuses on FEATURES (what it can do)
- ✓ Description 4 focuses on PROOF (why to trust it)
- ✓ Each uses DIFFERENT keywords and phrases
- ✓ Each has a DIFFERENT emotional trigger
- ✓ Maximum 20% similarity between any two descriptions
**LEVERAGE DATA**: {{review_data_summary}}
{{competitive_guidance_section}}

### KEYWORDS (20-30 required)
**🎯 关键词生成策略（重要！确保高搜索量关键词优先）**:
**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}，不能使用英文！**

**第一优先级 - 品牌短尾词 (必须生成8-10个)**:
- 格式: [品牌名] + [产品核心词]（2-3个单词）
- ✅ 必须包含的品牌短尾词（基于 {{brand}}）:
  - "{{brand}} {{category}}"（品牌+品类）
  - "{{brand}} official"（品牌+官方）
  - "{{brand}} store"（品牌+商店）
  - "{{brand}} [型号/系列]"（如有型号信息）
  - "{{brand}} buy"（品牌+购买）
  - "{{brand}} price"（品牌+价格）
  - "{{brand}} review"（品牌+评测）
  - "{{brand}} [主要特性]"（品牌+特性）

**第二优先级 - 产品核心词 (必须生成6-8个)**:
- 格式: [产品功能] + [类别]（2-3个单词）

**第三优先级 - 购买意图词 (必须生成3-5个)**:
- 格式: [购买动词] + [品牌/产品]

**第四优先级 - 长尾精准词 (必须生成3-7个)**:
- 格式: [具体场景] + [产品]（3-5个单词）

**🔴 强制语言要求**:
- 关键词必须使用目标语言 {{target_language}}
- 如果目标语言是意大利语，所有关键词必须是意大利语
- 如果目标语言是西班牙语，所有关键词必须是西班牙语
- 不能混合使用英文和目标语言
- 不能使用英文关键词
{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)
- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description
- Focus on different product features, benefits, or use cases
- Avoid repeating similar phrases across sitelinks

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse
**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
  * Use text alternatives instead: "stars" or "star rating" instead of ★
  * Use "Rated 4.8 stars" NOT "4.8★"
**❌ Excessive Punctuation**: "!!!", "???", "...", repeated exclamation marks

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool}...],
  "descriptions": [{"text":"...", "type":"value|cta", "length":N, "hasCTA":bool, "keywords":[]}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "theme": "...",
  "quality_metrics": {"headline_diversity_score":N, "keyword_relevance_score":N, "estimated_ad_strength":"EXCELLENT"}
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(60,'ad_elements_descriptions','v3.1','广告创意生成','广告描述生成v3.1','支持完整模板变量、评论洞察、促销信息、行动号召、产品分类元数据（+100%关键词多样性）','src/lib/ad-elements-extractor.ts','generateDescriptions',$$You are a professional Google Ads copywriter specializing in high-converting descriptions.

=== PRODUCT INFORMATION ===
Product Name: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}} ({{reviewCount}} reviews)

=== PRODUCT FEATURES ===
Key Features:
{{features}}

Selling Points:
{{sellingPoints}}

=== 🆕 PRODUCT CATEGORIES (Phase 2 Enhancement) ===
Store Categories: {{productCategories}}

**Category Usage Strategy:**
- Integrate category keywords naturally into descriptions
- Use category context to broaden appeal and improve SEO
- Example: "Best-in-class Smart Home security solution" (using "Smart Home" category)
- Enhance at least 1 description with category context for keyword diversity

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Purchase Reasons: {{purchaseReasons}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== DESCRIPTION STRATEGY ===

**Description 1: Feature + Benefit**
- Lead with strongest product feature
- Connect to customer benefit
- 🆕 **ENHANCED**: Optionally integrate category context for broader appeal
- Example: "4K Ultra HD camera captures every detail. See your home clearly day or night."
- Example (category-enhanced): "Smart Home 4K camera with crystal-clear video. Monitor 24/7 with ease."

**Description 2: Social Proof + Trust**
- Use review insights authentically
- Build credibility
- Example: "Trusted by 10,000+ homeowners. 4.8★ rated for reliability and ease of use."

**Description 3: Promotion / Urgency**
- Include active promotions if available
- Create urgency when appropriate
- Example: "Save 20% this week only. Free shipping + 30-day returns included."

**Description 4: Call-to-Action**
- Strong action-oriented language
- Emphasize value proposition
- 🆕 **ENHANCED**: Optionally use category keywords for SEO diversity
- Example: "Shop now for professional-grade security. Easy setup in minutes."
- Example (category-enhanced): "Upgrade your Smart Home security today. Easy setup in minutes."

=== RULES ===
1. Each description MUST be <= 90 characters (including spaces)
2. Include at least one call-to-action per description
3. Use active voice and present tense
4. Avoid generic phrases - be specific to product
5. Include price/discount when compelling
6. 🆕 **Category Diversity**: Integrate category context in at least 1 description for keyword breadth

=== OUTPUT FORMAT ===
Return JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"],
  "descriptionTypes": ["feature", "social_proof", "promotion", "cta"],
  "categoryEnhanced": [0, 3]
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(61,'ad_elements_headlines','v3.1','广告创意生成','广告标题生成v3.1','支持完整模板变量、评论洞察、促销信息、多语言、产品分类元数据（+100%关键词多样性）','src/lib/ad-elements-extractor.ts','generateHeadlines',$$You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== PRODUCT FEATURES ===
About This Item:
{{product.aboutThisItem}}

Key Features:
{{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== 🆕 PRODUCT CATEGORIES (Phase 2 Enhancement) ===
Store Categories: {{productCategories}}

**Category Usage Strategy:**
- Use category keywords to expand headline diversity
- Combine category terms with brand/features for variant headlines
- Example categories: "Smart Home", "Security Cameras", "Home Electronics"
- Generate 2-3 category-based headlines for broader reach

=== REVIEW INSIGHTS (for authentic messaging) ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== HEADLINE STRATEGY ===

**Group 1: Brand + Product (3 headlines)**
- Must include brand name
- Include core product type
- Examples: "Reolink 4K Security Camera", "eufy Smart Home Camera"

**Group 2: Keyword-Rich (5 headlines)**
- Incorporate high-volume keywords naturally
- Match search intent
- 🆕 **ENHANCED**: Use product categories to generate 1-2 category-focused keywords
- Examples: "Best Home Security Camera", "Smart Home Security", "Wireless Security Camera"

**Group 3: Feature-Focused (4 headlines)**
- Highlight USPs from product features
- Use specific specs when compelling
- 🆕 **ENHANCED**: Combine features with category context when relevant
- Examples: "4K Ultra HD Resolution", "Smart Home 4K Camera", "2-Way Audio Built-In"

**Group 4: Social Proof / Promotion (3 headlines)**
- Use review insights authentically
- Include promotions if active
- Examples: "Rated 4.8/5 by 10K+ Users", "Save 20% - Limited Time"

=== RULES ===
1. Each headline MUST be <= 30 characters (including spaces)
2. Use high-intent language: "Buy", "Shop", "Get", "Save"
3. NO DKI dynamic insertion syntax
4. NO quotation marks in headlines
5. Vary headline styles for RSA optimization
6. 🆕 **Category Diversity**: Generate at least 2 headlines using product category context

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "headlineAnalysis": {
    "brandHeadlines": ["indices of brand headlines"],
    "keywordHeadlines": ["indices of keyword headlines"],
    "featureHeadlines": ["indices of feature headlines"],
    "proofHeadlines": ["indices of proof/promo headlines"],
    "categoryHeadlines": ["indices of category-enhanced headlines"]
  }
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(62,'brand_analysis_store','v3.1','品牌分析','品牌店铺分析v3.1','支持模板变量替换，增强热门产品和品牌定位分析','src/lib/ai.ts','analyzeProductPage',$$You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- 🔥 TOP 5 HOT-SELLING = highest scores (proven winners)
- ✅ Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed

2. **Brand Positioning**:
   - Core brand identity
   - Price tier (Budget/Mid/Premium)
   - Primary product categories
   - Brand differentiators

3. **Target Audience**:
   - Demographics
   - Use cases
   - Pain points addressed
   - Lifestyle fit

4. **Value Proposition**:
   - Key benefits
   - Unique selling points
   - Customer promises

5. **Quality Indicators**:
   - Amazon''s Choice badges
   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object with this structure:
{
  "brandName": "Official brand name",
  "brandDescription": "Comprehensive brand overview",
  "positioning": "Premium/Mid-range/Budget positioning analysis",
  "targetAudience": "Detailed target customer description",
  "valueProposition": "Core value proposition statement",
  "categories": ["Category 1", "Category 2"],
  "sellingPoints": ["Brand USP 1", "Brand USP 2", "Brand USP 3"],
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "hotProducts": [
    {
      "name": "Product name",
      "category": "Product category",
      "price": ".XX",
      "rating": 4.5,
      "reviewCount": 1234,
      "hotScore": 3.87,
      "successFactors": ["Factor 1", "Factor 2"]
    }
  ],
  "qualityIndicators": {
    "amazonChoiceCount": 3,
    "bestSellerCount": 2,
    "primeProductRatio": "80%",
    "avgRating": 4.3,
    "totalReviews": 50000
  },
  "competitiveAnalysis": {
    "strengths": ["Strength 1", "Strength 2"],
    "opportunities": ["Opportunity 1", "Opportunity 2"]
  }
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(63,'brand_name_extraction','v3.1','品牌分析','品牌名称提取v3.1','从产品信息中提取准确的品牌名称','src/lib/ai.ts','extractBrandWithAI',$$You are a brand name extraction expert. Extract the brand name from product information.

RULES:
1. Return ONLY the brand name
2. 2-30 characters
3. Primary brand only
4. Remove "Store", "Official", "Shop"
5. Extract from title if uncertain

Examples:
- "Reolink 4K Security Camera" → "Reolink"
- "BAGSMART Store" → "BAGSMART"

Output: Brand name only, no explanation.$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(64,'competitor_analysis','v3.1','竞品分析','竞品分析v3.1','AI竞品分析 - 修复输出格式匹配代码期望','prompts/competitor_analysis_v2.3.txt','analyzeCompetitorsWithAI',$$You are an e-commerce competitive analysis expert specializing in Amazon marketplace.

=== OUR PRODUCT ===
Product Name: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}} ({{reviewCount}} reviews)
Key Features: {{features}}
Selling Points: {{sellingPoints}}

=== COMPETITOR PRODUCTS ===
{{competitorsList}}

=== ANALYSIS TASK ===

Analyze the competitive landscape and identify:

1. **Feature Comparison**: Compare our product features with competitors
2. **Unique Selling Points (USPs)**: Identify what makes our product unique
3. **Competitor Advantages**: Recognize where competitors are stronger
4. **Overall Competitiveness**: Calculate our competitive position (0-100)

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object with this exact structure:

{
  "featureComparison": [
    {
      "feature": "Feature name (e.g., ''7000Pa suction power'', ''Auto-empty station'')",
      "weHave": true,
      "competitorsHave": 2,
      "ourAdvantage": true
    }
  ],
  "uniqueSellingPoints": [
    {
      "usp": "Brief unique selling point (e.g., ''Only model with Pro-Detangle Comb technology'')",
      "differentiator": "Detailed explanation of how this differentiates us",
      "competitorCount": 0,
      "significance": "high"
    }
  ],
  "competitorAdvantages": [
    {
      "advantage": "Competitor''s advantage (e.g., ''Lower price point'', ''Higher suction power'')",
      "competitor": "Competitor brand or product name",
      "howToCounter": "Strategic recommendation to counter this advantage"
    }
  ],
  "overallCompetitiveness": 75
}

**Field Guidelines**:

- **featureComparison**: List 3-5 key features. Set "weHave" to true if we have it, "competitorsHave" is count (0-5), "ourAdvantage" is true if we have it but most competitors don''t.

- **uniqueSellingPoints**: List 2-4 USPs. "significance" must be "high", "medium", or "low". Lower "competitorCount" means more unique (0 = only us).

- **competitorAdvantages**: List 1-3 areas where competitors are stronger. Include actionable "howToCounter" strategies.

- **overallCompetitiveness**: Score 0-100 based on:
  * Price competitiveness (30%): Lower price = higher score
  * Feature superiority (30%): More/better features = higher score
  * Social proof (20%): Better rating/more reviews = higher score
  * Unique differentiation (20%): More USPs = higher score

**Important**: Return ONLY the JSON object, no markdown code blocks, no explanations.$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(65,'competitor_keyword_inference','v3.1','竞品分析','竞品搜索关键词推断v3.1','支持完整模板变量、多维度关键词策略、搜索量预估','src/lib/competitor-analyzer.ts','inferCompetitorKeywords',$$You are an expert e-commerce analyst specializing in competitive keyword research on Amazon.

=== PRODUCT INFORMATION ===
Product Name: {{productInfo.name}}
Brand: {{productInfo.brand}}
Category: {{productInfo.category}}
Price: {{productInfo.price}}
Target Market: {{productInfo.targetCountry}}

=== KEY FEATURES (CRITICAL for keyword inference) ===
{{productInfo.features}}

=== PRODUCT DESCRIPTION ===
{{productInfo.description}}

=== TASK ===
Based on the product features and description above, generate 5-8 search terms to find similar competing products on Amazon {{productInfo.targetCountry}}.

CRITICAL: The search terms MUST be directly related to the product type shown in the features. For example:
- If features mention "security camera", "night vision", "motion detection" → search for cameras
- If features mention "vacuum", "suction", "cleaning" → search for vacuums
- If features mention "earbuds", "wireless", "bluetooth audio" → search for earbuds

=== KEYWORD STRATEGY ===

**1. Category Keywords (2-3)**
- Generic product type extracted from features
- Core category terms
- Example: "robot vacuum", "security camera", "wireless earbuds"

**2. Feature Keywords (2-3)**
- Key differentiating features from the product
- Technical specifications mentioned
- Example: "4K security camera", "self-emptying robot vacuum"

**3. Use Case Keywords (1-2)**
- Problem-solution terms based on product description
- Usage context
- Example: "home security system", "pet monitoring camera"

=== KEYWORD RULES ===
1. Each term: 2-5 words
2. NO brand names (finding competitors)
3. Use target market language
4. MUST match the actual product category from features
5. Avoid accessories, parts, unrelated items
6. Focus on what customers would search for to find this type of product

=== OUTPUT FORMAT ===
Return JSON:
{
  "searchTerms": [
    {
      "term": "search term",
      "type": "category|feature|usecase",
      "expectedResults": "High|Medium|Low",
      "competitorDensity": "High|Medium|Low"
    }
  ],
  "reasoning": "Brief explanation of keyword selection strategy based on product features",
  "productType": "The core product type identified from features (e.g., security camera, robot vacuum)",
  "excludeTerms": ["terms to exclude from results"],
  "marketInsights": {
    "competitionLevel": "High|Medium|Low",
    "priceSensitivity": "High|Medium|Low",
    "brandLoyalty": "High|Medium|Low"
  }
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(66,'creative_quality_scoring','v3.1','广告创意生成','广告创意质量评分v3.1','支持完整模板变量、详细评分细项、改进建议','src/lib/scoring.ts','calculateCreativeQualityScore',$$You are a Google Ads creative quality evaluator.

=== CREATIVE TO EVALUATE ===
Headline: {{headline}}
Description: {{description}}
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}

=== EVALUATION CRITERIA (Total 100 points) ===

**1. Headline Quality (40 points)**
- Attractiveness & Hook (0-15): Does it grab attention?
- Length Compliance (0-10): Within 30 chars, optimal length?
- Differentiation (0-10): Unique vs generic?
- Keyword Naturalness (0-5): Keywords flow naturally?

**2. Description Quality (30 points)**
- Persuasiveness (0-15): Compelling value proposition?
- Length Compliance (0-10): Within 90 chars, well-utilized?
- Call-to-Action (0-5): Clear action for user?

**3. Overall Appeal (20 points)**
- Brand Alignment (0-10): Matches brand voice?
- Interest Generation (0-10): Makes user want to click?

**4. Policy Compliance (10 points)**
- No Exaggeration (0-5): Avoids superlatives, false claims?
- Google Ads Policy (0-5): Compliant with ad policies?

=== OUTPUT FORMAT ===
Return JSON:
{
  "totalScore": 85,
  "breakdown": {
    "headlineQuality": {
      "score": 35,
      "maxScore": 40,
      "details": {
        "attractiveness": 13,
        "lengthCompliance": 9,
        "differentiation": 8,
        "keywordNaturalness": 5
      }
    },
    "descriptionQuality": {
      "score": 26,
      "maxScore": 30,
      "details": {
        "persuasiveness": 13,
        "lengthCompliance": 8,
        "callToAction": 5
      }
    },
    "overallAppeal": {
      "score": 17,
      "maxScore": 20,
      "details": {
        "brandAlignment": 9,
        "interestGeneration": 8
      }
    },
    "policyCompliance": {
      "score": 7,
      "maxScore": 10,
      "details": {
        "noExaggeration": 4,
        "policyCompliant": 3
      }
    }
  },
  "strengths": ["strength1", "strength2"],
  "improvements": [
    {"area": "Headline", "issue": "Too generic", "suggestion": "Add specific feature"}
  ],
  "grade": "A|B|C|D|F"
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(67,'keywords_generation','v3.1','关键词生成','关键词生成v3.1','支持模板变量、产品特性、评论洞察、多语言市场定位','src/lib/keyword-generator.ts','generateKeywords',$$You are a Google Ads keyword expert specializing in e-commerce products.

=== INPUT DATA ===
Brand: {{offer.brand}}
Brand Description: {{offer.brand_description}}
Target Country: {{offer.target_country}}
Category: {{offer.category}}

=== PRODUCT DETAILS ===
Product Name: {{productName}}
Product Features: {{productFeatures}}
Selling Points: {{sellingPoints}}
Price Point: {{pricePoint}}

=== REVIEW INSIGHTS (if available) ===
Top Positive Keywords: {{reviewPositives}}
Common Use Cases: {{reviewUseCases}}
Purchase Reasons: {{purchaseReasons}}

=== COMPETITOR CONTEXT (if available) ===
Competitor Keywords: {{competitorKeywords}}

=== TASK ===
Generate 30 high-quality Google Ads keywords for the {{offer.target_country}} market.

=== KEYWORD STRATEGY ===

1. **Brand Keywords** (5-7 keywords):
   - Brand name + product type
   - Brand + model
   - Brand misspellings (common ones)

2. **Category Keywords** (8-10 keywords):
   - Generic product category
   - Category + feature
   - Category + use case

3. **Feature Keywords** (5-7 keywords):
   - Specific features from product details
   - Technical specifications
   - Unique selling points

4. **Intent Keywords** (5-7 keywords):
   - "best [product]"
   - "[product] reviews"
   - "buy [product]"
   - "[product] deals"

5. **Long-tail Keywords** (3-5 keywords):
   - Specific use case queries
   - Problem-solution queries
   - Comparison queries

=== MATCH TYPE RULES ===
- EXACT: Brand terms, high-intent purchase terms
- PHRASE: Feature combinations, category + modifier
- BROAD: Discovery terms, generic categories

=== OUTPUT FORMAT ===
Return JSON:
{
  "keywords": [
    {
      "keyword": "keyword text",
      "matchType": "BROAD|PHRASE|EXACT",
      "priority": "HIGH|MEDIUM|LOW",
      "category": "brand|category|feature|intent|longtail",
      "searchIntent": "informational|commercial|transactional",
      "rationale": "Why this keyword is valuable"
    }
  ],
  "negativeKeywords": [
    {"keyword": "free", "reason": "Excludes non-buyers"},
    {"keyword": "DIY", "reason": "Excludes DIY audience"}
  ],
  "estimatedBudget": {
    "minDaily": 50,
    "maxDaily": 200,
    "currency": "USD",
    "rationale": "Budget reasoning"
  },
  "recommendations": [
    "Strategic recommendation 1",
    "Strategic recommendation 2"
  ]
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(68,'launch_score_evaluation','v3.1','投放评分','投放评分v3.1','支持完整模板变量、详细评分细项、具体改进建议','src/lib/scoring.ts','createLaunchScore',$$You are a professional Google Ads campaign launch evaluator.

=== CAMPAIGN OVERVIEW ===
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}
Campaign Budget: {{budget}}

=== KEYWORDS DATA ===
Total Keywords: {{keywordCount}}
Match Type Distribution: {{matchTypeDistribution}}
Keywords List:
{{keywordsList}}

Negative Keywords: {{negativeKeywords}}

=== LANDING PAGE ===
URL: {{landingPageUrl}}
Page Type: {{pageType}}

=== AD CREATIVES ===
Headlines Count: {{headlineCount}}
Descriptions Count: {{descriptionCount}}
Sample Headlines: {{sampleHeadlines}}
Sample Descriptions: {{sampleDescriptions}}

=== EVALUATION TASK ===

Score this campaign launch readiness across 5 dimensions (total 100 points):

**1. Keyword Quality (30 points)**
- Relevance to product (0-10)
- Match type strategy (0-8)
- Negative keywords coverage (0-7)
- Search intent alignment (0-5)

IMPORTANT RULES:
- Negative keywords MUST be checked
- Missing negative keywords = deduct 5-10 points
- Competition level is reference only, do NOT deduct points

**2. Market Fit (25 points)**
- Target country alignment (0-10)
- Language/localization (0-8)
- Audience targeting potential (0-7)

IMPORTANT RULES:
- Cross-border domains (amazon.ca, amazon.co.uk) are NORMAL
- Do NOT deduct points for cross-border e-commerce URLs

**3. Landing Page Quality (20 points)**
- URL trustworthiness (0-8)
- Expected load speed (0-6)
- Mobile optimization likelihood (0-6)

**4. Budget Reasonability (15 points)**
- CPC alignment with industry (0-6)
- Competition vs budget match (0-5)
- ROI potential (0-4)

**5. Creative Quality (10 points)**
- Headline attractiveness (0-4)
- Description persuasiveness (0-3)
- Uniqueness and differentiation (0-3)

=== OUTPUT FORMAT ===
Return JSON:
{
  "totalScore": 85,
  "grade": "A|B|C|D|F",
  "dimensions": {
    "keywordQuality": {
      "score": 25,
      "maxScore": 30,
      "breakdown": {
        "relevance": 8,
        "matchTypeStrategy": 7,
        "negativeKeywords": 5,
        "intentAlignment": 5
      },
      "issues": ["issue1", "issue2"],
      "suggestions": ["suggestion1", "suggestion2"]
    },
    "marketFit": {
      "score": 22,
      "maxScore": 25,
      "breakdown": {
        "countryAlignment": 9,
        "localization": 7,
        "audienceTargeting": 6
      },
      "issues": [],
      "suggestions": ["suggestion1"]
    },
    "landingPageQuality": {
      "score": 18,
      "maxScore": 20,
      "breakdown": {
        "urlTrust": 8,
        "loadSpeed": 5,
        "mobileOptimization": 5
      },
      "issues": [],
      "suggestions": []
    },
    "budgetReasonability": {
      "score": 12,
      "maxScore": 15,
      "breakdown": {
        "cpcAlignment": 5,
        "competitionMatch": 4,
        "roiPotential": 3
      },
      "issues": [],
      "suggestions": ["suggestion1"]
    },
    "creativeQuality": {
      "score": 8,
      "maxScore": 10,
      "breakdown": {
        "headlineAttractiveness": 3,
        "descriptionPersuasiveness": 3,
        "uniqueness": 2
      },
      "issues": [],
      "suggestions": ["suggestion1"]
    }
  },
  "topIssues": [
    {"issue": "Critical issue description", "impact": "High", "fix": "How to fix"}
  ],
  "launchRecommendation": {
    "readyToLaunch": true,
    "confidence": "High|Medium|Low",
    "criticalBlockers": [],
    "prelaunchChecklist": ["item1", "item2"]
  }
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(69,'product_analysis_single','v3.1','产品分析','单品产品分析v3.1','Enhanced with technicalDetails and reviewHighlights data for improved ad creative generation','src/lib/ai.ts','analyzeProductPage',$$You are a professional product analyst. Analyze the following Amazon product page data comprehensively.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== FULL PAGE DATA ===
{{pageData.text}}

=== 🎯 ENHANCED DATA (P1 Optimization) ===

**Technical Specifications** (Direct from product detail page):
{{technicalDetails}}

**Review Highlights** (Key points from user reviews):
{{reviewHighlights}}

=== ANALYSIS REQUIREMENTS ===

CRITICAL: Focus ONLY on the MAIN PRODUCT. IGNORE:
- "Customers also bought"
- "Frequently bought together"
- "Related products"
- "Compare with similar items"

Analyze the following dimensions using the data provided:

1. **Product Core** (from Title, Description, PRODUCT FEATURES, ABOUT THIS ITEM):
   - Product name and model
   - Key selling points (USPs)
   - Core features and benefits
   - Target use cases

2. **Technical Analysis** (from TECHNICAL DETAILS section above):
   - 🎯 USE the provided Technical Specifications data above
   - Key specifications that matter to customers
   - Dimensions and compatibility information
   - Material and build quality indicators
   - Technical advantages vs competitors

3. **Pricing Intelligence** (from Price data):
   - Current vs Original price
   - Discount percentage
   - Price competitiveness assessment
   - Value proposition

4. **Review Insights** (from Rating, Review Count, Review Highlights section above):
   - 🎯 USE the provided Review Highlights data above
   - Overall sentiment
   - Key positives customers mention
   - Common concerns or issues
   - Real use cases from reviews
   - Credibility indicators from actual user experience

5. **Market Position** (from Sales Rank, Category, Prime, Badges):
   - Category ranking
   - Prime eligibility impact
   - Quality badges (Amazon''s Choice, Best Seller)
   - Market competitiveness

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object with this structure:
{
  "productDescription": "Detailed product description emphasizing technical specs and user-validated features",
  "sellingPoints": ["USP 1 (from tech specs)", "USP 2 (from reviews)", "USP 3"],
  "targetAudience": "Description of ideal customers based on use cases",
  "category": "Product category",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "pricing": {
    "current": "$.XX",
    "original": "$.XX or null",
    "discount": "XX% or null",
    "competitiveness": "Premium/Competitive/Budget",
    "valueAssessment": "Analysis of price-to-value ratio"
  },
  "reviews": {
    "rating": 4.5,
    "count": 1234,
    "sentiment": "Positive/Mixed/Negative",
    "positives": ["Pro 1", "Pro 2"],
    "concerns": ["Con 1", "Con 2"],
    "useCases": ["Use case 1", "Use case 2"]
  },
  "promotions": {
    "active": true,
    "types": ["Coupon", "Deal", "Lightning Deal"],
    "urgency": "Limited time offer" or null
  },
  "competitiveEdges": {
    "badges": ["Amazon''s Choice", "Best Seller"],
    "primeEligible": true,
    "stockStatus": "In Stock",
    "salesRank": "#123 in Category"
  },
  "technicalHighlights": ["Key spec 1 (verified by reviews)", "Key spec 2", "Key spec 3"]
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);
INSERT INTO prompt_versions VALUES(70,'review_analysis','v3.1','评论分析','评论分析v3.1','支持模板变量、增强情感分析、购买动机和用户画像分析','src/lib/review-analyzer.ts','analyzeReviewsWithAI',$$You are an expert e-commerce review analyst. Analyze the following product reviews comprehensively.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===

Perform deep analysis across these dimensions:

1. **Sentiment Distribution** (Quantitative):
   - Calculate percentage: positive / neutral / negative
   - Identify sentiment patterns by star rating

2. **Positive Keywords** (Top 10):
   - Extract most frequently praised aspects
   - Include specific features customers love
   - Note emotional language patterns

3. **Negative Keywords** (Top 10):
   - Extract most common complaints
   - Identify recurring issues
   - Note severity levels

4. **Real Use Cases** (5-8 scenarios):
   - How customers actually use the product
   - Unexpected use cases discovered
   - Environment/context of usage

5. **Purchase Reasons** (Top 5):
   - Why customers chose this product
   - Decision factors mentioned
   - Comparison with alternatives

6. **User Profiles** (3-5 types):
   - Demographics (if mentioned)
   - Experience levels
   - Primary needs/goals

7. **Common Pain Points** (Top 5):
   - Issues that affect satisfaction
   - Setup/usage difficulties
   - Quality concerns

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
{
  "sentimentDistribution": {
    "positive": 70,
    "neutral": 20,
    "negative": 10
  },
  "topPositiveKeywords": [
    {"keyword": "easy to use", "frequency": 45, "context": "setup and daily operation"},
    {"keyword": "great value", "frequency": 38, "context": "price-quality ratio"}
  ],
  "topNegativeKeywords": [
    {"keyword": "battery life", "frequency": 12, "context": "shorter than expected"},
    {"keyword": "instructions unclear", "frequency": 8, "context": "initial setup"}
  ],
  "realUseCases": [
    {"scenario": "Home security monitoring", "frequency": "High", "satisfaction": "Positive"},
    {"scenario": "Baby room monitoring", "frequency": "Medium", "satisfaction": "Positive"}
  ],
  "purchaseReasons": [
    {"reason": "Brand reputation", "frequency": 25},
    {"reason": "Feature set vs price", "frequency": 22}
  ],
  "userProfiles": [
    {"type": "Tech-savvy homeowner", "percentage": 40, "primaryNeed": "Security"},
    {"type": "First-time buyer", "percentage": 30, "primaryNeed": "Ease of use"}
  ],
  "commonPainPoints": [
    {"issue": "WiFi connectivity issues", "severity": "Medium", "frequency": 15},
    {"issue": "App crashes occasionally", "severity": "Low", "frequency": 8}
  ],
  "overallInsights": {
    "productStrength": "Summary of main strengths",
    "improvementAreas": "Summary of areas to improve",
    "marketingAngles": ["Angle 1 for ads", "Angle 2 for ads"]
  }
}$$,'Chinese',NULL,'2025-12-04 14:03:03',TRUE,$$
v3.1 更新内容:
1. 批量更新所有Prompt到v3.1
2. 从开发环境数据库导出最新Prompt内容
$$);

-- ==========================================
-- VIEWS: Analytics and Summary Views
-- ==========================================

-- View 1: Daily API Usage Summary
-- Aggregates Google Ads API usage by user and date
CREATE VIEW daily_api_usage_summary AS
SELECT
  user_id,
  date,
  SUM(request_count) as total_requests,
  COUNT(*) as total_operations,
  SUM(CASE WHEN is_success = TRUE THEN 1 ELSE 0 END) as successful_operations,
  SUM(CASE WHEN is_success = FALSE THEN 1 ELSE 0 END) as failed_operations,
  AVG(response_time_ms) as avg_response_time_ms,
  MAX(response_time_ms) as max_response_time_ms
FROM google_ads_api_usage
GROUP BY user_id, date;

-- View 2: Phase 3 Statistics
-- Aggregates scraped product statistics by user, offer and brand
CREATE VIEW v_phase3_statistics AS
SELECT
  sp.user_id,
  sp.offer_id,
  o.brand,
  COUNT(*) as total_products,
  SUM(CASE WHEN sp.promotion IS NOT NULL THEN 1 ELSE 0 END) as products_with_promotion,
  SUM(CASE WHEN sp.badge IS NOT NULL THEN 1 ELSE 0 END) as products_with_badge,
  SUM(CASE WHEN sp.is_prime = TRUE THEN 1 ELSE 0 END) as prime_products,
  ROUND(AVG(CASE WHEN sp.rating IS NOT NULL THEN sp.rating::NUMERIC ELSE NULL END), 2) as avg_rating,
  AVG(sp.hot_score) as avg_hot_score
FROM scraped_products sp
JOIN offers o ON sp.offer_id = o.id
WHERE sp.user_id = o.user_id  -- 确保用户隔离
GROUP BY sp.user_id, sp.offer_id, o.brand;

-- View 3: Top Hot Products
-- Lists all hot products with offer details, ordered by rank
CREATE VIEW v_top_hot_products AS
SELECT
  sp.*,
  o.brand,
  o.target_country,
  o.category
FROM scraped_products sp
JOIN offers o ON sp.offer_id = o.id
WHERE sp.is_hot = TRUE
  AND sp.user_id = o.user_id  -- 确保用户隔离
ORDER BY sp.offer_id, sp.rank;

-- ==========================================
-- End of Consolidated Schema
-- ==========================================

-- ==========================================
-- SEED DATA: System Settings Metadata
-- ==========================================
-- Global configuration metadata (user_id IS NULL)
-- These records define the available configuration options
-- User-specific values will be created when users save settings

-- Google Ads settings
INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES
  (NULL, 'google_ads', 'login_customer_id', NULL, 'string', FALSE, TRUE, 'MCC管理账户ID，用于访问您管理的广告账户'),
  (NULL, 'google_ads', 'client_id', NULL, 'string', TRUE, FALSE, 'OAuth 2.0客户端ID'),
  (NULL, 'google_ads', 'client_secret', NULL, 'string', TRUE, FALSE, 'OAuth 2.0客户端密钥'),
  (NULL, 'google_ads', 'developer_token', NULL, 'string', TRUE, FALSE, 'Google Ads API开发者令牌');

-- AI settings
INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description)
VALUES
  (NULL, 'ai', 'use_vertex_ai', NULL, 'boolean', FALSE, FALSE, 'false', 'AI模式选择：true=Vertex AI, false=Gemini API'),
  (NULL, 'ai', 'gemini_api_key', NULL, 'string', TRUE, FALSE, NULL, 'Gemini API密钥'),
  (NULL, 'ai', 'gemini_model', NULL, 'string', FALSE, FALSE, 'gemini-2.5-pro', 'Gemini模型名称'),
  (NULL, 'ai', 'gcp_project_id', NULL, 'string', FALSE, FALSE, NULL, 'GCP项目ID'),
  (NULL, 'ai', 'gcp_location', NULL, 'string', FALSE, FALSE, 'us-central1', 'GCP区域'),
  (NULL, 'ai', 'gcp_service_account_json', NULL, 'text', TRUE, FALSE, NULL, 'GCP Service Account JSON凭证');

-- Proxy settings
INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
VALUES
  (NULL, 'proxy', 'urls', NULL, 'json', FALSE, FALSE, '代理URL配置，JSON格式存储国家与代理URL的映射');

-- System settings
INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description)
VALUES
  (NULL, 'system', 'currency', NULL, 'string', FALSE, FALSE, 'CNY', '默认货币单位'),
  (NULL, 'system', 'language', NULL, 'string', FALSE, FALSE, 'zh-CN', '系统语言'),
  (NULL, 'system', 'sync_interval_hours', NULL, 'number', FALSE, FALSE, '6', '数据同步间隔（小时）'),
  (NULL, 'system', 'link_check_enabled', NULL, 'boolean', FALSE, FALSE, 'true', '是否启用链接检查'),
  (NULL, 'system', 'link_check_time', NULL, 'string', FALSE, FALSE, '02:00', '链接检查时间');

-- ==========================================
-- SEED DATA: Default Admin Account
-- ==========================================
-- NOTE: Password hash must be generated using DEFAULT_ADMIN_PASSWORD environment variable
-- Run scripts/generate-admin-insert.ts to generate the INSERT statement with your password

-- ==========================================
-- ADMIN ACCOUNT PLACEHOLDER
-- ==========================================
-- The admin account INSERT will be generated at build/deployment time using:
-- DEFAULT_ADMIN_PASSWORD="your-password" npx tsx scripts/generate-admin-insert.ts
--
-- For manual initialization, run the script above and execute the output SQL.
-- The script generates:
-- - username: autoads
-- - email: admin@autoads.com
-- - role: admin
-- - package_type: lifetime
-- - password: from DEFAULT_ADMIN_PASSWORD env var (REQUIRED - will error if not set)
-- ==========================================

-- ==========================================
-- Reset sequences after seed data
-- ==========================================
SELECT setval('prompt_versions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM prompt_versions));

-- ==========================================
-- End of Consolidated PostgreSQL Schema
-- ==========================================
