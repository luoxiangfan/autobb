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
  email TEXT NOT NULL UNIQUE,
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
  extracted_at TEXT, product_categories TEXT,
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
  is_prime BOOLEAN DEFAULT 0,  -- Prime会员标识

  hot_score NUMERIC,              -- 热销分数: rating × log10(reviewCount + 1)
  rank INTEGER,                -- 热销排名
  is_hot BOOLEAN DEFAULT 0,    -- 是否为Top 5热销商品
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
  generation_round BOOLEAN DEFAULT TRUE,
  theme TEXT,
  ai_model TEXT,
  is_selected BOOLEAN DEFAULT FALSE,
  ab_test_variant_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP, google_campaign_id TEXT, industry_code TEXT, orientation TEXT, brand TEXT, url TEXT, keywords_with_volume TEXT DEFAULT NULL, negative_keywords TEXT DEFAULT NULL, explanation TEXT DEFAULT NULL,
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
  impressions BOOLEAN DEFAULT FALSE,
  clicks BOOLEAN DEFAULT FALSE,
  ctr NUMERIC DEFAULT 0,
  cost NUMERIC DEFAULT 0,
  cpc NUMERIC DEFAULT 0,
  conversions BOOLEAN DEFAULT FALSE,
  conversion_rate NUMERIC DEFAULT 0,
  conversion_value NUMERIC DEFAULT 0,
  industry_code TEXT,
  bonus_score BOOLEAN DEFAULT FALSE,
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
  impressions BOOLEAN DEFAULT FALSE,
  clicks BOOLEAN DEFAULT FALSE,
  conversions NUMERIC DEFAULT 0,
  cost_micros BOOLEAN DEFAULT FALSE,
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
  impressions BOOLEAN DEFAULT FALSE,
  clicks BOOLEAN DEFAULT FALSE,
  conversions BOOLEAN DEFAULT FALSE,
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
  input_tokens BOOLEAN NOT NULL DEFAULT FALSE,
  output_tokens BOOLEAN NOT NULL DEFAULT FALSE,
  total_tokens BOOLEAN NOT NULL DEFAULT FALSE,
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
  impressions BOOLEAN NOT NULL DEFAULT FALSE,
  clicks BOOLEAN NOT NULL DEFAULT FALSE,
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
  success_count BOOLEAN NOT NULL DEFAULT FALSE,
  failure_count BOOLEAN NOT NULL DEFAULT FALSE,
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
  total_creatives_analyzed BOOLEAN NOT NULL DEFAULT FALSE,
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
  request_count BOOLEAN DEFAULT TRUE,
  response_time_ms INTEGER,
  is_success BOOLEAN DEFAULT TRUE,
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
  call_count BOOLEAN DEFAULT FALSE,
  total_tokens BOOLEAN DEFAULT FALSE,
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
  request_count BOOLEAN NOT NULL DEFAULT TRUE,
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
  is_prime BOOLEAN DEFAULT 0,  -- Prime会员标识

  hot_score NUMERIC,              -- 热销分数: rating × log10(reviewCount + 1)
  rank INTEGER,                -- 热销排名
  is_hot BOOLEAN DEFAULT 0,    -- 是否为Top 5热销商品
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
  impressions BOOLEAN NOT NULL DEFAULT FALSE,
  clicks BOOLEAN NOT NULL DEFAULT FALSE,
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
  record_count BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms BOOLEAN NOT NULL DEFAULT FALSE,
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
  config_key TEXT NOT NULL,
  config_value TEXT,
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


-- Index: idx_offers_user_brand_unique (on table: offers)
CREATE UNIQUE INDEX idx_offers_user_brand_unique ON offers(user_id, brand) WHERE is_deleted = 0;


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


-- Index: idx_settings_category_key (on table: system_settings)
CREATE INDEX idx_settings_category_key
ON system_settings(category, config_key);


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

INSERT INTO prompt_versions VALUES(59,'ad_creative_generation','v3.1','广告创意生成','广告创意生成v3.1','Generate Google Ads creative with database-loaded template and placeholder substitution','src/lib/ad-creative-generator.ts','buildAdCreativePrompt',replace('{{language_instruction}}\n\nGenerate Google Ads creative for {{brand}} ({{category}}).\n\nPRODUCT: {{product_description}}\nUSPs: {{unique_selling_points}}\nAUDIENCE: {{target_audience}}\nCOUNTRY: {{target_country}} | LANGUAGE: {{target_language}}\n{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}\n{{extras_data}}\n{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}\n## REQUIREMENTS (Target: EXCELLENT Ad Strength)\n\n### HEADLINES (15 required, ≤30 chars each)\n**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If this exceeds 30 characters, use "{KeyWord:{{brand}}}" without "Official"\n**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format. All other 14 headlines MUST NOT contain {KeyWord:...} or any DKI syntax.\n\n**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:\n- Maximum 20% text similarity between ANY two headlines\n- Each headline must have a UNIQUE angle, focus, or emotional trigger\n- NO headline should repeat more than 2 words from another headline\n- Each headline should use DIFFERENT primary keywords or features\n- Vary sentence structure: statements, questions, commands, exclamations\n- Use DIFFERENT emotional triggers: trust, urgency, value, curiosity, exclusivity, social proof\n\nRemaining 14 headlines - Types (must cover all 5):\n{{headline_brand_guidance}}\n{{headline_feature_guidance}}\n{{headline_promo_guidance}}\n{{headline_cta_guidance}}\n{{headline_urgency_guidance}}\n\nLength distribution: 5 short(10-20), 5 medium(20-25), 5 long(25-30)\nQuality: 8+ with keywords, 5+ with numbers, 3+ with urgency, <20% text similarity between ANY two headlines\n\n### DESCRIPTIONS (4 required, ≤90 chars each)\n**UNIQUENESS REQUIREMENT**: Each description MUST be DISTINCT in focus and wording\n**🎯 DIVERSITY REQUIREMENT (CRITICAL)**:\n- Maximum 20% text similarity between ANY two descriptions\n- Each description must have a COMPLETELY DIFFERENT focus and angle\n- NO description should repeat more than 2 words from another description\n- Use DIFFERENT emotional triggers and value propositions\n- Vary the structure: benefit-focused, action-focused, feature-focused, proof-focused\n\n{{description_1_guidance}}\n{{description_2_guidance}}\n{{description_3_guidance}}\n{{description_4_guidance}}\n\n**CRITICAL DIVERSITY CHECKLIST**:\n- ✓ Description 1 focuses on VALUE (what makes it special)\n- ✓ Description 2 focuses on ACTION (what to do now)\n- ✓ Description 3 focuses on FEATURES (what it can do)\n- ✓ Description 4 focuses on PROOF (why to trust it)\n- ✓ Each uses DIFFERENT keywords and phrases\n- ✓ Each has a DIFFERENT emotional trigger\n- ✓ Maximum 20% similarity between any two descriptions\n**LEVERAGE DATA**: {{review_data_summary}}\n{{competitive_guidance_section}}\n\n### KEYWORDS (20-30 required)\n**🎯 关键词生成策略（重要！确保高搜索量关键词优先）**:\n**⚠️ 强制约束：所有关键词必须使用目标语言 {{target_language}}，不能使用英文！**\n\n**第一优先级 - 品牌短尾词 (必须生成8-10个)**:\n- 格式: [品牌名] + [产品核心词]（2-3个单词）\n- ✅ 必须包含的品牌短尾词（基于 {{brand}}）:\n  - "{{brand}} {{category}}"（品牌+品类）\n  - "{{brand}} official"（品牌+官方）\n  - "{{brand}} store"（品牌+商店）\n  - "{{brand}} [型号/系列]"（如有型号信息）\n  - "{{brand}} buy"（品牌+购买）\n  - "{{brand}} price"（品牌+价格）\n  - "{{brand}} review"（品牌+评测）\n  - "{{brand}} [主要特性]"（品牌+特性）\n\n**第二优先级 - 产品核心词 (必须生成6-8个)**:\n- 格式: [产品功能] + [类别]（2-3个单词）\n\n**第三优先级 - 购买意图词 (必须生成3-5个)**:\n- 格式: [购买动词] + [品牌/产品]\n\n**第四优先级 - 长尾精准词 (必须生成3-7个)**:\n- 格式: [具体场景] + [产品]（3-5个单词）\n\n**🔴 强制语言要求**:\n- 关键词必须使用目标语言 {{target_language}}\n- 如果目标语言是意大利语，所有关键词必须是意大利语\n- 如果目标语言是西班牙语，所有关键词必须是西班牙语\n- 不能混合使用英文和目标语言\n- 不能使用英文关键词\n{{exclude_keywords_section}}\n\n### CALLOUTS (4-6, ≤25 chars)\n{{callout_guidance}}\n\n### SITELINKS (6): text≤25, desc≤35, url="/" (auto-replaced)\n- **REQUIREMENT**: Each sitelink must have a UNIQUE, compelling description\n- Focus on different product features, benefits, or use cases\n- Avoid repeating similar phrases across sitelinks\n\n## FORBIDDEN CONTENT:\n**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CAPS abuse\n**❌ Prohibited Symbols (Google Ads Policy)**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎\n  * Use text alternatives instead: "stars" or "star rating" instead of ★\n  * Use "Rated 4.8 stars" NOT "4.8★"\n**❌ Excessive Punctuation**: "!!!", "???", "...", repeated exclamation marks\n\n## OUTPUT (JSON only, no markdown):\n{\n  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency", "length":N, "keywords":[], "hasNumber":bool, "hasUrgency":bool}...],\n  "descriptions": [{"text":"...", "type":"value|cta", "length":N, "hasCTA":bool, "keywords":[]}...],\n  "keywords": ["..."],\n  "callouts": ["..."],\n  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],\n  "theme": "...",\n  "quality_metrics": {"headline_diversity_score":N, "keyword_relevance_score":N, "estimated_ad_strength":"EXCELLENT"}\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(60,'ad_elements_descriptions','v3.1','广告创意生成','广告描述生成v3.1','支持完整模板变量、评论洞察、促销信息、行动号召、产品分类元数据（+100%关键词多样性）','src/lib/ad-elements-extractor.ts','generateDescriptions',replace('You are a professional Google Ads copywriter specializing in high-converting descriptions.\n\n=== PRODUCT INFORMATION ===\nProduct Name: {{productName}}\nBrand: {{brand}}\nPrice: {{price}}\nRating: {{rating}} ({{reviewCount}} reviews)\n\n=== PRODUCT FEATURES ===\nKey Features:\n{{features}}\n\nSelling Points:\n{{sellingPoints}}\n\n=== 🆕 PRODUCT CATEGORIES (Phase 2 Enhancement) ===\nStore Categories: {{productCategories}}\n\n**Category Usage Strategy:**\n- Integrate category keywords naturally into descriptions\n- Use category context to broaden appeal and improve SEO\n- Example: "Best-in-class Smart Home security solution" (using "Smart Home" category)\n- Enhance at least 1 description with category context for keyword diversity\n\n=== REVIEW INSIGHTS ===\nCustomer Praises: {{reviewPositives}}\nPurchase Reasons: {{purchaseReasons}}\n\n=== PROMOTIONS (if active) ===\n{{promotionInfo}}\n\n=== TASK ===\nGenerate 4 Google Search ad descriptions (max 90 characters each).\n\n=== DESCRIPTION STRATEGY ===\n\n**Description 1: Feature + Benefit**\n- Lead with strongest product feature\n- Connect to customer benefit\n- 🆕 **ENHANCED**: Optionally integrate category context for broader appeal\n- Example: "4K Ultra HD camera captures every detail. See your home clearly day or night."\n- Example (category-enhanced): "Smart Home 4K camera with crystal-clear video. Monitor 24/7 with ease."\n\n**Description 2: Social Proof + Trust**\n- Use review insights authentically\n- Build credibility\n- Example: "Trusted by 10,000+ homeowners. 4.8★ rated for reliability and ease of use."\n\n**Description 3: Promotion / Urgency**\n- Include active promotions if available\n- Create urgency when appropriate\n- Example: "Save 20% this week only. Free shipping + 30-day returns included."\n\n**Description 4: Call-to-Action**\n- Strong action-oriented language\n- Emphasize value proposition\n- 🆕 **ENHANCED**: Optionally use category keywords for SEO diversity\n- Example: "Shop now for professional-grade security. Easy setup in minutes."\n- Example (category-enhanced): "Upgrade your Smart Home security today. Easy setup in minutes."\n\n=== RULES ===\n1. Each description MUST be <= 90 characters (including spaces)\n2. Include at least one call-to-action per description\n3. Use active voice and present tense\n4. Avoid generic phrases - be specific to product\n5. Include price/discount when compelling\n6. 🆕 **Category Diversity**: Integrate category context in at least 1 description for keyword breadth\n\n=== OUTPUT FORMAT ===\nReturn JSON:\n{\n  "descriptions": ["description1", "description2", "description3", "description4"],\n  "descriptionTypes": ["feature", "social_proof", "promotion", "cta"],\n  "categoryEnhanced": [0, 3]\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(61,'ad_elements_headlines','v3.1','广告创意生成','广告标题生成v3.1','支持完整模板变量、评论洞察、促销信息、多语言、产品分类元数据（+100%关键词多样性）','src/lib/ad-elements-extractor.ts','generateHeadlines',replace('You are a professional Google Ads copywriter specializing in high-CTR headlines.\n\n=== PRODUCT INFORMATION ===\nProduct Name: {{product.name}}\nBrand: {{product.brand}}\nRating: {{product.rating}} ({{product.reviewCount}} reviews)\nPrice: {{product.price}}\n\n=== PRODUCT FEATURES ===\nAbout This Item:\n{{product.aboutThisItem}}\n\nKey Features:\n{{product.features}}\n\n=== HIGH-VOLUME KEYWORDS ===\n{{topKeywords}}\n\n=== 🆕 PRODUCT CATEGORIES (Phase 2 Enhancement) ===\nStore Categories: {{productCategories}}\n\n**Category Usage Strategy:**\n- Use category keywords to expand headline diversity\n- Combine category terms with brand/features for variant headlines\n- Example categories: "Smart Home", "Security Cameras", "Home Electronics"\n- Generate 2-3 category-based headlines for broader reach\n\n=== REVIEW INSIGHTS (for authentic messaging) ===\nCustomer Praises: {{reviewPositives}}\nUse Cases: {{reviewUseCases}}\n\n=== PROMOTIONS (if active) ===\n{{promotionInfo}}\n\n=== TASK ===\nGenerate 15 Google Search ad headlines (max 30 characters each).\n\n=== HEADLINE STRATEGY ===\n\n**Group 1: Brand + Product (3 headlines)**\n- Must include brand name\n- Include core product type\n- Examples: "Reolink 4K Security Camera", "eufy Smart Home Camera"\n\n**Group 2: Keyword-Rich (5 headlines)**\n- Incorporate high-volume keywords naturally\n- Match search intent\n- 🆕 **ENHANCED**: Use product categories to generate 1-2 category-focused keywords\n- Examples: "Best Home Security Camera", "Smart Home Security", "Wireless Security Camera"\n\n**Group 3: Feature-Focused (4 headlines)**\n- Highlight USPs from product features\n- Use specific specs when compelling\n- 🆕 **ENHANCED**: Combine features with category context when relevant\n- Examples: "4K Ultra HD Resolution", "Smart Home 4K Camera", "2-Way Audio Built-In"\n\n**Group 4: Social Proof / Promotion (3 headlines)**\n- Use review insights authentically\n- Include promotions if active\n- Examples: "Rated 4.8/5 by 10K+ Users", "Save 20% - Limited Time"\n\n=== RULES ===\n1. Each headline MUST be <= 30 characters (including spaces)\n2. Use high-intent language: "Buy", "Shop", "Get", "Save"\n3. NO DKI dynamic insertion syntax\n4. NO quotation marks in headlines\n5. Vary headline styles for RSA optimization\n6. 🆕 **Category Diversity**: Generate at least 2 headlines using product category context\n\n=== OUTPUT FORMAT ===\nReturn JSON:\n{\n  "headlines": ["headline1", "headline2", ..., "headline15"],\n  "headlineAnalysis": {\n    "brandHeadlines": ["indices of brand headlines"],\n    "keywordHeadlines": ["indices of keyword headlines"],\n    "featureHeadlines": ["indices of feature headlines"],\n    "proofHeadlines": ["indices of proof/promo headlines"],\n    "categoryHeadlines": ["indices of category-enhanced headlines"]\n  }\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(62,'brand_analysis_store','v3.1','品牌分析','品牌店铺分析v3.1','支持模板变量替换，增强热门产品和品牌定位分析','src/lib/ai.ts','analyzeProductPage',replace('You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.\n\n=== INPUT DATA ===\nURL: {{pageData.url}}\nBrand: {{pageData.brand}}\nTitle: {{pageData.title}}\nDescription: {{pageData.description}}\n\n=== STORE PRODUCTS DATA ===\n{{pageData.text}}\n\n=== ANALYSIS METHODOLOGY ===\n\nHot Score Formula: Rating × log10(Review Count + 1)\n- 🔥 TOP 5 HOT-SELLING = highest scores (proven winners)\n- ✅ Other best sellers = good performers\n\n=== ANALYSIS PRIORITIES ===\n\n1. **Hot Products Analysis** (TOP 5 by Hot Score):\n   - Product names and categories\n   - Price points and positioning\n   - Review scores and volume\n   - Why these products succeed\n\n2. **Brand Positioning**:\n   - Core brand identity\n   - Price tier (Budget/Mid/Premium)\n   - Primary product categories\n   - Brand differentiators\n\n3. **Target Audience**:\n   - Demographics\n   - Use cases\n   - Pain points addressed\n   - Lifestyle fit\n\n4. **Value Proposition**:\n   - Key benefits\n   - Unique selling points\n   - Customer promises\n\n5. **Quality Indicators**:\n   - Amazon''s Choice badges\n   - Best Seller rankings\n   - Prime eligibility\n   - Active promotions\n   - High review counts (500+)\n\n=== OUTPUT LANGUAGE ===\nAll output MUST be in {{langName}}.\nCategory examples: {{categoryExamples}}\n\n=== OUTPUT FORMAT ===\nReturn a COMPLETE JSON object with this structure:\n{\n  "brandName": "Official brand name",\n  "brandDescription": "Comprehensive brand overview",\n  "positioning": "Premium/Mid-range/Budget positioning analysis",\n  "targetAudience": "Detailed target customer description",\n  "valueProposition": "Core value proposition statement",\n  "categories": ["Category 1", "Category 2"],\n  "sellingPoints": ["Brand USP 1", "Brand USP 2", "Brand USP 3"],\n  "keywords": ["keyword1", "keyword2", "keyword3"],\n  "hotProducts": [\n    {\n      "name": "Product name",\n      "category": "Product category",\n      "price": ".XX",\n      "rating": 4.5,\n      "reviewCount": 1234,\n      "hotScore": 3.87,\n      "successFactors": ["Factor 1", "Factor 2"]\n    }\n  ],\n  "qualityIndicators": {\n    "amazonChoiceCount": 3,\n    "bestSellerCount": 2,\n    "primeProductRatio": "80%",\n    "avgRating": 4.3,\n    "totalReviews": 50000\n  },\n  "competitiveAnalysis": {\n    "strengths": ["Strength 1", "Strength 2"],\n    "opportunities": ["Opportunity 1", "Opportunity 2"]\n  }\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(63,'brand_name_extraction','v3.1','品牌分析','品牌名称提取v3.1','从产品信息中提取准确的品牌名称','src/lib/ai.ts','extractBrandWithAI',replace('You are a brand name extraction expert. Extract the brand name from product information.\n\nRULES:\n1. Return ONLY the brand name\n2. 2-30 characters\n3. Primary brand only\n4. Remove "Store", "Official", "Shop"\n5. Extract from title if uncertain\n\nExamples:\n- "Reolink 4K Security Camera" → "Reolink"\n- "BAGSMART Store" → "BAGSMART"\n\nOutput: Brand name only, no explanation.','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(64,'competitor_analysis','v3.1','竞品分析','竞品分析v3.1','AI竞品分析 - 修复输出格式匹配代码期望','prompts/competitor_analysis_v2.3.txt','analyzeCompetitorsWithAI',replace('You are an e-commerce competitive analysis expert specializing in Amazon marketplace.\n\n=== OUR PRODUCT ===\nProduct Name: {{productName}}\nBrand: {{brand}}\nPrice: {{price}}\nRating: {{rating}} ({{reviewCount}} reviews)\nKey Features: {{features}}\nSelling Points: {{sellingPoints}}\n\n=== COMPETITOR PRODUCTS ===\n{{competitorsList}}\n\n=== ANALYSIS TASK ===\n\nAnalyze the competitive landscape and identify:\n\n1. **Feature Comparison**: Compare our product features with competitors\n2. **Unique Selling Points (USPs)**: Identify what makes our product unique\n3. **Competitor Advantages**: Recognize where competitors are stronger\n4. **Overall Competitiveness**: Calculate our competitive position (0-100)\n\n=== OUTPUT FORMAT ===\nReturn ONLY a valid JSON object with this exact structure:\n\n{\n  "featureComparison": [\n    {\n      "feature": "Feature name (e.g., ''7000Pa suction power'', ''Auto-empty station'')",\n      "weHave": true,\n      "competitorsHave": 2,\n      "ourAdvantage": true\n    }\n  ],\n  "uniqueSellingPoints": [\n    {\n      "usp": "Brief unique selling point (e.g., ''Only model with Pro-Detangle Comb technology'')",\n      "differentiator": "Detailed explanation of how this differentiates us",\n      "competitorCount": 0,\n      "significance": "high"\n    }\n  ],\n  "competitorAdvantages": [\n    {\n      "advantage": "Competitor''s advantage (e.g., ''Lower price point'', ''Higher suction power'')",\n      "competitor": "Competitor brand or product name",\n      "howToCounter": "Strategic recommendation to counter this advantage"\n    }\n  ],\n  "overallCompetitiveness": 75\n}\n\n**Field Guidelines**:\n\n- **featureComparison**: List 3-5 key features. Set "weHave" to true if we have it, "competitorsHave" is count (0-5), "ourAdvantage" is true if we have it but most competitors don''t.\n\n- **uniqueSellingPoints**: List 2-4 USPs. "significance" must be "high", "medium", or "low". Lower "competitorCount" means more unique (0 = only us).\n\n- **competitorAdvantages**: List 1-3 areas where competitors are stronger. Include actionable "howToCounter" strategies.\n\n- **overallCompetitiveness**: Score 0-100 based on:\n  * Price competitiveness (30%): Lower price = higher score\n  * Feature superiority (30%): More/better features = higher score\n  * Social proof (20%): Better rating/more reviews = higher score\n  * Unique differentiation (20%): More USPs = higher score\n\n**Important**: Return ONLY the JSON object, no markdown code blocks, no explanations.','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(65,'competitor_keyword_inference','v3.1','竞品分析','竞品搜索关键词推断v3.1','支持完整模板变量、多维度关键词策略、搜索量预估','src/lib/competitor-analyzer.ts','inferCompetitorKeywords',replace('You are an expert e-commerce analyst specializing in competitive keyword research on Amazon.\n\n=== PRODUCT INFORMATION ===\nProduct Name: {{productInfo.name}}\nBrand: {{productInfo.brand}}\nCategory: {{productInfo.category}}\nPrice: {{productInfo.price}}\nTarget Market: {{productInfo.targetCountry}}\n\n=== KEY FEATURES (CRITICAL for keyword inference) ===\n{{productInfo.features}}\n\n=== PRODUCT DESCRIPTION ===\n{{productInfo.description}}\n\n=== TASK ===\nBased on the product features and description above, generate 5-8 search terms to find similar competing products on Amazon {{productInfo.targetCountry}}.\n\nCRITICAL: The search terms MUST be directly related to the product type shown in the features. For example:\n- If features mention "security camera", "night vision", "motion detection" → search for cameras\n- If features mention "vacuum", "suction", "cleaning" → search for vacuums\n- If features mention "earbuds", "wireless", "bluetooth audio" → search for earbuds\n\n=== KEYWORD STRATEGY ===\n\n**1. Category Keywords (2-3)**\n- Generic product type extracted from features\n- Core category terms\n- Example: "robot vacuum", "security camera", "wireless earbuds"\n\n**2. Feature Keywords (2-3)**\n- Key differentiating features from the product\n- Technical specifications mentioned\n- Example: "4K security camera", "self-emptying robot vacuum"\n\n**3. Use Case Keywords (1-2)**\n- Problem-solution terms based on product description\n- Usage context\n- Example: "home security system", "pet monitoring camera"\n\n=== KEYWORD RULES ===\n1. Each term: 2-5 words\n2. NO brand names (finding competitors)\n3. Use target market language\n4. MUST match the actual product category from features\n5. Avoid accessories, parts, unrelated items\n6. Focus on what customers would search for to find this type of product\n\n=== OUTPUT FORMAT ===\nReturn JSON:\n{\n  "searchTerms": [\n    {\n      "term": "search term",\n      "type": "category|feature|usecase",\n      "expectedResults": "High|Medium|Low",\n      "competitorDensity": "High|Medium|Low"\n    }\n  ],\n  "reasoning": "Brief explanation of keyword selection strategy based on product features",\n  "productType": "The core product type identified from features (e.g., security camera, robot vacuum)",\n  "excludeTerms": ["terms to exclude from results"],\n  "marketInsights": {\n    "competitionLevel": "High|Medium|Low",\n    "priceSensitivity": "High|Medium|Low",\n    "brandLoyalty": "High|Medium|Low"\n  }\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(66,'creative_quality_scoring','v3.1','广告创意生成','广告创意质量评分v3.1','支持完整模板变量、详细评分细项、改进建议','src/lib/scoring.ts','calculateCreativeQualityScore',replace('You are a Google Ads creative quality evaluator.\n\n=== CREATIVE TO EVALUATE ===\nHeadline: {{headline}}\nDescription: {{description}}\nBrand: {{brand}}\nProduct: {{productName}}\nTarget Country: {{targetCountry}}\n\n=== EVALUATION CRITERIA (Total 100 points) ===\n\n**1. Headline Quality (40 points)**\n- Attractiveness & Hook (0-15): Does it grab attention?\n- Length Compliance (0-10): Within 30 chars, optimal length?\n- Differentiation (0-10): Unique vs generic?\n- Keyword Naturalness (0-5): Keywords flow naturally?\n\n**2. Description Quality (30 points)**\n- Persuasiveness (0-15): Compelling value proposition?\n- Length Compliance (0-10): Within 90 chars, well-utilized?\n- Call-to-Action (0-5): Clear action for user?\n\n**3. Overall Appeal (20 points)**\n- Brand Alignment (0-10): Matches brand voice?\n- Interest Generation (0-10): Makes user want to click?\n\n**4. Policy Compliance (10 points)**\n- No Exaggeration (0-5): Avoids superlatives, false claims?\n- Google Ads Policy (0-5): Compliant with ad policies?\n\n=== OUTPUT FORMAT ===\nReturn JSON:\n{\n  "totalScore": 85,\n  "breakdown": {\n    "headlineQuality": {\n      "score": 35,\n      "maxScore": 40,\n      "details": {\n        "attractiveness": 13,\n        "lengthCompliance": 9,\n        "differentiation": 8,\n        "keywordNaturalness": 5\n      }\n    },\n    "descriptionQuality": {\n      "score": 26,\n      "maxScore": 30,\n      "details": {\n        "persuasiveness": 13,\n        "lengthCompliance": 8,\n        "callToAction": 5\n      }\n    },\n    "overallAppeal": {\n      "score": 17,\n      "maxScore": 20,\n      "details": {\n        "brandAlignment": 9,\n        "interestGeneration": 8\n      }\n    },\n    "policyCompliance": {\n      "score": 7,\n      "maxScore": 10,\n      "details": {\n        "noExaggeration": 4,\n        "policyCompliant": 3\n      }\n    }\n  },\n  "strengths": ["strength1", "strength2"],\n  "improvements": [\n    {"area": "Headline", "issue": "Too generic", "suggestion": "Add specific feature"}\n  ],\n  "grade": "A|B|C|D|F"\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(67,'keywords_generation','v3.1','关键词生成','关键词生成v3.1','支持模板变量、产品特性、评论洞察、多语言市场定位','src/lib/keyword-generator.ts','generateKeywords',replace('You are a Google Ads keyword expert specializing in e-commerce products.\n\n=== INPUT DATA ===\nBrand: {{offer.brand}}\nBrand Description: {{offer.brand_description}}\nTarget Country: {{offer.target_country}}\nCategory: {{offer.category}}\n\n=== PRODUCT DETAILS ===\nProduct Name: {{productName}}\nProduct Features: {{productFeatures}}\nSelling Points: {{sellingPoints}}\nPrice Point: {{pricePoint}}\n\n=== REVIEW INSIGHTS (if available) ===\nTop Positive Keywords: {{reviewPositives}}\nCommon Use Cases: {{reviewUseCases}}\nPurchase Reasons: {{purchaseReasons}}\n\n=== COMPETITOR CONTEXT (if available) ===\nCompetitor Keywords: {{competitorKeywords}}\n\n=== TASK ===\nGenerate 30 high-quality Google Ads keywords for the {{offer.target_country}} market.\n\n=== KEYWORD STRATEGY ===\n\n1. **Brand Keywords** (5-7 keywords):\n   - Brand name + product type\n   - Brand + model\n   - Brand misspellings (common ones)\n\n2. **Category Keywords** (8-10 keywords):\n   - Generic product category\n   - Category + feature\n   - Category + use case\n\n3. **Feature Keywords** (5-7 keywords):\n   - Specific features from product details\n   - Technical specifications\n   - Unique selling points\n\n4. **Intent Keywords** (5-7 keywords):\n   - "best [product]"\n   - "[product] reviews"\n   - "buy [product]"\n   - "[product] deals"\n\n5. **Long-tail Keywords** (3-5 keywords):\n   - Specific use case queries\n   - Problem-solution queries\n   - Comparison queries\n\n=== MATCH TYPE RULES ===\n- EXACT: Brand terms, high-intent purchase terms\n- PHRASE: Feature combinations, category + modifier\n- BROAD: Discovery terms, generic categories\n\n=== OUTPUT FORMAT ===\nReturn JSON:\n{\n  "keywords": [\n    {\n      "keyword": "keyword text",\n      "matchType": "BROAD|PHRASE|EXACT",\n      "priority": "HIGH|MEDIUM|LOW",\n      "category": "brand|category|feature|intent|longtail",\n      "searchIntent": "informational|commercial|transactional",\n      "rationale": "Why this keyword is valuable"\n    }\n  ],\n  "negativeKeywords": [\n    {"keyword": "free", "reason": "Excludes non-buyers"},\n    {"keyword": "DIY", "reason": "Excludes DIY audience"}\n  ],\n  "estimatedBudget": {\n    "minDaily": 50,\n    "maxDaily": 200,\n    "currency": "USD",\n    "rationale": "Budget reasoning"\n  },\n  "recommendations": [\n    "Strategic recommendation 1",\n    "Strategic recommendation 2"\n  ]\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(68,'launch_score_evaluation','v3.1','投放评分','投放评分v3.1','支持完整模板变量、详细评分细项、具体改进建议','src/lib/scoring.ts','createLaunchScore',replace('You are a professional Google Ads campaign launch evaluator.\n\n=== CAMPAIGN OVERVIEW ===\nBrand: {{brand}}\nProduct: {{productName}}\nTarget Country: {{targetCountry}}\nCampaign Budget: {{budget}}\n\n=== KEYWORDS DATA ===\nTotal Keywords: {{keywordCount}}\nMatch Type Distribution: {{matchTypeDistribution}}\nKeywords List:\n{{keywordsList}}\n\nNegative Keywords: {{negativeKeywords}}\n\n=== LANDING PAGE ===\nURL: {{landingPageUrl}}\nPage Type: {{pageType}}\n\n=== AD CREATIVES ===\nHeadlines Count: {{headlineCount}}\nDescriptions Count: {{descriptionCount}}\nSample Headlines: {{sampleHeadlines}}\nSample Descriptions: {{sampleDescriptions}}\n\n=== EVALUATION TASK ===\n\nScore this campaign launch readiness across 5 dimensions (total 100 points):\n\n**1. Keyword Quality (30 points)**\n- Relevance to product (0-10)\n- Match type strategy (0-8)\n- Negative keywords coverage (0-7)\n- Search intent alignment (0-5)\n\nIMPORTANT RULES:\n- Negative keywords MUST be checked\n- Missing negative keywords = deduct 5-10 points\n- Competition level is reference only, do NOT deduct points\n\n**2. Market Fit (25 points)**\n- Target country alignment (0-10)\n- Language/localization (0-8)\n- Audience targeting potential (0-7)\n\nIMPORTANT RULES:\n- Cross-border domains (amazon.ca, amazon.co.uk) are NORMAL\n- Do NOT deduct points for cross-border e-commerce URLs\n\n**3. Landing Page Quality (20 points)**\n- URL trustworthiness (0-8)\n- Expected load speed (0-6)\n- Mobile optimization likelihood (0-6)\n\n**4. Budget Reasonability (15 points)**\n- CPC alignment with industry (0-6)\n- Competition vs budget match (0-5)\n- ROI potential (0-4)\n\n**5. Creative Quality (10 points)**\n- Headline attractiveness (0-4)\n- Description persuasiveness (0-3)\n- Uniqueness and differentiation (0-3)\n\n=== OUTPUT FORMAT ===\nReturn JSON:\n{\n  "totalScore": 85,\n  "grade": "A|B|C|D|F",\n  "dimensions": {\n    "keywordQuality": {\n      "score": 25,\n      "maxScore": 30,\n      "breakdown": {\n        "relevance": 8,\n        "matchTypeStrategy": 7,\n        "negativeKeywords": 5,\n        "intentAlignment": 5\n      },\n      "issues": ["issue1", "issue2"],\n      "suggestions": ["suggestion1", "suggestion2"]\n    },\n    "marketFit": {\n      "score": 22,\n      "maxScore": 25,\n      "breakdown": {\n        "countryAlignment": 9,\n        "localization": 7,\n        "audienceTargeting": 6\n      },\n      "issues": [],\n      "suggestions": ["suggestion1"]\n    },\n    "landingPageQuality": {\n      "score": 18,\n      "maxScore": 20,\n      "breakdown": {\n        "urlTrust": 8,\n        "loadSpeed": 5,\n        "mobileOptimization": 5\n      },\n      "issues": [],\n      "suggestions": []\n    },\n    "budgetReasonability": {\n      "score": 12,\n      "maxScore": 15,\n      "breakdown": {\n        "cpcAlignment": 5,\n        "competitionMatch": 4,\n        "roiPotential": 3\n      },\n      "issues": [],\n      "suggestions": ["suggestion1"]\n    },\n    "creativeQuality": {\n      "score": 8,\n      "maxScore": 10,\n      "breakdown": {\n        "headlineAttractiveness": 3,\n        "descriptionPersuasiveness": 3,\n        "uniqueness": 2\n      },\n      "issues": [],\n      "suggestions": ["suggestion1"]\n    }\n  },\n  "topIssues": [\n    {"issue": "Critical issue description", "impact": "High", "fix": "How to fix"}\n  ],\n  "launchRecommendation": {\n    "readyToLaunch": true,\n    "confidence": "High|Medium|Low",\n    "criticalBlockers": [],\n    "prelaunchChecklist": ["item1", "item2"]\n  }\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(69,'product_analysis_single','v3.1','产品分析','单品产品分析v3.1','Enhanced with technicalDetails and reviewHighlights data for improved ad creative generation','src/lib/ai.ts','analyzeProductPage',replace('You are a professional product analyst. Analyze the following Amazon product page data comprehensively.\n\n=== INPUT DATA ===\nURL: {{pageData.url}}\nBrand: {{pageData.brand}}\nTitle: {{pageData.title}}\nDescription: {{pageData.description}}\n\n=== FULL PAGE DATA ===\n{{pageData.text}}\n\n=== 🎯 ENHANCED DATA (P1 Optimization) ===\n\n**Technical Specifications** (Direct from product detail page):\n{{technicalDetails}}\n\n**Review Highlights** (Key points from user reviews):\n{{reviewHighlights}}\n\n=== ANALYSIS REQUIREMENTS ===\n\nCRITICAL: Focus ONLY on the MAIN PRODUCT. IGNORE:\n- "Customers also bought"\n- "Frequently bought together"\n- "Related products"\n- "Compare with similar items"\n\nAnalyze the following dimensions using the data provided:\n\n1. **Product Core** (from Title, Description, PRODUCT FEATURES, ABOUT THIS ITEM):\n   - Product name and model\n   - Key selling points (USPs)\n   - Core features and benefits\n   - Target use cases\n\n2. **Technical Analysis** (from TECHNICAL DETAILS section above):\n   - 🎯 USE the provided Technical Specifications data above\n   - Key specifications that matter to customers\n   - Dimensions and compatibility information\n   - Material and build quality indicators\n   - Technical advantages vs competitors\n\n3. **Pricing Intelligence** (from Price data):\n   - Current vs Original price\n   - Discount percentage\n   - Price competitiveness assessment\n   - Value proposition\n\n4. **Review Insights** (from Rating, Review Count, Review Highlights section above):\n   - 🎯 USE the provided Review Highlights data above\n   - Overall sentiment\n   - Key positives customers mention\n   - Common concerns or issues\n   - Real use cases from reviews\n   - Credibility indicators from actual user experience\n\n5. **Market Position** (from Sales Rank, Category, Prime, Badges):\n   - Category ranking\n   - Prime eligibility impact\n   - Quality badges (Amazon''s Choice, Best Seller)\n   - Market competitiveness\n\n=== OUTPUT LANGUAGE ===\nAll output MUST be in {{langName}}.\nCategory examples: {{categoryExamples}}\n\n=== OUTPUT FORMAT ===\nReturn a COMPLETE JSON object with this structure:\n{\n  "productDescription": "Detailed product description emphasizing technical specs and user-validated features",\n  "sellingPoints": ["USP 1 (from tech specs)", "USP 2 (from reviews)", "USP 3"],\n  "targetAudience": "Description of ideal customers based on use cases",\n  "category": "Product category",\n  "keywords": ["keyword1", "keyword2", "keyword3"],\n  "pricing": {\n    "current": "$.XX",\n    "original": "$.XX or null",\n    "discount": "XX% or null",\n    "competitiveness": "Premium/Competitive/Budget",\n    "valueAssessment": "Analysis of price-to-value ratio"\n  },\n  "reviews": {\n    "rating": 4.5,\n    "count": 1234,\n    "sentiment": "Positive/Mixed/Negative",\n    "positives": ["Pro 1", "Pro 2"],\n    "concerns": ["Con 1", "Con 2"],\n    "useCases": ["Use case 1", "Use case 2"]\n  },\n  "promotions": {\n    "active": true,\n    "types": ["Coupon", "Deal", "Lightning Deal"],\n    "urgency": "Limited time offer" or null\n  },\n  "competitiveEdges": {\n    "badges": ["Amazon''s Choice", "Best Seller"],\n    "primeEligible": true,\n    "stockStatus": "In Stock",\n    "salesRank": "#123 in Category"\n  },\n  "technicalHighlights": ["Key spec 1 (verified by reviews)", "Key spec 2", "Key spec 3"]\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));
INSERT INTO prompt_versions VALUES(70,'review_analysis','v3.1','评论分析','评论分析v3.1','支持模板变量、增强情感分析、购买动机和用户画像分析','src/lib/review-analyzer.ts','analyzeReviewsWithAI',replace('You are an expert e-commerce review analyst. Analyze the following product reviews comprehensively.\n\n=== INPUT DATA ===\nProduct Name: {{productName}}\nTotal Reviews: {{totalReviews}}\nTarget Language: {{langName}}\n\n=== REVIEWS DATA ===\n{{reviewTexts}}\n\n=== ANALYSIS REQUIREMENTS ===\n\nPerform deep analysis across these dimensions:\n\n1. **Sentiment Distribution** (Quantitative):\n   - Calculate percentage: positive / neutral / negative\n   - Identify sentiment patterns by star rating\n\n2. **Positive Keywords** (Top 10):\n   - Extract most frequently praised aspects\n   - Include specific features customers love\n   - Note emotional language patterns\n\n3. **Negative Keywords** (Top 10):\n   - Extract most common complaints\n   - Identify recurring issues\n   - Note severity levels\n\n4. **Real Use Cases** (5-8 scenarios):\n   - How customers actually use the product\n   - Unexpected use cases discovered\n   - Environment/context of usage\n\n5. **Purchase Reasons** (Top 5):\n   - Why customers chose this product\n   - Decision factors mentioned\n   - Comparison with alternatives\n\n6. **User Profiles** (3-5 types):\n   - Demographics (if mentioned)\n   - Experience levels\n   - Primary needs/goals\n\n7. **Common Pain Points** (Top 5):\n   - Issues that affect satisfaction\n   - Setup/usage difficulties\n   - Quality concerns\n\n=== OUTPUT LANGUAGE ===\nAll output MUST be in {{langName}}.\n\n=== OUTPUT FORMAT ===\nReturn a COMPLETE JSON object:\n{\n  "sentimentDistribution": {\n    "positive": 70,\n    "neutral": 20,\n    "negative": 10\n  },\n  "topPositiveKeywords": [\n    {"keyword": "easy to use", "frequency": 45, "context": "setup and daily operation"},\n    {"keyword": "great value", "frequency": 38, "context": "price-quality ratio"}\n  ],\n  "topNegativeKeywords": [\n    {"keyword": "battery life", "frequency": 12, "context": "shorter than expected"},\n    {"keyword": "instructions unclear", "frequency": 8, "context": "initial setup"}\n  ],\n  "realUseCases": [\n    {"scenario": "Home security monitoring", "frequency": "High", "satisfaction": "Positive"},\n    {"scenario": "Baby room monitoring", "frequency": "Medium", "satisfaction": "Positive"}\n  ],\n  "purchaseReasons": [\n    {"reason": "Brand reputation", "frequency": 25},\n    {"reason": "Feature set vs price", "frequency": 22}\n  ],\n  "userProfiles": [\n    {"type": "Tech-savvy homeowner", "percentage": 40, "primaryNeed": "Security"},\n    {"type": "First-time buyer", "percentage": 30, "primaryNeed": "Ease of use"}\n  ],\n  "commonPainPoints": [\n    {"issue": "WiFi connectivity issues", "severity": "Medium", "frequency": 15},\n    {"issue": "App crashes occasionally", "severity": "Low", "frequency": 8}\n  ],\n  "overallInsights": {\n    "productStrength": "Summary of main strengths",\n    "improvementAreas": "Summary of areas to improve",\n    "marketingAngles": ["Angle 1 for ads", "Angle 2 for ads"]\n  }\n}','\n',char(10)),'Chinese',NULL,'2025-12-04 14:03:03',1,replace('\nv3.1 更新内容:\n1. 批量更新所有Prompt到v3.1\n2. 从开发环境数据库导出最新Prompt内容\n','\n',char(10)));

-- ==========================================
-- End of Consolidated Schema
-- ==========================================

-- ==========================================
-- Reset sequences after seed data
-- ==========================================
SELECT setval('prompt_versions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM prompt_versions));

-- ==========================================
-- End of Consolidated PostgreSQL Schema
-- ==========================================
