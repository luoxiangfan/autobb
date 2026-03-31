-- ==========================================
-- AutoAds PostgreSQL Schema - Consolidated (Init + Migrations)
-- ==========================================
-- Includes: pg-migrations/000_init_schema_v2.pg.sql + pg-migrations/064-140*
-- Generated: 2026-01-17
-- Database: PostgreSQL 14+
-- NOTE: This file is auto-generated; edit pg-migrations/*.pg.sql instead.

-- Tip (psql): run with `-v ON_ERROR_STOP=1` to stop on first error

-- ====================================================================
-- SOURCE: pg-migrations/000_init_schema_v2.pg.sql
-- ====================================================================
-- ==========================================
-- AutoAds PostgreSQL Schema - Consolidated Edition
-- ==========================================
-- Version: 2.0.1 (Migrations 001-063, KISS optimized)
-- Generated: 2025-12-08
-- Database: PostgreSQL 14+
-- Description: Complete production-ready schema including all features
--
-- This schema consolidates all migrations (001-057) into a single
-- initialization script. It includes:
-- - 42 tables (offer_tasks, batch_tasks added; 5 tables removed)
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
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- For gen_random_uuid()
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
  openclaw_enabled BOOLEAN NOT NULL DEFAULT FALSE,
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
  product_name TEXT,            -- 产品名称（与brand配合使用）
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
  store_product_links TEXT,
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
  ai_reviews JSONB,             -- AI产品评论洞察（JSONB: rating, sentiment, positives, concerns）
  ai_competitive_edges JSONB,   -- AI竞争优势（JSONB: badges, primeEligible, stockStatus, salesRank）
  ai_keywords JSONB,            -- AI关键词列表（JSONB数组: 产品相关关键词）
  -- v3.2优化（2025-12-08）：店铺/单品差异化分析字段
  ai_analysis_v32 JSONB,        -- v3.2差异化分析数据（JSONB: storeQualityLevel, marketFit, credibilityLevel等）
  page_type TEXT DEFAULT 'product', -- 页面类型标识（store/product）
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
  product_url TEXT,            -- Product URL for independent store products (Migration 063)
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
  creative_type TEXT DEFAULT NULL,
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



-- REMOVED: creative_versions_backup (KISS optimization - table unused)

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



-- REMOVED: prompt_usage_stats (KISS optimization - table unused)

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
  -- 🔥 2026-01-06: risk_type 字段已删除，使用 alert_type 替代
  alert_type TEXT,
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resource_type TEXT,
  resource_id INTEGER,
  details TEXT,
  acknowledged_at TIMESTAMP,
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



-- REMOVED: scraped_products_new (KISS optimization - table unused)

-- ==========================================
-- Table: search_term_reports
-- ==========================================
CREATE TABLE search_term_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  ad_group_id INTEGER,
  google_ad_group_id TEXT,
  search_term TEXT NOT NULL,
  match_type TEXT NOT NULL,
  raw_match_type TEXT,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions NUMERIC NOT NULL DEFAULT 0,
  cost NUMERIC NOT NULL DEFAULT 0,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_group_id) REFERENCES ad_groups(id) ON DELETE SET NULL
);


-- ==========================================
-- Table: brand_core_keywords
-- ==========================================
CREATE TABLE brand_core_keywords (
  id SERIAL PRIMARY KEY,
  brand_key TEXT NOT NULL,
  brand_display TEXT,
  target_country TEXT NOT NULL,
  target_language TEXT NOT NULL,
  keyword_norm TEXT NOT NULL,
  keyword_display TEXT,
  source_mask TEXT NOT NULL,
  impressions_total INTEGER NOT NULL DEFAULT 0,
  clicks_total INTEGER NOT NULL DEFAULT 0,
  last_seen_at DATE,
  search_volume INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand_key, target_country, target_language, keyword_norm)
);


-- ==========================================
-- Table: brand_core_keyword_daily
-- ==========================================
CREATE TABLE brand_core_keyword_daily (
  brand_key TEXT NOT NULL,
  target_country TEXT NOT NULL,
  target_language TEXT NOT NULL,
  keyword_norm TEXT NOT NULL,
  date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  source_mask TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand_key, target_country, target_language, keyword_norm, date)
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


-- Index: idx_offers_page_type (on table: offers) -- v3.2优化
CREATE INDEX idx_offers_page_type ON offers(page_type);


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


-- REMOVED: prompt_usage_stats table indexes (table was removed in KISS optimization)
-- CREATE INDEX idx_prompt_usage_stats_date ON prompt_usage_stats(usage_date);
-- CREATE INDEX idx_prompt_usage_stats_prompt ON prompt_usage_stats(prompt_id, version);


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

-- Index: idx_search_terms_campaign_adgroup_date (on table: search_term_reports)
CREATE INDEX idx_search_terms_campaign_adgroup_date
ON search_term_reports(campaign_id, ad_group_id, date DESC);


-- Index: idx_search_terms_term (on table: search_term_reports)
CREATE INDEX idx_search_terms_term
ON search_term_reports(search_term);

-- Index: idx_search_terms_google_adgroup (on table: search_term_reports)
CREATE INDEX idx_search_terms_google_adgroup
ON search_term_reports(google_ad_group_id);


-- Index: idx_search_terms_user_id (on table: search_term_reports)
CREATE INDEX idx_search_terms_user_id
ON search_term_reports(user_id);


-- Index: idx_brand_core_lookup (on table: brand_core_keywords)
CREATE INDEX idx_brand_core_lookup
ON brand_core_keywords(brand_key, target_country, target_language);


-- Index: idx_brand_core_last_seen (on table: brand_core_keywords)
CREATE INDEX idx_brand_core_last_seen
ON brand_core_keywords(brand_key, last_seen_at);


-- Index: idx_brand_core_daily_date (on table: brand_core_keyword_daily)
CREATE INDEX idx_brand_core_daily_date
ON brand_core_keyword_daily(date);


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

INSERT INTO prompt_versions VALUES(59,'ad_creative_generation','v4.0','广告创意生成','广告创意生成v4.0 - AI增强版','利用AI完整分析数据的广告创意生成系统，包含AI关键词、竞争优势、评论洞察','src/lib/ad-creative-generator.ts','buildAdCreativePrompt',$${{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

🎯 **AI增强数据 (P0优化 - 2025-12-07)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

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
}$$,'Chinese',NULL,'2025-12-08 10:00:00',TRUE,$$
v4.0 更新内容:
1. 【P0优化】新增AI增强数据section：{{ai_keywords_section}}, {{ai_competitive_section}}, {{ai_reviews_section}}
2. 【功能增强】优先使用AI生成的完整分析数据（ai_keywords, ai_competitive_edges, ai_reviews）
3. 【质量提升】利用AI评论洞察、使用场景、竞争优势等深度数据
4. 【向后兼容】保留原有数据fallback机制，确保旧数据仍可正常使用
5. 【性能优化】数据利用率从60%提升至100%，预期广告创意质量提升20-30%
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
-- REMOVED: v_phase3_statistics (KISS optimization)

-- View 3: Top Hot Products
-- Lists all hot products with offer details, ordered by rank
-- REMOVED: v_top_hot_products (KISS optimization)


-- ==========================================
-- offer_tasks Table (Task Queue Architecture)
-- ==========================================
-- ==========================================
-- batch_tasks Table (Must be defined first - referenced by offer_tasks)
-- ==========================================
CREATE TABLE batch_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,

  -- Batch task type and status
  task_type VARCHAR(20) NOT NULL CHECK(task_type IN ('offer-creation', 'offer-scrape', 'offer-enhance')) DEFAULT 'offer-creation',
  status VARCHAR(20) NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'partial')) DEFAULT 'pending',

  -- Progress statistics
  total_count INTEGER DEFAULT 0 CHECK(total_count >= 0),
  completed_count INTEGER DEFAULT 0 CHECK(completed_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),

  -- Batch metadata
  source_file TEXT,
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Foreign key
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX idx_batch_tasks_user_status ON batch_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_batch_tasks_status_created ON batch_tasks(status, created_at);
CREATE INDEX idx_batch_tasks_user_created ON batch_tasks(user_id, created_at DESC);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_batch_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_batch_tasks_updated_at
BEFORE UPDATE ON batch_tasks
FOR EACH ROW
EXECUTE FUNCTION update_batch_tasks_updated_at();

-- ==========================================
-- offer_tasks Table (References batch_tasks)
-- ==========================================
CREATE TABLE offer_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,

  -- Task status and progress
  status VARCHAR(20) NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  stage VARCHAR(50),
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  message TEXT,

  -- Input parameters
  affiliate_link TEXT NOT NULL,
  target_country VARCHAR(10) NOT NULL,
  page_type TEXT,
  store_product_links TEXT,
  skip_cache BOOLEAN DEFAULT FALSE,
  skip_warmup BOOLEAN DEFAULT FALSE,
  product_price TEXT,
  commission_payout TEXT,

  -- Task relationships
  batch_id UUID,
  offer_id INTEGER,

  -- Output results
  result JSONB,
  error JSONB,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Foreign keys
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batch_tasks(id) ON DELETE SET NULL,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL
);

-- Performance indexes
CREATE INDEX idx_offer_tasks_user_status ON offer_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_offer_tasks_status_created ON offer_tasks(status, created_at);
CREATE INDEX idx_offer_tasks_user_created ON offer_tasks(user_id, created_at DESC);
CREATE INDEX idx_offer_tasks_updated ON offer_tasks(updated_at DESC);
CREATE INDEX idx_offer_tasks_batch_id ON offer_tasks(batch_id, status);
CREATE INDEX idx_offer_tasks_offer_id ON offer_tasks(offer_id);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_offer_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_offer_tasks_updated_at
BEFORE UPDATE ON offer_tasks
FOR EACH ROW
EXECUTE FUNCTION update_offer_tasks_updated_at();

-- End of Task Queue Tables

-- ====================================================================
-- Seed admin user (id=1) for FK references in seed data
-- ====================================================================
INSERT INTO users (
  username,
  email,
  password_hash,
  display_name,
  role,
  package_type,
  package_expires_at,
  must_change_password,
  is_active,
  openclaw_enabled,
  created_at,
  updated_at
) VALUES (
  'autoads',
  'admin@autoads.com',
  'init-placeholder-hash',
  'AutoAds Administrator',
  'admin',
  'lifetime',
  '2099-12-31 23:59:59',
  TRUE,
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;

-- ====================================================================
-- SOURCE: pg-migrations/064_consolidated_schema_changes.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 064_consolidated_schema_changes.pg.sql
-- Description: 合并Schema变更（PostgreSQL版）
-- Date: 2025-12-14
--
-- 整合来源:
--   - 065: CREATE creative_tasks
--   - 067: ALTER google_ads_accounts ADD status
--   - 068: ALTER ad_creatives ADD ad_strength_data
--   - 069: ALTER scraped_products ADD sales_volume, discount, delivery_info
--   - 070: CREATE upload_records, audit_logs
--   - 072: ALTER offers ADD product_name
--   - 077: ALTER launch_scores ADD dimension columns, ALTER ad_creatives ADD path1/path2
-- =====================================================

-- ============================================================
-- PART 1: CREATE creative_tasks (原065)
-- ============================================================

CREATE TABLE IF NOT EXISTS creative_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 任务状态
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  stage TEXT DEFAULT 'init',
  progress INTEGER DEFAULT 0,
  message TEXT,

  -- 输入参数
  max_retries INTEGER DEFAULT 3,
  target_rating TEXT DEFAULT 'EXCELLENT',

  -- 执行状态
  current_attempt INTEGER DEFAULT 0,
  optimization_history JSONB,

  -- 结果数据
  creative_id INTEGER,
  result JSONB,
  error JSONB,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_creative_tasks_user_status ON creative_tasks(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_tasks_status_created ON creative_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_creative_tasks_offer_id ON creative_tasks(offer_id);
CREATE INDEX IF NOT EXISTS idx_creative_tasks_updated ON creative_tasks(updated_at DESC);

-- ============================================================
-- PART 2: CREATE upload_records (原070)
-- ============================================================

CREATE TABLE IF NOT EXISTS upload_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  batch_id UUID NOT NULL,

  -- File information
  file_name TEXT NOT NULL,
  file_size INTEGER,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Processing statistics
  valid_count INTEGER DEFAULT 0 CHECK(valid_count >= 0),
  processed_count INTEGER DEFAULT 0 CHECK(processed_count >= 0),
  skipped_count INTEGER DEFAULT 0 CHECK(skipped_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),
  success_rate REAL DEFAULT 0.0 CHECK(success_rate >= 0 AND success_rate <= 100),

  -- Status tracking
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'partial')) DEFAULT 'pending',

  -- Metadata
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batch_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_upload_records_user_uploaded ON upload_records(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_records_batch ON upload_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_upload_records_status ON upload_records(status, uploaded_at DESC);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_upload_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_upload_records_updated_at ON upload_records;
CREATE TRIGGER update_upload_records_updated_at
BEFORE UPDATE ON upload_records
FOR EACH ROW
EXECUTE FUNCTION update_upload_records_updated_at();

-- Trigger for success_rate calculation
CREATE OR REPLACE FUNCTION update_upload_records_success_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.valid_count > 0 THEN
    NEW.success_rate = ROUND((NEW.processed_count::numeric / NEW.valid_count) * 100, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_upload_records_success_rate ON upload_records;
CREATE TRIGGER update_upload_records_success_rate
BEFORE UPDATE OF processed_count, valid_count ON upload_records
FOR EACH ROW
EXECUTE FUNCTION update_upload_records_success_rate();

-- ============================================================
-- PART 3: CREATE audit_logs (原070)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);

-- ============================================================
-- PART 4: ALTER google_ads_accounts (原067)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_accounts' AND column_name = 'status'
  ) THEN
    ALTER TABLE google_ads_accounts ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ENABLED';
  END IF;
END $$;

UPDATE google_ads_accounts SET status = 'ENABLED' WHERE status IS NULL;

-- ============================================================
-- PART 5: ALTER ad_creatives (原068, 077)
-- ============================================================

DO $$
BEGIN
  -- Add ad_strength_data column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'ad_strength_data'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS ad_strength_data JSONB DEFAULT NULL;
  END IF;

  -- Add path1 column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'path1'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS path1 TEXT DEFAULT NULL;
  END IF;

  -- Add path2 column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'path2'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS path2 TEXT DEFAULT NULL;
  END IF;
END $$;

-- ============================================================
-- PART 6: ALTER scraped_products (原069)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'sales_volume'
  ) THEN
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS sales_volume TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'discount'
  ) THEN
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS discount TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'delivery_info'
  ) THEN
    ALTER TABLE scraped_products ADD COLUMN IF NOT EXISTS delivery_info TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scraped_products_sales_volume
  ON scraped_products(offer_id, sales_volume);

-- ============================================================
-- PART 7: ALTER offers (原072)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'product_name'
  ) THEN
    ALTER TABLE offers ADD COLUMN IF NOT EXISTS product_name TEXT;
  END IF;
END $$;

-- ============================================================
-- PART 8: ALTER launch_scores (原077)
-- ============================================================

DO $$
BEGIN
  -- Add dimension score columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'launch_viability_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS launch_viability_score INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'ad_quality_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS ad_quality_score INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'keyword_strategy_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS keyword_strategy_score INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'basic_config_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS basic_config_score INTEGER DEFAULT 0;
  END IF;

  -- Add dimension data columns (JSONB)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'launch_viability_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS launch_viability_data JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'ad_quality_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS ad_quality_data JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'keyword_strategy_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS keyword_strategy_data JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'basic_config_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS basic_config_data JSONB;
  END IF;
END $$;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('creative_tasks', 'upload_records', 'audit_logs');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'google_ads_accounts' AND column_name = 'status';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name IN ('ad_strength_data', 'path1', 'path2');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'scraped_products' AND column_name IN ('sales_volume', 'discount', 'delivery_info');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'product_name';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'launch_scores' AND column_name LIKE '%_score' OR column_name LIKE '%_data';

-- ====================================================================
-- SOURCE: pg-migrations/065_consolidated_prompt_ad_creative.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 065_consolidated_prompt_ad_creative.pg.sql
-- Description: 合并广告创意生成Prompts（PostgreSQL版）
-- Date: 2025-12-14
--
-- 最终版本:
--   - ad_creative_generation v4.8 (关键词嵌入率强化)
--   - ad_elements_headlines v3.3 (CTR优化增强)
--   - ad_elements_descriptions v3.3 (CTR优化增强)
-- =====================================================

-- ============================================================
-- PART 1: Deactivate all old versions
-- ============================================================

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_creative_generation' AND is_active = true;
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_headlines' AND is_active = true;
UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_elements_descriptions' AND is_active = true;

-- ============================================================
-- PART 2: ad_creative_generation v4.8 (最终版本)
-- ============================================================

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active,
  created_at
) VALUES (
  'ad_creative_generation',
  '广告创意生成v4.8 - 关键词嵌入率强化版',
  'v4.8',
  '广告创意生成',
  '强化关键词嵌入率：从27%提升到53%+，增加强制性嵌入规则和验证机制',
  'prompts/ad_creative_generation_v4.8.txt',
  'generateAdCreative',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

🎯 **AI增强数据 (v4.8优化 - 2025-12-14)**:
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

## 🚨 v4.8 关键词嵌入率强化 (CRITICAL - 最高优先级)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**这是Ad Strength评估的核心指标，必须严格遵守！**

**🔑 关键词嵌入规则 (MANDATORY)**:

**规则1: 关键词来源 (从{{ai_keywords_section}}选择)**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 产品核心词必须出现在至少4个标题中
- 功能特性词必须出现在至少2个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)

**规则3: 标题类型与关键词匹配**
| 标题类型 | 必须嵌入的关键词类型 | 示例 |
|---------|---------------------|------|
| brand | 品牌词 | "Eufy Security Official" |
| feature | 产品核心词+功能词 | "4K Solar Camera" |
| promo | 产品词+促销词 | "Security Camera Sale" |
| cta | 产品词+行动词 | "Shop Wireless Cameras" |

**规则4: 嵌入数量分配 (总计≥8个)**

## 🆕 v4.7 RSA Display Path (保留)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## 🔥 v4.6 CTR优化增强 (保留)

### 🎯 情感触发词策略 (EMOTIONAL TRIGGERS - CTR +10-15%)
### 🎯 问句式标题 (QUESTION HEADLINES - CTR +5-12%)

## 🔥 v4.5 店铺数据增强 (保留)
## 🔥 v4.4 产品特性增强 (保留)
## 🔥 v4.2 竞争定位增强 (保留)

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**🚨 v4.8 HEADLINE REQUIREMENTS (强制执行)**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity

### DESCRIPTIONS (4 required, ≤90 chars each)
**🎯 v4.6 DESCRIPTION REQUIREMENTS**

### 🆕 DISPLAY PATH (v4.7)
### KEYWORDS (20-30 required)
### CALLOUTS (4-6, ≤25 chars)
### SITELINKS (6)

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"...", "length":N, "keywords":[], "hasNumber":bool}...],
  "descriptions": [{"text":"...", "type":"...", "length":N, "hasCTA":bool}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "quality_metrics": {...},
  "ctr_optimization": {...}
}',
  'v4.8合并版: 整合v4.1-v4.8所有优化，关键词嵌入率强化53%+',
  true,
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 3: ad_elements_headlines v3.3
-- ============================================================

INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_elements_headlines',
  'v3.3',
  '广告创意生成',
  '广告标题生成v3.3 - CTR优化增强版',
  'CTR优化增强版：DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== PRODUCT FEATURES ===
About This Item: {{product.aboutThisItem}}
Key Features: {{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.3 CTR OPTIMIZATION STRATEGIES ===
**Strategy 1: NUMBERS & SPECIFICS** (CTR +15-25%)
**Strategy 2: EMOTIONAL TRIGGERS** (CTR +10-15%)
**Strategy 3: QUESTION HEADLINES** (CTR +5-12%)
**Strategy 4: DKI-READY TEMPLATES** (CTR +15-25%)

=== HEADLINE GROUPS (15 total) ===
**Group 1: Brand + Product (3 headlines)**
**Group 2: Keyword-Rich (3 headlines)**
**Group 3: Feature + Number (3 headlines)**
**Group 4: Emotional + Social Proof (3 headlines)**
**Group 5: Question + CTA (3 headlines)**

=== RULES ===
1. Each headline MUST be <= 30 characters
2. 🔥 **Keyword Embedding**: At least 8/15 headlines must contain keywords
3. 🔥 **Number Usage**: At least 5/15 headlines must contain specific numbers
4. 🔥 **Diversity**: No two headlines should share more than 2 words

=== OUTPUT FORMAT ===
Return JSON with headlines, headlineAnalysis, ctrOptimization',
  true,
  'v3.3 CTR优化: DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率(8/15)',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 4: ad_elements_descriptions v3.3
-- ============================================================

INSERT INTO prompt_versions (prompt_id, version, category, name, description, file_path, function_name, prompt_content, is_active, change_notes, created_at)
VALUES (
  'ad_elements_descriptions',
  'v3.3',
  '广告创意生成',
  '广告描述生成v3.3 - CTR优化增强版',
  'CTR优化增强版：结构化模板、USP前置、社会证明、竞品差异化',
  'src/lib/ad-elements-extractor.ts',
  'generateDescriptions',
  'You are a professional Google Ads copywriter specializing in high-converting descriptions.

=== PRODUCT INFORMATION ===
Product Name: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}} ({{reviewCount}} reviews)

=== PRODUCT FEATURES ===
Key Features: {{features}}
Selling Points: {{sellingPoints}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}
**UNIQUE SELLING POINTS**: {{uniqueSellingPoints}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== 🎯 v3.3 STRUCTURED DESCRIPTION TEMPLATES ===
**Template 1: FEATURE-BENEFIT-CTA** (Conversion +10-15%)
**Template 2: PROBLEM-SOLUTION-PROOF** (Trust +20%)
**Template 3: OFFER-URGENCY-TRUST** (CTR +15%)
**Template 4: USP-DIFFERENTIATION** (Conversion +8%)

=== 🎯 v3.3 USP FRONT-LOADING RULE ===
First 30 characters of each description are most important!

=== 🎯 v3.3 SOCIAL PROOF EMBEDDING ===
=== 🎯 v3.3 COMPETITOR DIFFERENTIATION ===

=== RULES ===
1. Each description MUST be <= 90 characters
2. 🔥 **USP Front-Loading**: Strongest selling point in first 30 chars
3. 🔥 **Social Proof**: At least 2/4 descriptions must include proof
4. 🔥 **Differentiation**: At least 1 description must use implicit comparison
5. 🔥 **Diversity**: Each description MUST follow a DIFFERENT template

=== OUTPUT FORMAT ===
Return JSON with descriptions, descriptionTemplates, ctrOptimization, dataUtilization',
  true,
  'v3.3 CTR优化: 结构化描述模板(4种)、USP前置规则(前30字符)、社会证明嵌入、竞品差异化暗示',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('ad_creative_generation', 'ad_elements_headlines', 'ad_elements_descriptions') ORDER BY prompt_id, version DESC;

-- ====================================================================
-- SOURCE: pg-migrations/066_consolidated_prompt_analysis.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 066_consolidated_prompt_analysis.pg.sql
-- Description: 合并分析类Prompts（PostgreSQL版）
-- Date: 2025-12-14
--
-- 最终版本:
--   - product_analysis_single v3.2 (productHighlights字段修复)
--   - brand_analysis_store v3.2 (productHighlights字段添加)
--   - review_analysis v3.2 (quantitativeHighlights + competitorMentions)
--   - competitor_analysis v3.2 (competitorWeaknesses)
--   - keywords_generation v3.2 (禁止竞品关键词)
--   - store_highlights_synthesis v1.0 (店铺产品亮点整合)
--   - launch_score v4.0 (4维度投放评分体系)
-- =====================================================

-- ============================================================
-- PART 1: product_analysis_single v3.2 (字段修复)
-- ============================================================

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'product_analysis_single' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
)
SELECT
  prompt_id,
  'v3.2' as version,
  category,
  '单品产品分析v3.2' as name,
  '修复字段名不一致：统一使用productHighlights' as description,
  file_path,
  function_name,
  REPLACE(prompt_content, '"technicalHighlights"', '"productHighlights"') as prompt_content,
  language,
  true as is_active,
  '🔧 修复：将AI返回字段从technicalHighlights统一为productHighlights' as change_notes,
  NOW() as created_at
FROM prompt_versions
WHERE prompt_id = 'product_analysis_single' AND version = 'v3.1'
ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 2: brand_analysis_store v3.2 (字段添加)
-- ============================================================

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'brand_analysis_store' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
)
SELECT
  prompt_id,
  'v3.2' as version,
  category,
  '品牌店铺分析v3.2' as name,
  '为热销商品添加productHighlights字段' as description,
  file_path,
  function_name,
  REPLACE(
    prompt_content,
    '"successFactors": ["Factor 1", "Factor 2"]',
    '"successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]'
  ) as prompt_content,
  language,
  true as is_active,
  '🔧 增强：为热销商品添加productHighlights字段' as change_notes,
  NOW() as created_at
FROM prompt_versions
WHERE prompt_id = 'brand_analysis_store' AND version = 'v3.1'
ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 3: review_analysis v3.2 (增强数字提取)
-- ============================================================

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'review_analysis';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'review_analysis',
  'v3.2',
  '产品分析',
  '评论分析v3.2',
  '评论分析v3.2 - 增强数字提取和竞品提及分析',
  'src/lib/review-analyzer.ts',
  'analyzeReviews',
  $$You are an expert e-commerce review analyst.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===
1. **Sentiment Distribution** (Quantitative)
2. **Positive Keywords** (Top 10)
3. **Negative Keywords** (Top 10)
4. **Real Use Cases** (5-8 scenarios)
5. **Purchase Reasons** (Top 5)
6. **User Profiles** (3-5 types)
7. **Common Pain Points** (Top 5)
8. **Quantitative Highlights** (NEW - numbers from reviews)
9. **Competitor Mentions** (NEW - brand comparisons)

=== OUTPUT FORMAT ===
Return JSON with all analysis fields including quantitativeHighlights and competitorMentions$$,
  'English',
  true,
  'v3.2: quantitativeHighlights + competitorMentions',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 4: competitor_analysis v3.2 (竞品弱点挖掘)
-- ============================================================

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'competitor_analysis';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'competitor_analysis',
  'v3.2',
  '产品分析',
  '竞品分析v3.2',
  '竞品分析v3.2 - 新增竞品弱点挖掘',
  'src/lib/competitor-analyzer.ts',
  'analyzeCompetitors',
  $$You are an e-commerce competitive analysis expert.

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
1. **Feature Comparison**
2. **Unique Selling Points (USPs)**
3. **Competitor Advantages**
4. **Competitor Weaknesses** (NEW - for ad differentiation)
5. **Overall Competitiveness** (0-100)

=== OUTPUT FORMAT ===
Return JSON with featureComparison, uniqueSellingPoints, competitorAdvantages, competitorWeaknesses, overallCompetitiveness$$,
  'English',
  true,
  'v3.2: competitorWeaknesses for ad differentiation',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 5: keywords_generation v3.2 (禁止竞品关键词)
-- ============================================================

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'keywords_generation' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
) VALUES (
  'keywords_generation',
  'v3.2',
  '关键词生成',
  '关键词生成v3.2',
  '修复竞品关键词冲突：禁止生成竞品品牌关键词',
  'src/lib/keyword-generator.ts',
  'generateKeywords',
  'You are a Google Ads keyword expert.

=== INPUT DATA ===
Brand: {{offer.brand}}
Brand Description: {{offer.brand_description}}
Target Country: {{offer.target_country}}
Category: {{offer.category}}

=== PRODUCT DETAILS ===
Product Name: {{productName}}
Product Features: {{productFeatures}}
Selling Points: {{sellingPoints}}

=== TASK ===
Generate 30 high-quality Google Ads keywords.

=== KEYWORD STRATEGY ===
1. **Brand Keywords** (5-7)
2. **Category Keywords** (8-10)
3. **Feature Keywords** (5-7)
4. **Intent Keywords** (5-7)
5. **Long-tail Keywords** (3-5)

=== CRITICAL RESTRICTIONS ===
⚠️ DO NOT generate competitor brand keywords!

=== OUTPUT FORMAT ===
Return JSON with keywords, estimatedBudget, recommendations',
  'English',
  1,
  true,
  '禁止生成竞品品牌关键词，避免与否定关键词冲突',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- PART 6: store_highlights_synthesis v1.0
-- ============================================================

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, is_active, created_at
) VALUES (
  'store_highlights_synthesis',
  'v1.0',
  '品牌分析',
  '店铺产品亮点整合v1.0',
  '从热销商品的产品亮点中智能整合提炼出店铺级的核心产品亮点',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a product marketing expert. Analyze the product highlights from {{productCount}} hot-selling products and synthesize them into 5-8 key store-level product highlights.

=== INPUT ===
{{productHighlights}}

=== TASK ===
Synthesize into 5-8 concise, store-level product highlights.

=== OUTPUT FORMAT ===
Return JSON: {"storeHighlights": ["Highlight 1", ...]}

Output in {{langName}}.',
  true,
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content;

-- ============================================================
-- PART 7: launch_score v4.0 (4维度投放评分体系)
-- ============================================================
-- 问题修复：077迁移文件遗漏了此prompt的插入
-- 代码 src/lib/scoring.ts 调用 loadPrompt('launch_score')

INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes,
  created_at
) VALUES (
  'launch_score',
  'v4.0',
  '投放评分',
  '投放评分v4.0',
  'Launch Score 4维度评分体系 - 投放可行性/广告质量/关键词策略/基础配置',
  'src/lib/scoring.ts',
  'calculateLaunchScore',
  $$You are a professional Google Ads campaign launch evaluator using the NEW 4-DIMENSION scoring system.

=== CAMPAIGN OVERVIEW ===
Brand: {{brand}}
Product: {{productName}}
Target Country: {{targetCountry}}
Target Language: {{targetLanguage}}
Campaign Budget: {{budget}}
Max CPC: {{maxCpc}}

=== PRODUCT ECONOMICS ===
Product Price: {{productPrice}}
Commission Rate: {{commissionRate}}
Profit per Sale: {{profitPerSale}}
Break-even CPC: {{breakEvenCpc}} (based on 50 clicks per conversion)

=== BRAND SEARCH DATA ===
Brand Name: {{brand}}
Brand Search Volume (monthly): {{brandSearchVolume}}
Brand Competition Level: {{brandCompetition}}

=== KEYWORDS DATA ===
Total Keywords: {{keywordCount}}
Match Type Distribution: {{matchTypeDistribution}}
Keywords with Volume:
{{keywordsWithVolume}}

Negative Keywords ({{negativeKeywordsCount}}): {{negativeKeywords}}

=== AD CREATIVES ===
Headlines Count: {{headlineCount}}
Descriptions Count: {{descriptionCount}}
Sample Headlines: {{sampleHeadlines}}
Sample Descriptions: {{sampleDescriptions}}
Headline Diversity: {{headlineDiversity}}%
Ad Strength: {{adStrength}}

=== LANDING PAGE ===
Final URL: {{finalUrl}}
Page Type: {{pageType}}

=== 4-DIMENSION SCORING SYSTEM (Total 100 points) ===

**DIMENSION 1: Launch Viability (35 points)**
Evaluates whether this campaign is worth launching based on market potential and economics.

- Brand Search Volume Score (0-15 points):
  * 0-100 monthly searches: 0-3 points (very low awareness)
  * 100-500 searches: 4-7 points (emerging brand)
  * 500-2000 searches: 8-11 points (established brand)
  * 2000+ searches: 12-15 points (strong brand)

- Profit Margin Score (0-10 points):
  * Compare Break-even CPC vs actual Max CPC
  * If Max CPC < 50% of Break-even: 8-10 points (high margin)
  * If Max CPC = 50-80% of Break-even: 5-7 points (healthy margin)
  * If Max CPC = 80-100% of Break-even: 2-4 points (tight margin)
  * If Max CPC > Break-even: 0-1 points (likely loss)

- Competition Score (0-10 points):
  * LOW competition: 8-10 points
  * MEDIUM competition: 4-7 points
  * HIGH competition: 0-3 points

**DIMENSION 2: Ad Quality (30 points)**
Evaluates the quality and effectiveness of ad creatives.

- Ad Strength Score (0-15 points):
  * POOR: 0-3 points
  * AVERAGE: 4-8 points
  * GOOD: 9-12 points
  * EXCELLENT: 13-15 points

- Headline Diversity Score (0-8 points):
  * Evaluate uniqueness and variety of 15 headlines
  * High diversity (>80%): 7-8 points
  * Medium diversity (50-80%): 4-6 points
  * Low diversity (<50%): 0-3 points

- Description Quality Score (0-7 points):
  * Strong CTA and benefits: 6-7 points
  * Adequate but generic: 3-5 points
  * Weak or missing CTA: 0-2 points

**DIMENSION 3: Keyword Strategy (20 points)**
Evaluates keyword selection and targeting strategy.

- Relevance Score (0-8 points):
  * How well keywords match product/brand
  * High relevance: 7-8 points
  * Medium relevance: 4-6 points
  * Low relevance: 0-3 points

- Match Type Score (0-6 points):
  * Balanced mix of exact/phrase/broad: 5-6 points
  * Mostly one type: 2-4 points
  * Only broad match: 0-1 points

- Negative Keywords Score (0-6 points):
  * Comprehensive negative list (20+): 5-6 points
  * Basic coverage (10-20): 3-4 points
  * Minimal (5-10): 1-2 points
  * None: 0 points (CRITICAL ISSUE)

**DIMENSION 4: Basic Configuration (15 points)**
Evaluates technical setup and configuration.

- Country/Language Match Score (0-5 points):
  * Perfect match: 5 points
  * Minor mismatch: 2-4 points
  * Major mismatch: 0-1 points

- Final URL Score (0-5 points):
  * Valid, relevant URL: 4-5 points
  * Valid but suboptimal: 2-3 points
  * Issues detected: 0-1 points

- Budget Reasonability Score (0-5 points):
  * Budget allows adequate testing: 4-5 points
  * Budget is tight: 2-3 points
  * Budget too low for meaningful data: 0-1 points

=== OUTPUT FORMAT ===
Return ONLY valid JSON with this EXACT structure:

{
  "launchViability": {
    "score": 28,
    "brandSearchVolume": 1500,
    "brandSearchScore": 10,
    "profitMargin": 2.5,
    "profitScore": 8,
    "competitionLevel": "MEDIUM",
    "competitionScore": 5,
    "issues": ["Issue 1", "Issue 2"],
    "suggestions": ["Suggestion 1"]
  },
  "adQuality": {
    "score": 24,
    "adStrength": "GOOD",
    "adStrengthScore": 12,
    "headlineDiversity": 75,
    "headlineDiversityScore": 6,
    "descriptionQuality": 80,
    "descriptionQualityScore": 6,
    "issues": [],
    "suggestions": ["Add more unique headlines"]
  },
  "keywordStrategy": {
    "score": 16,
    "relevanceScore": 7,
    "matchTypeScore": 5,
    "negativeKeywordsScore": 4,
    "totalKeywords": 50,
    "negativeKeywordsCount": 15,
    "matchTypeDistribution": {"EXACT": 20, "PHRASE": 15, "BROAD": 15},
    "issues": ["Need more negative keywords"],
    "suggestions": ["Add negative keywords for free, download, repair"]
  },
  "basicConfig": {
    "score": 12,
    "countryLanguageScore": 5,
    "finalUrlScore": 4,
    "budgetScore": 3,
    "targetCountry": "US",
    "targetLanguage": "English",
    "finalUrl": "https://example.com",
    "dailyBudget": 10,
    "maxCpc": 0.17,
    "issues": ["Budget may be low for competitive keywords"],
    "suggestions": ["Consider increasing daily budget to $20"]
  },
  "overallRecommendations": [
    "Most critical action item 1",
    "Important improvement 2",
    "Nice to have 3"
  ]
}

CRITICAL RULES:
1. Use EXACT field names as shown above
2. All scores must be within their dimension limits
3. Total score = launchViability.score + adQuality.score + keywordStrategy.score + basicConfig.score
4. Return ONLY the JSON object, no additional text$$,
  'English',
  true,
  'Launch Score v4.0: 重构为4维度评分体系 - 投放可行性(35分)/广告质量(30分)/关键词策略(20分)/基础配置(15分)',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT prompt_id, version, is_active FROM prompt_versions
-- WHERE prompt_id IN ('product_analysis_single', 'brand_analysis_store', 'review_analysis',
--                     'competitor_analysis', 'keywords_generation', 'store_highlights_synthesis',
--                     'launch_score')
-- ORDER BY prompt_id, version DESC;

-- ====================================================================
-- SOURCE: pg-migrations/067_fix_prompt_missing_variables.pg.sql
-- ====================================================================
-- ============================================================================
-- Migration 067: Fix prompt templates missing variables + optimize instructions (PostgreSQL)
-- ============================================================================
--
-- 问题描述:
--   多个prompt模板中缺少变量占位符，导致代码准备的数据无法传递给AI，
--   影响生成内容的质量和相关性
--
-- 修复内容:
--   1. brand_name_extraction v3.1 → v3.2: 添加4个输入变量 + 提取策略指导
--   2. ad_elements_headlines v3.3 → v3.4: 添加4个深度分析变量 + 使用优先级指导
--   3. brand_analysis_store v3.2 → v3.4: 添加2个数据变量 + 使用指导
--
-- SQLite vs PostgreSQL差异:
--   - is_active: SQLite用1/0, PostgreSQL用true/false
--
-- 日期: 2025-12-14
-- ============================================================================

-- ============================================================================
-- PART 1: brand_name_extraction v3.1 → v3.2
-- 添加: {{pageData.url}}, {{pageData.title}}, {{pageData.description}}, {{pageData.textPreview}}
-- 优化: 增加提取策略指导（URL/Title/Description/Content优先级）
-- ============================================================================

UPDATE prompt_versions
SET
  version = 'v3.2',
  name = '品牌名称提取v3.2',
  prompt_content = 'You are a brand name extraction expert. Extract the brand name from product information.

=== INPUT DATA ===
URL: {{pageData.url}}
Title: {{pageData.title}}
Description: {{pageData.description}}
Page Content Preview: {{pageData.textPreview}}

=== EXTRACTION STRATEGY ===

**Priority 1: URL Analysis**
- Amazon store URLs often contain brand: amazon.com/stores/BRANDNAME
- Product URLs may have brand in path: /dp/B0xxx/BRAND-Product-Name

**Priority 2: Title Analysis**
- Brand usually appears FIRST in product titles
- Pattern: "BRANDNAME Product Description"
- Example: "Reolink 4K Security Camera" → "Reolink"

**Priority 3: Description Analysis**
- Look for "by BRAND" or "from BRAND" patterns
- Check for trademark symbols: BRAND™ or BRAND®

**Priority 4: Content Preview**
- Scan for repeated brand mentions
- Look for "Official BRAND Store" patterns

=== RULES ===
1. Return ONLY the brand name (no explanation)
2. 2-30 characters
3. Primary brand only (not sub-brands)
4. Remove suffixes: "Store", "Official", "Shop", "Inc", "LLC"
5. Preserve original capitalization

=== EXAMPLES ===
- "Reolink 4K Security Camera" → "Reolink"
- "BAGSMART Store" → "BAGSMART"
- "Apple iPhone 15 Pro" → "Apple"
- "Official Samsung Galaxy Store" → "Samsung"

Output: Brand name only.',
  change_notes = 'v3.2: 添加输入数据变量并增强提取策略指导'
WHERE prompt_id = 'brand_name_extraction' AND is_active = true;

-- ============================================================================
-- PART 2: ad_elements_headlines v3.3 → v3.4
-- 添加: {{product.uniqueSellingPoints}}, {{product.targetAudience}},
--       {{product.productHighlights}}, {{product.brandDescription}}
-- 优化: 增加深度分析数据使用优先级指导
-- ============================================================================

UPDATE prompt_versions
SET
  version = 'v3.4',
  name = '广告标题生成v3.4 - CTR优化增强版',
  prompt_content = 'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== 🎯 DEEP ANALYSIS DATA (v3.4 - PRIORITY DATA) ===
**Unique Selling Points**: {{product.uniqueSellingPoints}}
**Target Audience**: {{product.targetAudience}}
**Product Highlights**: {{product.productHighlights}}
**Brand Description**: {{product.brandDescription}}

⚠️ CRITICAL: The above deep analysis data is AI-extracted insights.
USE THIS DATA FIRST when creating headlines - it contains the most valuable differentiators.

=== PRODUCT FEATURES ===
About This Item:
{{product.aboutThisItem}}

Key Features:
{{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}
**TOP REVIEW QUOTES**: {{topReviewQuotes}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.4 DEEP ANALYSIS UTILIZATION (HIGHEST PRIORITY) ===

**Rule 1: USP-First Headlines (3-4 headlines)**
- Extract key phrases from {{product.uniqueSellingPoints}}
- Transform USPs into compelling 30-char headlines
- Example: USP "No monthly subscription fees" → "No Monthly Fees Ever"

**Rule 2: Audience-Targeted Headlines (2-3 headlines)**
- Reference {{product.targetAudience}} demographics/needs
- Speak directly to their pain points
- Example: Audience "homeowners worried about security" → "Protect Your Home 24/7"

**Rule 3: Highlight-Based Headlines (2-3 headlines)**
- Use specific features from {{product.productHighlights}}
- Include numbers and specs when available
- Example: Highlight "4K resolution with night vision" → "4K Night Vision Camera"

**Rule 4: Brand Voice Headlines (1-2 headlines)**
- Reflect tone from {{product.brandDescription}}
- Maintain brand positioning (premium/value/innovative)

=== OTHER STRATEGIES ===
**Numbers & Specifics** (CTR +15-25%): Use specific numbers from features
**Emotional Triggers** (CTR +10-15%): "Trusted", "#1 Rated", "Best Seller"
**Question Headlines** (CTR +5-12%): Address user pain points
**DKI-Ready**: Create Dynamic Keyword Insertion compatible headlines

=== HEADLINE GROUPS (15 total) ===
**Group 1: Brand + USP (3)** - Use {{product.uniqueSellingPoints}}
**Group 2: Keyword + Audience (3)** - Combine {{topKeywords}} with {{product.targetAudience}}
**Group 3: Feature + Number (3)** - From {{product.productHighlights}}
**Group 4: Social Proof (3)** - Use {{trustBadges}}, ratings, reviews
**Group 5: Question + CTA (3)** - Target audience pain points

=== RULES ===
1. Each headline MUST be <= 30 characters
2. 8/15+ headlines must contain keywords from {{topKeywords}}
3. 5/15+ headlines must contain specific numbers
4. No two headlines share more than 2 words
5. Use: "Buy", "Shop", "Get", "Save"
6. NO quotation marks in headlines

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "dataUtilization": {
    "uspUsed": true,
    "audienceTargeted": true,
    "highlightsIncluded": true
  }
}',
  change_notes = 'v3.4: 添加深度分析变量并增强使用指导，确保AI优先利用USP/Audience/Highlights数据'
WHERE prompt_id = 'ad_elements_headlines' AND is_active = true;

-- ============================================================================
-- PART 3: brand_analysis_store v3.2 → v3.4
-- 添加: {{technicalDetails}}, {{reviewHighlights}}
-- 优化: 增加数据使用指导
-- ============================================================================

UPDATE prompt_versions
SET
  version = 'v3.4',
  name = '品牌店铺分析v3.4',
  prompt_content = 'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🎯 SUPPLEMENTARY DATA (v3.4) ===
**Technical Details** (product specifications if available):
{{technicalDetails}}

**Review Highlights** (key customer feedback if available):
{{reviewHighlights}}

⚠️ USE THIS DATA: If Technical Details or Review Highlights are available (not "Not available"),
incorporate them into your analysis for richer insights about product quality and customer satisfaction.

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- TOP 5 HOT-SELLING = highest scores (proven winners)
- Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed
   - 🆕 Include insights from {{technicalDetails}} if available

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
   - 🆕 Validate with {{reviewHighlights}} if available

5. **Quality Indicators**:
   - Amazon Choice badge   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)
   - 🆕 Customer sentiment from {{reviewHighlights}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
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
      "successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]
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
}',
  change_notes = 'v3.4: 添加technicalDetails/reviewHighlights变量并增强使用指导'
WHERE prompt_id = 'brand_analysis_store' AND is_active = true;

-- ====================================================================
-- SOURCE: pg-migrations/068_sync_prompt_versions.pg.sql
-- ====================================================================
-- ============================================================================
-- Migration 068: 同步prompt版本 - 修复065/066覆盖问题
-- ============================================================================
--
-- 问题:
--   065/066合并迁移包含旧版本prompt，重新执行后覆盖了067的新版本
--   - ad_elements_headlines: v3.4 → v3.3 (被覆盖)
--   - brand_analysis_store: v3.4 → v3.2 (被覆盖)
--
-- 修复:
--   1. 将上述prompt升级到本地最新版本
--   2. 清理冗余的旧版本prompt (launch_score_evaluation, creative_quality_scoring)
--
-- 日期: 2025-12-14
-- ============================================================================

-- ============================================================================
-- PART 1: ad_elements_headlines v3.3 → v3.4
-- ============================================================================

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'ad_elements_headlines' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'ad_elements_headlines',
  'v3.4',
  '广告创意生成',
  '广告标题生成v3.4 - CTR优化增强版',
  'CTR优化增强版：添加深度分析变量（USP/Audience/Highlights），增强使用优先级指导',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== 🎯 DEEP ANALYSIS DATA (v3.4 - PRIORITY DATA) ===
**Unique Selling Points**: {{product.uniqueSellingPoints}}
**Target Audience**: {{product.targetAudience}}
**Product Highlights**: {{product.productHighlights}}
**Brand Description**: {{product.brandDescription}}

⚠️ CRITICAL: The above deep analysis data is AI-extracted insights.
USE THIS DATA FIRST when creating headlines - it contains the most valuable differentiators.

=== PRODUCT FEATURES ===
About This Item:
{{product.aboutThisItem}}

Key Features:
{{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}
**TOP REVIEW QUOTES**: {{topReviewQuotes}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.4 DEEP ANALYSIS UTILIZATION (HIGHEST PRIORITY) ===

**Rule 1: USP-First Headlines (3-4 headlines)**
- Extract key phrases from {{product.uniqueSellingPoints}}
- Transform USPs into compelling 30-char headlines
- Example: USP "No monthly subscription fees" → "No Monthly Fees Ever"

**Rule 2: Audience-Targeted Headlines (2-3 headlines)**
- Reference {{product.targetAudience}} demographics/needs
- Speak directly to their pain points
- Example: Audience "homeowners worried about security" → "Protect Your Home 24/7"

**Rule 3: Highlight-Based Headlines (2-3 headlines)**
- Use specific features from {{product.productHighlights}}
- Include numbers and specs when available
- Example: Highlight "4K resolution with night vision" → "4K Night Vision Camera"

**Rule 4: Brand Voice Headlines (1-2 headlines)**
- Reflect tone from {{product.brandDescription}}
- Maintain brand positioning (premium/value/innovative)

=== OTHER STRATEGIES ===
**Numbers & Specifics** (CTR +15-25%): Use specific numbers from features
**Emotional Triggers** (CTR +10-15%): "Trusted", "#1 Rated", "Best Seller"
**Question Headlines** (CTR +5-12%): Address user pain points
**DKI-Ready**: Create Dynamic Keyword Insertion compatible headlines

=== HEADLINE GROUPS (15 total) ===
**Group 1: Brand + USP (3)** - Use {{product.uniqueSellingPoints}}
**Group 2: Keyword + Audience (3)** - Combine {{topKeywords}} with {{product.targetAudience}}
**Group 3: Feature + Number (3)** - From {{product.productHighlights}}
**Group 4: Social Proof (3)** - Use {{trustBadges}}, ratings, reviews
**Group 5: Question + CTA (3)** - Target audience pain points

=== RULES ===
1. Each headline MUST be <= 30 characters
2. 8/15+ headlines must contain keywords from {{topKeywords}}
3. 5/15+ headlines must contain specific numbers
4. No two headlines share more than 2 words
5. Use: "Buy", "Shop", "Get", "Save"
6. NO quotation marks in headlines

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "dataUtilization": {
    "uspUsed": true,
    "audienceTargeted": true,
    "highlightsIncluded": true
  }
}',
  'English',
  true,
  'v3.4: 添加深度分析变量并增强使用指导，确保AI优先利用USP/Audience/Highlights数据',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================================
-- PART 2: brand_analysis_store v3.2 → v3.4
-- ============================================================================

UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'brand_analysis_store' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  is_active, change_notes, created_at
) VALUES (
  'brand_analysis_store',
  'v3.4',
  '品牌分析',
  '品牌店铺分析v3.4',
  '添加technicalDetails/reviewHighlights变量并增强使用指导',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🎯 SUPPLEMENTARY DATA (v3.4) ===
**Technical Details** (product specifications if available):
{{technicalDetails}}

**Review Highlights** (key customer feedback if available):
{{reviewHighlights}}

⚠️ USE THIS DATA: If Technical Details or Review Highlights are available (not "Not available"),
incorporate them into your analysis for richer insights about product quality and customer satisfaction.

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- TOP 5 HOT-SELLING = highest scores (proven winners)
- Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed
   - 🆕 Include insights from {{technicalDetails}} if available

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
   - 🆕 Validate with {{reviewHighlights}} if available

5. **Quality Indicators**:
   - Amazon Choice badge
   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)
   - 🆕 Customer sentiment from {{reviewHighlights}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
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
      "price": "$XX.XX",
      "rating": 4.5,
      "reviewCount": 1234,
      "hotScore": 3.87,
      "successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]
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
}',
  'English',
  true,
  'v3.4: 添加technicalDetails/reviewHighlights变量并增强使用指导',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = true,
  name = EXCLUDED.name,
  prompt_content = EXCLUDED.prompt_content,
  change_notes = EXCLUDED.change_notes;

-- ============================================================================
-- PART 3: 停用冗余的旧版本 prompt
-- ============================================================================

-- 停用 creative_quality_scoring (已被其他方式替代)
UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'creative_quality_scoring';

-- 停用 launch_score_evaluation (已被 launch_score v4.0 替代)
UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'launch_score_evaluation';

-- launch_score v4.0 保持激活 (替代了 launch_score_evaluation)
-- 停用 launch_score_v4 (冗余，统一使用 launch_score)
UPDATE prompt_versions SET is_active = false
WHERE prompt_id = 'launch_score_v4';

-- 修复 keywords_generation category
UPDATE prompt_versions SET category = '关键词生成'
WHERE prompt_id = 'keywords_generation';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- SELECT prompt_id, version, is_active, name FROM prompt_versions
-- WHERE prompt_id IN ('ad_elements_headlines', 'brand_analysis_store',
--                     'creative_quality_scoring', 'launch_score_evaluation', 'launch_score')
-- ORDER BY prompt_id, version DESC;

-- ====================================================================
-- SOURCE: pg-migrations/069_deprecate_keywords_generation_prompt.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 069_deprecate_keywords_generation_prompt.pg.sql
-- Description: 标记 keywords_generation prompt 为废弃
-- Date: 2025-12-14
--
-- 变更原因:
--   - 正向关键词生成已从AI生成迁移到Keyword Planner API
--   - 新架构使用白名单过滤 + 搜索量排序替代AI关键词生成
--   - 相关代码已迁移到 unified-keyword-service.ts
--
-- 影响范围:
--   - prompt_versions 表中的 keywords_generation 记录
--   - 原调用者: /api/ad-groups/[id]/generate-keywords (已更新)
--   - 原调用者: keyword-generator.ts generateKeywords() (已废弃)
--
-- 新替代方案:
--   - 使用 unified-keyword-service.ts 的 getUnifiedKeywordData()
--   - 基于 Google Ads Keyword Planner API
--   - 品牌白名单过滤确保相关性
-- =====================================================

-- 步骤1: 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keywords_generation' AND is_active = TRUE;

-- 步骤2: 创建废弃版本记录（保留历史）
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'keywords_generation',
  'v3.3-deprecated',
  '关键词生成',
  '关键词生成v3.3（已废弃）',
  '⚠️ 已废弃 (2025-12-14): 正向关键词生成已迁移到Keyword Planner API。请使用 unified-keyword-service.ts 的 getUnifiedKeywordData()',
  'src/lib/keyword-generator.ts',
  'generateKeywords',
  '⚠️ DEPRECATED (2025-12-14)

This prompt is no longer in use.

MIGRATION PATH:
- Positive keyword generation → unified-keyword-service.ts getUnifiedKeywordData()
- Uses Google Ads Keyword Planner API
- Brand whitelist filtering for relevance
- Search volume sorting (DESC) for high-value keywords

For negative keywords, use keyword-generator.ts generateNegativeKeywords() which is still active.

旧prompt内容已归档，不再使用。',
  'en',
  NULL,  -- created_by: NULL表示系统创建（列类型为INTEGER外键）
  FALSE,
  '⚠️ 废弃原因: AI关键词生成被Keyword Planner API + 白名单过滤替代。新方案提供真实搜索量数据，100%避免竞品关键词冲突。'
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  is_active = FALSE,
  description = EXCLUDED.description,
  change_notes = EXCLUDED.change_notes;

-- ====================================================================
-- SOURCE: pg-migrations/070_keyword_pools_and_prompts.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 070_keyword_pools_and_prompts.pg.sql
-- Description: Offer级关键词池、差异化创意支持和Prompt版本 (PostgreSQL)
-- Date: 2025-12-15
--
-- 功能:
--   1. 创建 offer_keyword_pools 表：Offer级关键词池
--   2. 修改 ad_creatives 表：添加关键词桶关联字段
--   3. keyword_intent_clustering v1.0：关键词意图聚类Prompt
--   4. ad_creative_generation v4.9：主题一致性增强Prompt
-- =====================================================

-- ============================================================
-- PART 1: CREATE offer_keyword_pools 表
-- ============================================================
-- Offer级关键词池：实现关键词分层策略
-- - 共享层：纯品牌词（所有创意共用）
-- - 独占层：语义分桶（产品导向/场景导向/需求导向）

CREATE TABLE IF NOT EXISTS offer_keyword_pools (
  id SERIAL PRIMARY KEY,
  offer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,

  -- 共享层：纯品牌词
  brand_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- 独占层：语义分桶
  bucket_a_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 品牌商品锚点
  bucket_b_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 商品需求场景
  bucket_c_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,  -- 功能规格特性

  -- 桶意图描述
  bucket_a_intent TEXT DEFAULT '品牌商品锚点',
  bucket_b_intent TEXT DEFAULT '商品需求场景',
  bucket_c_intent TEXT DEFAULT '功能规格特性',

  -- 元数据
  total_keywords INTEGER NOT NULL DEFAULT 0,
  clustering_model TEXT,  -- 使用的AI模型
  clustering_prompt_version TEXT,  -- 聚类prompt版本
  balance_score REAL,  -- 分桶均衡度评分 0-1

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_offer_keyword_pools_offer ON offer_keyword_pools(offer_id);
CREATE INDEX IF NOT EXISTS idx_offer_keyword_pools_user ON offer_keyword_pools(user_id);

-- 更新时间触发器
CREATE OR REPLACE FUNCTION update_offer_keyword_pools_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_offer_keyword_pools_updated_at ON offer_keyword_pools;
CREATE TRIGGER trigger_offer_keyword_pools_updated_at
  BEFORE UPDATE ON offer_keyword_pools
  FOR EACH ROW
  EXECUTE FUNCTION update_offer_keyword_pools_updated_at();

-- ============================================================
-- PART 2: ALTER ad_creatives 表
-- ============================================================
-- 添加关键词桶关联字段

-- 添加 keyword_bucket 字段：关键词桶标识 (A/B/C)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'keyword_bucket'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS keyword_bucket TEXT CHECK(keyword_bucket IN ('A', 'B', 'C'));
  END IF;
END $$;

-- 添加 keyword_pool_id 字段：关联到 offer_keyword_pools
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'keyword_pool_id'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS keyword_pool_id INTEGER REFERENCES offer_keyword_pools(id);
  END IF;
END $$;

-- 添加 bucket_intent 字段：桶意图描述
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'bucket_intent'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS bucket_intent TEXT;
  END IF;
END $$;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ad_creatives_keyword_bucket ON ad_creatives(keyword_bucket);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_keyword_pool ON ad_creatives(keyword_pool_id);

-- ============================================================
-- PART 3: keyword_intent_clustering v1.0 (新增Prompt)
-- ============================================================
-- 将非品牌关键词按用户搜索意图分成3个语义桶

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
) VALUES (
  'keyword_intent_clustering',
  '关键词意图聚类v1.0',
  'v1.0',
  '关键词管理',
  '将非品牌关键词按用户搜索意图分成3个语义桶：产品导向、场景导向、需求导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成3个语义桶。

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

# 分桶规则

## 桶A - 产品导向 (Product-Oriented)
**用户画像**：知道要买什么产品，搜索具体产品类型
**关键词特征**：
- 产品类型词：camera, vacuum, headphones
- 型号相关词：eufy camera, eufycam 2, model xxx
- 品类词：security camera, robot vacuum, wireless earbuds
- 产品线词：indoor camera, outdoor camera, doorbell cam

**示例**：
- eufy security camera
- indoor cam
- outdoor camera
- doorbell camera
- eufycam 2 pro

## 桶B - 场景导向 (Scenario-Oriented)
**用户画像**：知道要解决什么问题，搜索使用场景
**关键词特征**：
- 使用场景词：home security, baby monitor, pet watching
- 应用环境词：garage camera, driveway security, backyard monitoring
- 解决方案词：protect home, monitor baby, watch pets

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- driveway security
- garage monitoring

## 桶C - 需求导向 (Demand-Oriented)
**用户画像**：关注具体功能需求，搜索技术规格或购买评价
**关键词特征**：
- 功能特性词：wireless, night vision, 2k resolution, solar powered
- 技术规格词：4k camera, 180 degree view, long battery
- 购买意图词：best, top rated, cheap, affordable
- 比较词：vs, alternative, better than

**示例**：
- wireless security camera
- night vision camera
- 2k resolution camera
- best doorbell camera
- affordable home camera

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持3个桶的关键词数量相对均衡（理想比例 30%-40%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图

# 特殊情况处理

- **混合关键词**（如"best home security camera"）：
  - 优先按最强意图分类
  - "best"表示需求导向 → 分到桶C

- **品牌+功能词**（如"eufy wireless camera"）：
  - 按功能词分类
  - "wireless"是功能特性 → 分到桶C

# 输出格式（JSON）

{
  "bucketA": {
    "intent": "产品导向",
    "intentEn": "Product-Oriented",
    "description": "用户知道要买什么产品",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketB": {
    "intent": "场景导向",
    "intentEn": "Scenario-Oriented",
    "description": "用户知道要解决什么问题",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketC": {
    "intent": "需求导向",
    "intentEn": "Demand-Oriented",
    "description": "用户关注具体功能需求",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 30,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡',
  'v1.0 初始版本：基于搜索意图的关键词三桶分类',
  true
);

-- ============================================================
-- PART 4: ad_creative_generation v4.10 (关键词分层嵌入)
-- ============================================================
-- 停用旧版本，激活v4.10
-- v4.10核心改进：解决关键词嵌入与主题一致性的冲突
-- 方案：先分桶再嵌入，关键词来源 = 品牌词(共享) + 桶匹配词(独占)

UPDATE prompt_versions SET is_active = false WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
) VALUES (
  'ad_creative_generation',
  '广告创意生成v4.10 - 关键词分层嵌入版',
  'v4.10',
  '广告创意生成',
  '解决v4.9关键词嵌入与主题一致性冲突：采用分层关键词策略，品牌词(共享层)+桶匹配词(独占层)，确保嵌入率和主题一致性同时满足',
  'prompts/ad_creative_generation_v4.10.txt',
  'generateAdCreative',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

## 🆕 v4.10 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**
**✅ 关键词嵌入和主题一致性不会冲突**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 这些关键词已经是"品牌词 + 桶匹配词"的组合
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)
- ❌ 错误: "Best Quality Product" (无关键词)

**规则3: 嵌入与主题双重验证**
- 每个嵌入的关键词必须同时满足：
  - ✅ 来自{{ai_keywords_section}}
  - ✅ 符合{{bucket_intent}}主题
- 由于关键词已预筛选，两个条件天然兼容

## 🎯 v4.10 主题一致性要求

{{bucket_info_section}}

### 主题约束规则

**桶A（产品导向）文案风格**:
- Headlines: 突出产品线丰富、型号多样、品类齐全
- Descriptions: 介绍产品系列、规格参数、产品优势
- ✅ 示例: "Eufy Indoor & Outdoor Cams | Full Product Line"

**桶B（场景导向）文案风格**:
- Headlines: 突出应用场景、解决方案、使用环境
- Descriptions: 描述使用场景、用户收益、痛点解决
- ✅ 示例: "Protect Your Home 24/7 | Eufy Smart Security"

**桶C（需求导向）文案风格**:
- Headlines: 突出核心功能、技术优势、性能参数
- Descriptions: 强调差异化功能、技术参数、用户评价
- ✅ 示例: "4K Ultra HD Night Vision | Eufy Camera"

### 主题一致性检查清单

- [ ] 100% Headlines体现{{bucket_intent}}主题
- [ ] 100% Descriptions体现{{bucket_intent}}主题
- [ ] 100% 嵌入的关键词来自{{ai_keywords_section}}（已预筛选）
- [ ] 53%+ Headlines包含关键词

## v4.7 RSA Display Path (继承)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🚨 v4.10 HEADLINE REQUIREMENTS**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Theme Consistency**: 100% headlines MUST match {{bucket_intent}} theme
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity, no 2+ shared words (excluding embedded keywords from {{ai_keywords_section}})

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element

### KEYWORDS (输出{{ai_keywords_section}}中的全部关键词)
**⚠️ 直接输出{{ai_keywords_section}}中的所有关键词，不要生成新关键词**
**⚠️ 所有关键词必须使用目标语言 {{target_language}}**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool, "themeMatch":true}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool, "keywords":["keyword1"], "themeMatch":true}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "bucket_type": "{{bucket_type}}",
  "bucket_intent": "{{bucket_intent}}",
  "keyword_layer_validation": {
    "brand_keywords_used": ["brand1", "brand2"],
    "bucket_keywords_used": ["kw1", "kw2", "kw3"],
    "total_keywords_embedded": 8,
    "embedding_rate": 0.53
  },
  "theme_consistency": {
    "headline_match_rate": 1.0,
    "description_match_rate": 1.0,
    "overall_score": 1.0
  },
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"}
}',
  'v4.10 关键词分层嵌入：解决v4.9关键词嵌入与主题一致性冲突，采用品牌词(共享)+桶匹配词(独占)分层策略，确保两者天然兼容',
  true
);

-- ============================================================
-- VERIFICATION
-- ============================================================
-- 运行以下查询验证迁移成功:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'offer_keyword_pools';
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name IN ('keyword_bucket', 'keyword_pool_id', 'bucket_intent');
-- SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id IN ('ad_creative_generation', 'keyword_intent_clustering') ORDER BY prompt_id, version DESC;

-- ====================================================================
-- SOURCE: pg-migrations/071_rename_product_to_brand_oriented.pg.sql
-- ====================================================================
-- Migration 071: Rename bucket classifications for clearer semantics
--
-- Purpose: 重命名桶分类以提供更清晰的语义
--   - 桶A: 产品导向(Product-Oriented) → 品牌导向(Brand-Oriented)
--   - 桶C: 需求导向(Demand-Oriented) → 功能导向(Feature-Oriented)
--
-- Rationale:
--   - "品牌导向"更准确描述包含品牌名的关键词搜索意图
--   - "功能导向"与"场景导向"边界更清晰（功能=技术规格，场景=使用环境）
--
-- Changes:
-- 1. 更新 offer_keyword_pools 表中现有数据
-- 2. 更新 prompt_versions 中的 keyword_intent_clustering prompt
-- 3. 更新 ad_creative_generation prompt
-- 4. 更新 ad_creatives 表中的 bucket_intent 字段

-- ============================================================
-- PART 1: 更新 offer_keyword_pools 表中现有数据
-- ============================================================

UPDATE offer_keyword_pools
SET bucket_a_intent = '品牌导向'
WHERE bucket_a_intent = '产品导向';

UPDATE offer_keyword_pools
SET bucket_c_intent = '功能导向'
WHERE bucket_c_intent = '需求导向';

-- ============================================================
-- PART 2: 更新 keyword_intent_clustering prompt v1.1
-- ============================================================

-- 停用旧版本
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = true;

-- 插入新版本 v1.1
INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
) VALUES (
  'keyword_intent_clustering',
  '关键词意图聚类v1.1',
  'v1.1',
  '关键词管理',
  '将非品牌关键词按用户搜索意图分成3个语义桶：品牌导向、场景导向、功能导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成3个语义桶。

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

# 分桶规则

## 桶A - 品牌导向 (Brand-Oriented)
**用户画像**：知道要买什么品牌，搜索品牌相关内容
**关键词特征**：
- 品牌+产品词：brand camera, brand vacuum, brand headphones
- 型号相关词：brand model xxx, brand pro, brand plus
- 官方渠道词：brand official, brand store, brand website
- 品牌系列词：brand indoor, brand outdoor, brand doorbell

**示例**：
- eufy security camera
- eufy official store
- eufy outdoor camera
- eufy doorbell
- eufycam 2 pro

## 桶B - 场景导向 (Scenario-Oriented)
**用户画像**：知道要解决什么问题，搜索使用场景/应用环境
**关键词特征**：
- 使用场景词：home security, baby monitor, pet watching
- 应用环境词：garage camera, driveway security, backyard monitoring
- 解决方案词：protect home, monitor baby, watch pets
- 注意：不包含具体功能/规格词

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- driveway security
- garage monitoring

## 桶C - 功能导向 (Feature-Oriented)
**用户画像**：关注技术规格、功能特性、产品评价
**关键词特征**：
- 功能特性词：wireless, night vision, 2k resolution, solar powered
- 技术规格词：4k camera, 180 degree view, long battery
- 购买意图词：best, top rated, cheap, affordable
- 比较词：vs, alternative, better than

**示例**：
- wireless security camera
- night vision camera
- 2k resolution camera
- best doorbell camera
- affordable home camera

# 分桶边界说明（重要）

**场景导向 vs 功能导向的区别**：
- 场景导向 = "在哪里用/为什么用"（Where/Why）
- 功能导向 = "要什么功能/什么规格"（What/How）

**混合关键词处理**：
- "wireless baby monitor" → 功能导向（wireless是功能特征）
- "home security" → 场景导向（没有功能词）
- "4k home camera" → 功能导向（4k是技术规格）

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持3个桶的关键词数量相对均衡（理想比例 30%-40%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图

# 输出格式（JSON）

{
  "bucketA": {
    "intent": "品牌导向",
    "intentEn": "Brand-Oriented",
    "description": "用户知道要买什么品牌",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketB": {
    "intent": "场景导向",
    "intentEn": "Scenario-Oriented",
    "description": "用户知道要解决什么问题",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketC": {
    "intent": "功能导向",
    "intentEn": "Feature-Oriented",
    "description": "用户关注技术规格/功能特性",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 30,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡',
  'v1.1 重命名分类：产品导向→品牌导向，需求导向→功能导向，明确场景vs功能的边界',
  true
);

-- ============================================================
-- PART 3: 更新 ad_creative_generation prompt v4.11
-- ============================================================

-- 停用旧版本
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

INSERT INTO prompt_versions (
  prompt_id,
  name,
  version,
  category,
  description,
  file_path,
  function_name,
  prompt_content,
  change_notes,
  is_active
)
SELECT
  'ad_creative_generation',
  '广告创意生成v4.11 - 分类重命名版',
  'v4.11',
  category,
  '重命名桶分类：产品导向→品牌导向，需求导向→功能导向',
  file_path,
  function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(prompt_content,
              '桶A（产品导向）文案风格',
              '桶A（品牌导向）文案风格'
            ),
            'Headlines: 突出产品线丰富、型号多样、品类齐全',
            'Headlines: 突出品牌实力、官方正品、品牌优势'
          ),
          'Descriptions: 介绍产品系列、规格参数、产品优势',
          'Descriptions: 强调品牌价值、官方保障、品牌故事'
        ),
        '"Eufy Indoor & Outdoor Cams | Full Product Line"',
        '"Official Eufy Store | Trusted Brand Quality"'
      ),
      '桶C（需求导向）文案风格',
      '桶C（功能导向）文案风格'
    ),
    'Demand-Oriented',
    'Feature-Oriented'
  ),
  'v4.11 重命名：产品导向→品牌导向，需求导向→功能导向',
  true
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.10';

-- ============================================================
-- PART 4: 更新 ad_creatives 表中的 bucket_intent 字段
-- ============================================================

UPDATE ad_creatives
SET bucket_intent = '品牌导向'
WHERE bucket_intent = '产品导向';

UPDATE ad_creatives
SET bucket_intent = '功能导向'
WHERE bucket_intent = '需求导向';

-- ====================================================================
-- SOURCE: pg-migrations/072_add_synthetic_bucket.pg.sql
-- ====================================================================
-- 072: 添加综合创意桶类型 'S' (Synthetic)
-- 用于第4个综合广告创意，包含所有品牌词+高搜索量非品牌词

-- 1. 删除现有的CHECK约束
ALTER TABLE ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_keyword_bucket_check;

-- 2. 添加新的CHECK约束，支持 'A', 'B', 'C', 'S'
ALTER TABLE ad_creatives ADD CONSTRAINT ad_creatives_keyword_bucket_check
  CHECK (keyword_bucket = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'S'::text]));

-- 3. 添加注释说明
COMMENT ON COLUMN ad_creatives.keyword_bucket IS '关键词桶类型: A=品牌导向, B=场景导向, C=功能导向, S=综合(Synthetic)';

-- ====================================================================
-- SOURCE: pg-migrations/073_update_review_analysis_prompt_v3.3.pg.sql
-- ====================================================================
-- Migration: 073_update_review_analysis_prompt_v3.3
-- Description: 增强评论分析prompt的量化亮点提取（v3.2 → v3.3）
-- Author: Claude Code
-- Date: 2025-12-16

-- 更新review_analysis prompt到v3.3版本
UPDATE prompt_versions
SET
  name = '评论分析v3.3',
  prompt_content = 'You are an expert e-commerce review analyst specializing in extracting actionable insights from customer reviews.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===

1. **Sentiment Distribution** (Quantitative)
   - Calculate positive (4-5 stars), neutral (3 stars), negative (1-2 stars) percentages
   - Provide rating breakdown by star count

2. **Positive Keywords** (Top 10)
   - Extract frequently mentioned positive attributes
   - Include context for each keyword

3. **Negative Keywords** (Top 10)
   - Extract frequently mentioned complaints or issues
   - Include context for each keyword

4. **Real Use Cases** (5-8 scenarios)
   - Identify specific scenarios where customers use the product
   - Extract direct quotes or paraphrased examples

5. **Purchase Reasons** (Top 5)
   - Why customers bought this product
   - What problems they were trying to solve

6. **User Profiles** (3-5 types)
   - Categorize customer types based on their reviews
   - Describe characteristics and needs of each profile

7. **Common Pain Points** (Top 5)
   - Issues customers experienced
   - Severity level and frequency

8. **Quantitative Highlights** (CRITICAL - Extract ALL numbers from reviews)
   **This is the most important section for advertising!**

   Extract EVERY specific number, measurement, or quantifiable claim mentioned in reviews:

   **Performance Metrics:**
   - Battery life: "8 hours", "lasts all day", "3 days on single charge"
   - Suction power: "2000Pa", "powerful suction", "picks up everything"
   - Coverage area: "2000 sq ft", "whole house", "3 bedrooms"
   - Speed/Time: "cleans in 30 minutes", "charges in 2 hours"
   - Capacity: "500ml dustbin", "holds a week of dirt"

   **Usage Duration:**
   - "used for 6 months", "owned for 2 years", "after 3 weeks"
   - "daily use for 1 year", "10 months flawless operation"

   **Frequency:**
   - "runs 3 times per week", "daily cleaning", "every other day"
   - "cleans twice a day", "scheduled for weekdays"

   **Comparison Numbers:**
   - "50% quieter than old one", "2x more powerful"
   - "saves 2 hours per week", "replaces $500 vacuum"

   **Satisfaction Metrics:**
   - "5 stars", "10/10 recommend", "100% satisfied"
   - "would buy again", "best purchase this year"

   **Cost/Value:**
   - "worth every penny", "saved $200", "paid $699"
   - "cheaper than competitors", "half the price"

   For EACH quantitative highlight, provide:
   - metric: Category name (e.g., "Battery Life", "Usage Duration")
   - value: The specific number/measurement (e.g., "8 hours", "6 months")
   - context: Full sentence from review explaining the metric
   - adCopy: Ad-ready format (e.g., "8-Hour Battery Life", "Trusted for 6+ Months")

9. **Competitor Mentions** (Brand comparisons)
   - Which competitor brands are mentioned
   - How this product compares (better/worse/similar)
   - Specific comparison points

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:

{
  "totalReviews": number,
  "averageRating": number,
  "sentimentDistribution": {
    "totalReviews": number,
    "positive": number,
    "neutral": number,
    "negative": number,
    "ratingBreakdown": {
      "5_star": number,
      "4_star": number,
      "3_star": number,
      "2_star": number,
      "1_star": number
    }
  },
  "topPositiveKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "topNegativeKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "realUseCases": ["string"],
  "purchaseReasons": ["string"],
  "userProfiles": [
    {
      "profile": "string",
      "description": "string"
    }
  ],
  "commonPainPoints": ["string"],
  "quantitativeHighlights": [
    {
      "metric": "string",
      "value": "string",
      "context": "string",
      "adCopy": "string"
    }
  ],
  "competitorMentions": ["string"],
  "analyzedReviewCount": number,
  "verifiedReviewCount": number
}

IMPORTANT: Extract AT LEAST 8-12 quantitative highlights if the reviews contain numbers. Look for ANY mention of time, duration, frequency, measurements, percentages, or comparisons.',
  version = 'v3.3',
  change_notes = 'Enhanced quantitativeHighlights extraction with detailed examples and requirements. Added comprehensive categories: performance metrics, usage duration, frequency, comparisons, satisfaction, cost/value. Increased expected output from 3 to 8-12 highlights.'
WHERE prompt_id = 'review_analysis' AND is_active = true;

-- ====================================================================
-- SOURCE: pg-migrations/074_launch_scores_creative_link.pg.sql
-- ====================================================================
-- Migration 074: Link launch_scores to ad_creatives and add issues/suggestions storage
-- Date: 2025-12-17
-- Purpose:
--   1. Associate Launch Score with specific ad creative for caching
--   2. Store issues and suggestions for display without recalculation

-- Add ad_creative_id column to link with specific creative
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS ad_creative_id INTEGER REFERENCES ad_creatives(id) ON DELETE SET NULL;

-- Add issues column to store array of issues (JSON)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS issues TEXT;

-- Add suggestions column to store array of suggestions (JSON)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS suggestions TEXT;

-- Add content_hash to detect if creative content has changed (for cache invalidation)
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Add campaign_config_hash to detect if campaign config has changed
ALTER TABLE launch_scores ADD COLUMN IF NOT EXISTS campaign_config_hash TEXT;

-- Create index for quick lookup by creative_id
CREATE INDEX IF NOT EXISTS idx_launch_scores_creative_id ON launch_scores(ad_creative_id);

-- Create unique index to ensure one launch_score per creative+config combination
-- PostgreSQL supports partial unique indexes with WHERE clause
CREATE UNIQUE INDEX IF NOT EXISTS idx_launch_scores_creative_config
ON launch_scores(ad_creative_id, content_hash, campaign_config_hash)
WHERE ad_creative_id IS NOT NULL AND content_hash IS NOT NULL;

-- Update existing records: set content_hash to NULL (will be recalculated on next evaluation)
-- No data migration needed as existing records don't have creative associations

-- ====================================================================
-- SOURCE: pg-migrations/075_fix_global_keywords_schema.pg.sql
-- ====================================================================
-- Migration: 075_fix_global_keywords_schema.pg.sql
-- Purpose: 修复 global_keywords 表结构（旧结构 keyword_text → 新结构 keyword）
-- Date: 2025-12-17
--
-- ⚠️ 重要：此迁移仅适用于旧结构（有 keyword_text 字段）的数据库

-- Step 1: 创建新结构表
CREATE TABLE IF NOT EXISTS global_keywords_v2 (
  id SERIAL PRIMARY KEY,
  keyword TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  language TEXT NOT NULL DEFAULT 'en',
  search_volume INTEGER DEFAULT 0,
  competition_level TEXT,
  avg_cpc_micros INTEGER,
  cached_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(keyword, country, language)
);

-- Step 2: 从旧表迁移数据（keyword_text → keyword）
-- 🔧 修复：将 TEXT 类型的时间戳转换为 TIMESTAMP
INSERT INTO global_keywords_v2 (keyword, country, language, search_volume, competition_level, avg_cpc_micros, created_at)
SELECT
  keyword_text,
  COALESCE(country, 'US'),
  COALESCE(language, 'en'),
  search_volume,
  competition_level,
  avg_cpc_micros,
  COALESCE(created_at::TIMESTAMP, NOW())
FROM global_keywords
WHERE keyword_text IS NOT NULL
ON CONFLICT (keyword, country, language) DO NOTHING;

-- Step 3: 删除旧表
DROP TABLE IF EXISTS global_keywords;

-- Step 4: 重命名新表
ALTER TABLE global_keywords_v2 RENAME TO global_keywords;

-- Step 5: 创建索引
CREATE INDEX IF NOT EXISTS idx_global_keywords_lookup
ON global_keywords(keyword, country, language);

CREATE INDEX IF NOT EXISTS idx_global_keywords_cached_at
ON global_keywords(cached_at);

-- ====================================================================
-- SOURCE: pg-migrations/076_update_all_prompts_v4.14.pg.sql
-- ====================================================================
-- Migration: 076_update_all_prompts_v4.14
-- Description: 批量更新所有Prompt到 v4.14 版本
-- Created: 2025-12-17
-- Version: v4.13 → v4.14
-- Prompts: 12 个
-- Database: PostgreSQL


-- ========================================
-- ad_creative_generation: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.14',
  '广告创意生成',
  '广告创意生成v4.14',
  '重命名桶分类：产品导向→品牌导向，需求导向→功能导向',
  'prompts/ad_creative_generation_v4.10.txt',
  'generateAdCreative',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

## 🆕 v4.10 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**
**✅ 关键词嵌入和主题一致性不会冲突**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 这些关键词已经是"品牌词 + 桶匹配词"的组合
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)
- ❌ 错误: "Best Quality Product" (无关键词)

**规则3: 嵌入与主题双重验证**
- 每个嵌入的关键词必须同时满足：
  - ✅ 来自{{ai_keywords_section}}
  - ✅ 符合{{bucket_intent}}主题
- 由于关键词已预筛选，两个条件天然兼容

## 🎯 v4.10 主题一致性要求

{{bucket_info_section}}

### 主题约束规则

**桶A（品牌导向）文案风格**:
- Headlines: 突出品牌实力、官方正品、品牌优势
- Descriptions: 强调品牌价值、官方保障、品牌故事
- ✅ 示例: "Official Eufy Store | Trusted Brand Quality"

**桶B（场景导向）文案风格**:
- Headlines: 突出应用场景、解决方案、使用环境
- Descriptions: 描述使用场景、用户收益、痛点解决
- ✅ 示例: "Protect Your Home 24/7 | Eufy Smart Security"

**桶C（功能导向）文案风格**:
- Headlines: 突出核心功能、技术优势、性能参数
- Descriptions: 强调差异化功能、技术参数、用户评价
- ✅ 示例: "4K Ultra HD Night Vision | Eufy Camera"

### 主题一致性检查清单

- [ ] 100% Headlines体现{{bucket_intent}}主题
- [ ] 100% Descriptions体现{{bucket_intent}}主题
- [ ] 100% 嵌入的关键词来自{{ai_keywords_section}}（已预筛选）
- [ ] 53%+ Headlines包含关键词

## v4.7 RSA Display Path (继承)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🚨 v4.10 HEADLINE REQUIREMENTS**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Theme Consistency**: 100% headlines MUST match {{bucket_intent}} theme
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity, no 2+ shared words (excluding embedded keywords from {{ai_keywords_section}})

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element

### KEYWORDS (输出{{ai_keywords_section}}中的全部关键词)
**⚠️ 直接输出{{ai_keywords_section}}中的所有关键词，不要生成新关键词**
**⚠️ 所有关键词必须使用目标语言 {{target_language}}**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool, "themeMatch":true}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool, "keywords":["keyword1"], "themeMatch":true}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "bucket_type": "{{bucket_type}}",
  "bucket_intent": "{{bucket_intent}}",
  "keyword_layer_validation": {
    "brand_keywords_used": ["brand1", "brand2"],
    "bucket_keywords_used": ["kw1", "kw2", "kw3"],
    "total_keywords_embedded": 8,
    "embedding_rate": 0.53
  },
  "theme_consistency": {
    "headline_match_rate": 1.0,
    "description_match_rate": 1.0,
    "overall_score": 1.0
  },
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "estimated_ad_strength":"EXCELLENT"}
}',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- ad_elements_descriptions: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_elements_descriptions' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'ad_elements_descriptions',
  'v4.14',
  '广告创意生成',
  '广告描述生成v4.14',
  'CTR优化增强版：结构化模板、USP前置、社会证明、竞品差异化',
  'src/lib/ad-elements-extractor.ts',
  'generateDescriptions',
  'You are a professional Google Ads copywriter specializing in high-converting descriptions.

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

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Purchase Reasons: {{purchaseReasons}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== 🔥 v3.3 CTR OPTIMIZATION DATA ===

**STORE HOT FEATURES** (from best-selling products):
{{storeHotFeatures}}

**STORE USER VOICES** (aggregated reviews):
{{storeUserVoices}}

**TRUST BADGES** (credibility indicators):
{{trustBadges}}

**USER LANGUAGE PATTERNS** (natural expressions):
{{userLanguagePatterns}}

**COMPETITOR FEATURES** (for differentiation):
{{competitorFeatures}}

**TOP REVIEW QUOTES** (authentic voices):
{{topReviewQuotes}}

**UNIQUE SELLING POINTS** (vs competitors):
{{uniqueSellingPoints}}

=== TASK ===
Generate 4 Google Search ad descriptions (max 90 characters each).

=== 🎯 v3.3 STRUCTURED DESCRIPTION TEMPLATES ===

**Template 1: FEATURE-BENEFIT-CTA** (Conversion +10-15%)
Structure: [Core Feature] + [User Benefit] + [Action]
- Lead with strongest USP from {{storeHotFeatures}}
- Connect to tangible customer benefit
- End with clear CTA
- Example: "4K Ultra HD captures every detail. Never miss a moment. Shop now."

**Template 2: PROBLEM-SOLUTION-PROOF** (Trust +20%)
Structure: [Pain Point] + [Solution] + [Social Proof]
- Address common customer concern
- Present product as solution
- Back with proof from {{trustBadges}} or {{rating}}
- Example: "Worried about home security? 24/7 protection. Trusted by 1M+ families."

**Template 3: OFFER-URGENCY-TRUST** (CTR +15%)
Structure: [Promotion] + [Time Limit] + [Trust Signal]
- Lead with best offer from {{promotionInfo}}
- Create urgency (if applicable)
- Close with trust element
- Example: "Free Shipping + 30-Day Returns. Limited time. Official {{brand}} Store."

**Template 4: USP-DIFFERENTIATION** (Conversion +8%) 🆕
Structure: [Unique Advantage] + [Competitor Contrast] + [Value]
- Highlight what competitors DONT have (from {{uniqueSellingPoints}})
- Implicit comparison (never name competitors)
- Emphasize value proposition
- Example: "No Monthly Fees. Unlike others, pay once. Best value in security."

=== 🎯 v3.3 USP FRONT-LOADING RULE ===

**CRITICAL**: First 30 characters of each description are most important!
- Place strongest USP or number in first 30 chars
- Front-load: "4K Solar Camera" NOT "This camera has 4K and solar"
- Front-load: "Save $50 Today" NOT "You can save $50 if you buy today"

=== 🎯 v3.3 SOCIAL PROOF EMBEDDING ===

Include at least ONE of these in descriptions:
- Rating: "4.8★ Rated" or "{{rating}}★"
- Review count: "10,000+ Reviews" or "{{reviewCount}}+ Reviews"
- Sales: "Best Seller" or "10,000+ Sold"
- Badge: "Amazon''s Choice" or from {{trustBadges}}
- User quote: Adapted from {{topReviewQuotes}}

=== 🎯 v3.3 COMPETITOR DIFFERENTIATION ===

**Implicit Comparison Phrases** (never name competitors):
- "Unlike others..."
- "No monthly fees"
- "Why pay more?"
- "The smarter choice"
- "More features, better price"

Use {{competitorFeatures}} to identify what to AVOID duplicating.
Highlight advantages from {{uniqueSellingPoints}}.

=== RULES ===
1. Each description MUST be <= 90 characters (including spaces)
2. 🔥 **USP Front-Loading**: Strongest selling point in first 30 chars
3. 🔥 **Social Proof**: At least 2/4 descriptions must include proof element
4. 🔥 **Differentiation**: At least 1 description must use implicit comparison
5. Include at least one CTA per description
6. Use active voice and present tense
7. Include price/discount when compelling
8. 🔥 **Diversity**: Each description MUST follow a DIFFERENT template

=== OUTPUT FORMAT ===
Return JSON:
{
  "descriptions": ["description1", "description2", "description3", "description4"],
  "descriptionTemplates": ["feature-benefit-cta", "problem-solution-proof", "offer-urgency-trust", "usp-differentiation"],
  "ctrOptimization": {
    "uspFrontLoaded": [true, true, false, true],
    "socialProofIncluded": [false, true, true, false],
    "differentiationUsed": [false, false, false, true],
    "first30CharsUSP": ["4K Ultra HD", "Worried about", "Free Shipping", "No Monthly Fees"]
  },
  "dataUtilization": {
    "storeHotFeaturesUsed": true,
    "trustBadgesUsed": true,
    "uniqueSellingPointsUsed": true,
    "competitorDifferentiation": true
  }
}',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- ad_elements_headlines: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_elements_headlines' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'ad_elements_headlines',
  'v4.14',
  '广告创意生成',
  '广告标题生成v4.14',
  'CTR优化增强版：DKI模板、数字具体化、情感触发、问句式标题、关键词嵌入率',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  'You are a professional Google Ads copywriter specializing in high-CTR headlines.

=== PRODUCT INFORMATION ===
Product Name: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}} ({{product.reviewCount}} reviews)
Price: {{product.price}}

=== 🎯 DEEP ANALYSIS DATA (v3.4 - PRIORITY DATA) ===
**Unique Selling Points**: {{product.uniqueSellingPoints}}
**Target Audience**: {{product.targetAudience}}
**Product Highlights**: {{product.productHighlights}}
**Brand Description**: {{product.brandDescription}}

⚠️ CRITICAL: The above deep analysis data is AI-extracted insights.
USE THIS DATA FIRST when creating headlines - it contains the most valuable differentiators.

=== PRODUCT FEATURES ===
About This Item:
{{product.aboutThisItem}}

Key Features:
{{product.features}}

=== HIGH-VOLUME KEYWORDS ===
{{topKeywords}}

=== PRODUCT CATEGORIES ===
Store Categories: {{productCategories}}

=== REVIEW INSIGHTS ===
Customer Praises: {{reviewPositives}}
Use Cases: {{reviewUseCases}}

=== PROMOTIONS (if active) ===
{{promotionInfo}}

=== CTR OPTIMIZATION DATA ===
**STORE HOT FEATURES**: {{storeHotFeatures}}
**STORE USER VOICES**: {{storeUserVoices}}
**TRUST BADGES**: {{trustBadges}}
**USER LANGUAGE PATTERNS**: {{userLanguagePatterns}}
**COMPETITOR FEATURES**: {{competitorFeatures}}
**TOP REVIEW QUOTES**: {{topReviewQuotes}}

=== TASK ===
Generate 15 Google Search ad headlines (max 30 characters each).

=== 🎯 v3.4 DEEP ANALYSIS UTILIZATION (HIGHEST PRIORITY) ===

**Rule 1: USP-First Headlines (3-4 headlines)**
- Extract key phrases from {{product.uniqueSellingPoints}}
- Transform USPs into compelling 30-char headlines
- Example: USP "No monthly subscription fees" → "No Monthly Fees Ever"

**Rule 2: Audience-Targeted Headlines (2-3 headlines)**
- Reference {{product.targetAudience}} demographics/needs
- Speak directly to their pain points
- Example: Audience "homeowners worried about security" → "Protect Your Home 24/7"

**Rule 3: Highlight-Based Headlines (2-3 headlines)**
- Use specific features from {{product.productHighlights}}
- Include numbers and specs when available
- Example: Highlight "4K resolution with night vision" → "4K Night Vision Camera"

**Rule 4: Brand Voice Headlines (1-2 headlines)**
- Reflect tone from {{product.brandDescription}}
- Maintain brand positioning (premium/value/innovative)

=== OTHER STRATEGIES ===
**Numbers & Specifics** (CTR +15-25%): Use specific numbers from features
**Emotional Triggers** (CTR +10-15%): "Trusted", "#1 Rated", "Best Seller"
**Question Headlines** (CTR +5-12%): Address user pain points
**DKI-Ready**: Create Dynamic Keyword Insertion compatible headlines

=== HEADLINE GROUPS (15 total) ===
**Group 1: Brand + USP (3)** - Use {{product.uniqueSellingPoints}}
**Group 2: Keyword + Audience (3)** - Combine {{topKeywords}} with {{product.targetAudience}}
**Group 3: Feature + Number (3)** - From {{product.productHighlights}}
**Group 4: Social Proof (3)** - Use {{trustBadges}}, ratings, reviews
**Group 5: Question + CTA (3)** - Target audience pain points

=== RULES ===
1. Each headline MUST be <= 30 characters
2. 8/15+ headlines must contain keywords from {{topKeywords}}
3. 5/15+ headlines must contain specific numbers
4. No two headlines share more than 2 words
5. Use: "Buy", "Shop", "Get", "Save"
6. NO quotation marks in headlines

=== OUTPUT FORMAT ===
Return JSON:
{
  "headlines": ["headline1", "headline2", ..., "headline15"],
  "dataUtilization": {
    "uspUsed": 1,
    "audienceTargeted": 1,
    "highlightsIncluded": 1
  }
}',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- brand_analysis_store: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'brand_analysis_store' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'brand_analysis_store',
  'v4.14',
  '品牌分析',
  '品牌店铺分析v4.14',
  '为热销商品添加productHighlights字段',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🎯 SUPPLEMENTARY DATA (v3.4) ===
**Technical Details** (product specifications if available):
{{technicalDetails}}

**Review Highlights** (key customer feedback if available):
{{reviewHighlights}}

⚠️ USE THIS DATA: If Technical Details or Review Highlights are available (not "Not available"),
incorporate them into your analysis for richer insights about product quality and customer satisfaction.

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- TOP 5 HOT-SELLING = highest scores (proven winners)
- Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed
   - 🆕 Include insights from {{technicalDetails}} if available

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
   - 🆕 Validate with {{reviewHighlights}} if available

5. **Quality Indicators**:
   - Amazon Choice badge
   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)
   - 🆕 Customer sentiment from {{reviewHighlights}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
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
      "price": "$XX.XX",
      "rating": 4.5,
      "reviewCount": 1234,
      "hotScore": 3.87,
      "successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]
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
}',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- brand_name_extraction: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'brand_name_extraction' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'brand_name_extraction',
  'v4.14',
  '品牌分析',
  '品牌名称提取v4.14',
  '从产品信息中提取准确的品牌名称',
  'src/lib/ai.ts',
  'extractBrandWithAI',
  'You are a brand name extraction expert. Extract the brand name from product information.

=== INPUT DATA ===
URL: {{pageData.url}}
Title: {{pageData.title}}
Description: {{pageData.description}}
Page Content Preview: {{pageData.textPreview}}

=== EXTRACTION STRATEGY ===

**Priority 1: URL Analysis**
- Amazon store URLs often contain brand: amazon.com/stores/BRANDNAME
- Product URLs may have brand in path: /dp/B0xxx/BRAND-Product-Name

**Priority 2: Title Analysis**
- Brand usually appears FIRST in product titles
- Pattern: "BRANDNAME Product Description"
- Example: "Reolink 4K Security Camera" → "Reolink"

**Priority 3: Description Analysis**
- Look for "by BRAND" or "from BRAND" patterns
- Check for trademark symbols: BRAND™ or BRAND®

**Priority 4: Content Preview**
- Scan for repeated brand mentions
- Look for "Official BRAND Store" patterns

=== RULES ===
1. Return ONLY the brand name (no explanation)
2. 2-30 characters
3. Primary brand only (not sub-brands)
4. Remove suffixes: "Store", "Official", "Shop", "Inc", "LLC"
5. Preserve original capitalization

=== EXAMPLES ===
- "Reolink 4K Security Camera" → "Reolink"
- "BAGSMART Store" → "BAGSMART"
- "Apple iPhone 15 Pro" → "Apple"
- "Official Samsung Galaxy Store" → "Samsung"

Output: Brand name only.',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- competitor_analysis: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'competitor_analysis' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'competitor_analysis',
  'v4.14',
  '产品分析',
  '竞品分析v4.14',
  '竞品分析v3.2 - 新增竞品弱点挖掘',
  'src/lib/competitor-analyzer.ts',
  'analyzeCompetitors',
  'You are an e-commerce competitive analysis expert specializing in Amazon marketplace.

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
4. **Competitor Weaknesses** (NEW - CRITICAL for ads): Extract common problems/complaints about competitors that we can use as our selling points
5. **Overall Competitiveness**: Calculate our competitive position (0-100)

=== OUTPUT FORMAT ===
Return ONLY a valid JSON object with this exact structure:

{
  "featureComparison": [
    {
      "feature": "Feature name",
      "weHave": true,
      "competitorsHave": 2,
      "ourAdvantage": true
    }
  ],
  "uniqueSellingPoints": [
    {
      "usp": "Brief unique selling point",
      "differentiator": "Detailed explanation",
      "competitorCount": 0,
      "significance": "high"
    }
  ],
  "competitorAdvantages": [
    {
      "advantage": "Competitor advantage",
      "competitor": "Competitor name",
      "howToCounter": "Strategy to counter"
    }
  ],
  "competitorWeaknesses": [
    {
      "weakness": "Common competitor problem",
      "competitor": "Competitor name or Multiple competitors",
      "frequency": "high",
      "ourAdvantage": "How our product solves this",
      "adCopy": "Ready-to-use ad copy"
    }
  ],
  "overallCompetitiveness": 75
}

**Important**: Return ONLY the JSON object, no markdown code blocks, no explanations.',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- competitor_keyword_inference: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'competitor_keyword_inference' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'competitor_keyword_inference',
  'v4.14',
  '竞品分析',
  '竞品搜索关键词推断v4.14',
  '支持完整模板变量、多维度关键词策略、搜索量预估',
  'src/lib/competitor-analyzer.ts',
  'inferCompetitorKeywords',
  'You are an expert e-commerce analyst specializing in competitive keyword research on Amazon.

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
}',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- keyword_intent_clustering: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'keyword_intent_clustering',
  'v4.14',
  '关键词管理',
  '关键词意图聚类v4.14',
  '将非品牌关键词按用户搜索意图分成3个语义桶：品牌导向、场景导向、功能导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成3个语义桶。

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

# 分桶规则

## 桶A - 品牌导向 (Brand-Oriented)
**用户画像**：知道要买什么品牌，搜索品牌相关内容
**关键词特征**：
- 品牌+产品词：brand camera, brand vacuum, brand headphones
- 型号相关词：brand model xxx, brand pro, brand plus
- 官方渠道词：brand official, brand store, brand website
- 品牌系列词：brand indoor, brand outdoor, brand doorbell

**示例**：
- eufy security camera
- eufy official store
- eufy outdoor camera
- eufy doorbell
- eufycam 2 pro

## 桶B - 场景导向 (Scenario-Oriented)
**用户画像**：知道要解决什么问题，搜索使用场景/应用环境
**关键词特征**：
- 使用场景词：home security, baby monitor, pet watching
- 应用环境词：garage camera, driveway security, backyard monitoring
- 解决方案词：protect home, monitor baby, watch pets
- 注意：不包含具体功能/规格词

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- driveway security
- garage monitoring

## 桶C - 功能导向 (Feature-Oriented)
**用户画像**：关注技术规格、功能特性、产品评价
**关键词特征**：
- 功能特性词：wireless, night vision, 2k resolution, solar powered
- 技术规格词：4k camera, 180 degree view, long battery
- 购买意图词：best, top rated, cheap, affordable
- 比较词：vs, alternative, better than

**示例**：
- wireless security camera
- night vision camera
- 2k resolution camera
- best doorbell camera
- affordable home camera

# 分桶边界说明（重要）

**场景导向 vs 功能导向的区别**：
- 场景导向 = "在哪里用/为什么用"（Where/Why）
- 功能导向 = "要什么功能/什么规格"（What/How）

**混合关键词处理**：
- "wireless baby monitor" → 功能导向（wireless是功能特征）
- "home security" → 场景导向（没有功能词）
- "4k home camera" → 功能导向（4k是技术规格）

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持3个桶的关键词数量相对均衡（理想比例 30%-40%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图

# 输出格式（JSON）

{
  "bucketA": {
    "intent": "品牌导向",
    "intentEn": "Brand-Oriented",
    "description": "用户知道要买什么品牌",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketB": {
    "intent": "场景导向",
    "intentEn": "Scenario-Oriented",
    "description": "用户知道要解决什么问题",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketC": {
    "intent": "功能导向",
    "intentEn": "Feature-Oriented",
    "description": "用户关注技术规格/功能特性",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 30,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- launch_score: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'launch_score' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'launch_score',
  'v4.14',
  '投放评分',
  'Launch Score评估v4.14',
  'Launch Score 4维度评分系统 - 强制中文输出版本',
  'prompts/launch_score.txt',
  'calculateLaunchScore',
  '你是一位专业的Google Ads广告投放评估专家，使用4维度评分系统进行评估。

**重要：所有输出必须使用简体中文，包括问题描述(issues)和改进建议(suggestions)。**

=== 广告系列概览 ===
品牌: {{brand}}
产品: {{productName}}
目标国家: {{targetCountry}}
目标语言: {{targetLanguage}}
广告预算: {{budget}}
最高CPC: {{maxCpc}}

=== 品牌搜索数据 ===
品牌名称: {{brand}}
品牌月搜索量: {{brandSearchVolume}}
品牌竞争程度: {{brandCompetition}}

=== 关键词数据 ===
关键词总数: {{keywordCount}}
匹配类型分布: {{matchTypeDistribution}}
关键词搜索量:
{{keywordsWithVolume}}

否定关键词 ({{negativeKeywordsCount}}个): {{negativeKeywords}}

=== 广告创意 ===
标题数量: {{headlineCount}}
描述数量: {{descriptionCount}}
标题示例: {{sampleHeadlines}}
描述示例: {{sampleDescriptions}}
标题多样性: {{headlineDiversity}}%
广告强度: {{adStrength}}

=== 着陆页 ===
最终网址: {{finalUrl}}
页面类型: {{pageType}}

=== 4维度评分系统 (总分100分) ===

**维度1: 投放可行性 (35分)**
评估该广告系列是否值得投放，基于市场潜力。

- 品牌搜索量得分 (0-15分):
  * 月搜索量0-100: 0-3分 (品牌知名度很低)
  * 月搜索量100-500: 4-7分 (新兴品牌)
  * 月搜索量500-2000: 8-11分 (成熟品牌)
  * 月搜索量2000+: 12-15分 (强势品牌)

- 预算竞争力得分 (0-10分):
  * 评估最高CPC与市场平均CPC的关系
  * 高于市场平均: 8-10分 (竞争力强)
  * 接近市场平均: 5-7分 (正常竞争)
  * 低于市场平均: 2-4分 (竞争力弱)
  * 明显过低: 0-1分 (可能无法获得曝光)

- 竞争度得分 (0-10分):
  * 低竞争: 8-10分
  * 中等竞争: 4-7分
  * 高竞争: 0-3分

**维度2: 广告质量 (30分)**
评估广告创意的质量和效果。

- 广告强度得分 (0-15分):
  * POOR(差): 0-3分
  * AVERAGE(一般): 4-8分
  * GOOD(良好): 9-12分
  * EXCELLENT(优秀): 13-15分

- 标题多样性得分 (0-8分):
  * 评估15个标题的独特性和多样性
  * 高多样性(>80%): 7-8分
  * 中等多样性(50-80%): 4-6分
  * 低多样性(<50%): 0-3分

- 描述质量得分 (0-7分):
  * 强CTA和卖点: 6-7分
  * 一般但可用: 3-5分
  * 弱或缺少CTA: 0-2分

**维度3: 关键词策略 (20分)**
评估关键词选择和定向策略。

- 相关性得分 (0-8分):
  * 关键词与产品/品牌的匹配程度
  * 高相关性: 7-8分
  * 中等相关性: 4-6分
  * 低相关性: 0-3分

- 匹配类型得分 (0-6分):
  * 精确/词组/广泛匹配均衡: 5-6分
  * 主要使用一种类型: 2-4分
  * 仅使用广泛匹配: 0-1分
  * 注意：如果匹配类型为"Not specified"，给予中等分数(3-4分)

- 否定关键词得分 (0-6分):
  * 完善的否定词列表(20+个): 5-6分
  * 基本覆盖(10-20个): 3-4分
  * 最少覆盖(5-10个): 1-2分
  * 无否定关键词: 0分 (严重问题)

**维度4: 基础配置 (15分)**
评估技术设置和配置。

- 国家/语言匹配得分 (0-5分):
  * 完全匹配: 5分
  * 轻微不匹配: 2-4分
  * 严重不匹配: 0-1分

- 最终网址得分 (0-5分):
  * 有效且相关的URL: 4-5分
  * 有效但不够优化: 2-3分
  * 存在问题: 0-1分

- 预算合理性得分 (0-5分):
  * 预算足够测试: 4-5分
  * 预算紧张: 2-3分
  * 预算过低无法获得有效数据: 0-1分

=== 输出格式 ===
仅返回有效的JSON，使用以下精确结构:

{
  "launchViability": {
    "score": 28,
    "brandSearchVolume": 1500,
    "brandSearchScore": 10,
    "profitMargin": 0,
    "profitScore": 8,
    "competitionLevel": "MEDIUM",
    "competitionScore": 5,
    "issues": ["品牌搜索量偏低，市场认知度不足"],
    "suggestions": ["建议先通过其他渠道提升品牌知名度"]
  },
  "adQuality": {
    "score": 24,
    "adStrength": "GOOD",
    "adStrengthScore": 12,
    "headlineDiversity": 75,
    "headlineDiversityScore": 6,
    "descriptionQuality": 80,
    "descriptionQualityScore": 6,
    "issues": [],
    "suggestions": ["增加更多独特的标题变体"]
  },
  "keywordStrategy": {
    "score": 16,
    "relevanceScore": 7,
    "matchTypeScore": 5,
    "negativeKeywordsScore": 4,
    "totalKeywords": 50,
    "negativeKeywordsCount": 15,
    "matchTypeDistribution": {"EXACT": 20, "PHRASE": 15, "BROAD": 15},
    "issues": ["否定关键词数量不足"],
    "suggestions": ["添加免费、下载、维修等否定关键词"]
  },
  "basicConfig": {
    "score": 12,
    "countryLanguageScore": 5,
    "finalUrlScore": 4,
    "budgetScore": 3,
    "targetCountry": "US",
    "targetLanguage": "English",
    "finalUrl": "https://example.com",
    "dailyBudget": 10,
    "maxCpc": 0.17,
    "issues": ["预算可能不足以应对竞争激烈的关键词"],
    "suggestions": ["建议将日预算提高到20美元"]
  },
  "overallRecommendations": [
    "优先建议1：针对最重要的改进点",
    "重要建议2：显著影响投放效果的优化",
    "可选建议3：进一步提升的方向"
  ]
}

**输出规则（严格遵守）：**
1. 使用上述精确的字段名称
2. 所有评分必须在各维度限制范围内
3. 总分 = launchViability.score + adQuality.score + keywordStrategy.score + basicConfig.score
4. 仅返回JSON对象，不要添加其他文本、markdown标记或代码块
5. **所有issues、suggestions和overallRecommendations必须使用简体中文**
6. profitMargin字段保留但设置为0（不再评估盈亏平衡CPC）
7. 如果某些数据缺失（如匹配类型为"Not specified"），给予合理的中等分数，不要过度惩罚
8. issues数组描述具体问题，suggestions数组提供可操作的改进建议
9. overallRecommendations提供3-5条最重要的综合改进建议',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- product_analysis_single: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'product_analysis_single' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'product_analysis_single',
  'v4.14',
  '产品分析',
  '单品产品分析v4.14',
  '修复字段名不一致：统一使用productHighlights',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a professional product analyst. Analyze the following Amazon product page data comprehensively.

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
  "productHighlights": ["Key spec 1 (verified by reviews)", "Key spec 2", "Key spec 3"]
}',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- review_analysis: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'review_analysis' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'review_analysis',
  'v4.14',
  '产品分析',
  '评论分析v4.14',
  '评论分析v3.2 - 增强数字提取和竞品提及分析',
  'src/lib/review-analyzer.ts',
  'analyzeReviews',
  'You are an expert e-commerce review analyst specializing in extracting actionable insights from customer reviews.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===

1. **Sentiment Distribution** (Quantitative)
   - Calculate positive (4-5 stars), neutral (3 stars), negative (1-2 stars) percentages
   - Provide rating breakdown by star count

2. **Positive Keywords** (Top 10)
   - Extract frequently mentioned positive attributes
   - Include context for each keyword

3. **Negative Keywords** (Top 10)
   - Extract frequently mentioned complaints or issues
   - Include context for each keyword

4. **Real Use Cases** (5-8 scenarios)
   - Identify specific scenarios where customers use the product
   - Extract direct quotes or paraphrased examples

5. **Purchase Reasons** (Top 5)
   - Why customers bought this product
   - What problems they were trying to solve

6. **User Profiles** (3-5 types)
   - Categorize customer types based on their reviews
   - Describe characteristics and needs of each profile

7. **Common Pain Points** (Top 5)
   - Issues customers experienced
   - Severity level and frequency

8. **Quantitative Highlights** (CRITICAL - Extract ALL numbers from reviews)
   **This is the most important section for advertising!**

   Extract EVERY specific number, measurement, or quantifiable claim mentioned in reviews:

   **Performance Metrics:**
   - Battery life: "8 hours", "lasts all day", "3 days on single charge"
   - Suction power: "2000Pa", "powerful suction", "picks up everything"
   - Coverage area: "2000 sq ft", "whole house", "3 bedrooms"
   - Speed/Time: "cleans in 30 minutes", "charges in 2 hours"
   - Capacity: "500ml dustbin", "holds a week of dirt"

   **Usage Duration:**
   - "used for 6 months", "owned for 2 years", "after 3 weeks"
   - "daily use for 1 year", "10 months flawless operation"

   **Frequency:**
   - "runs 3 times per week", "daily cleaning", "every other day"
   - "cleans twice a day", "scheduled for weekdays"

   **Comparison Numbers:**
   - "50% quieter than old one", "2x more powerful"
   - "saves 2 hours per week", "replaces $500 vacuum"

   **Satisfaction Metrics:**
   - "5 stars", "10/10 recommend", "100% satisfied"
   - "would buy again", "best purchase this year"

   **Cost/Value:**
   - "worth every penny", "saved $200", "paid $699"
   - "cheaper than competitors", "half the price"

   For EACH quantitative highlight, provide:
   - metric: Category name (e.g., "Battery Life", "Usage Duration")
   - value: The specific number/measurement (e.g., "8 hours", "6 months")
   - context: Full sentence from review explaining the metric
   - adCopy: Ad-ready format (e.g., "8-Hour Battery Life", "Trusted for 6+ Months")

9. **Competitor Mentions** (Brand comparisons)
   - Which competitor brands are mentioned
   - How this product compares (better/worse/similar)
   - Specific comparison points

=== OUTPUT FORMAT ===
Return ONLY valid JSON (no markdown, no code blocks) with this exact structure:

{
  "totalReviews": number,
  "averageRating": number,
  "sentimentDistribution": {
    "totalReviews": number,
    "positive": number,
    "neutral": number,
    "negative": number,
    "ratingBreakdown": {
      "5_star": number,
      "4_star": number,
      "3_star": number,
      "2_star": number,
      "1_star": number
    }
  },
  "topPositiveKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "topNegativeKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "realUseCases": ["string"],
  "purchaseReasons": ["string"],
  "userProfiles": [
    {
      "profile": "string",
      "description": "string"
    }
  ],
  "commonPainPoints": ["string"],
  "quantitativeHighlights": [
    {
      "metric": "string",
      "value": "string",
      "context": "string",
      "adCopy": "string"
    }
  ],
  "competitorMentions": ["string"],
  "analyzedReviewCount": number,
  "verifiedReviewCount": number
}

IMPORTANT: Extract AT LEAST 8-12 quantitative highlights if the reviews contain numbers. Look for ANY mention of time, duration, frequency, measurements, percentages, or comparisons.',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ========================================
-- store_highlights_synthesis: v4.13 → v4.14
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'store_highlights_synthesis' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'store_highlights_synthesis',
  'v4.14',
  '品牌分析',
  '店铺产品亮点整合v4.14',
  '从热销商品的产品亮点中智能整合提炼出店铺级的核心产品亮点',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a product marketing expert. Analyze the product highlights from {{productCount}} hot-selling products in a brand store and synthesize them into 5-8 key store-level product highlights.

=== INPUT: Product Highlights by Product ===
{{productHighlights}}

=== TASK ===
Synthesize these product-level highlights into 5-8 concise, store-level product highlights that:
1. Identify common themes and technologies across products
2. Highlight unique innovations that differentiate the brand
3. Focus on customer benefits, not just features
4. Use clear, compelling language
5. Avoid repetition

=== OUTPUT FORMAT ===
Return a JSON object with this structure:
{
  "storeHighlights": [
    "Highlight 1 - Brief explanation",
    "Highlight 2 - Brief explanation",
    ...
  ]
}

Output in {{langName}}.',
  'Chinese',
  TRUE,
  '
v4.14 更新内容:
1. 批量更新所有Prompt到v4.14
2. 从开发环境数据库导出最新Prompt内容
'
)
ON CONFLICT (prompt_id, version) DO NOTHING;


-- ====================================================================
-- SOURCE: pg-migrations/077_enhance_audit_system.pg.sql
-- ====================================================================
-- Migration: 077_enhance_audit_system.pg.sql
-- Purpose: 完善审计系统 - 增强login_attempts表和audit_logs表（PostgreSQL版本）
-- Date: 2025-12-17

-- ============================================================================
-- 1. 完善 login_attempts 表 - 添加设备和浏览器信息
-- ============================================================================

-- 添加设备类型字段（Desktop, Mobile, Tablet, Bot）
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS device_type TEXT DEFAULT 'Unknown';

-- 添加操作系统字段
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS os TEXT DEFAULT 'Unknown';

-- 添加浏览器字段
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS browser TEXT DEFAULT 'Unknown';

-- 添加浏览器版本字段
ALTER TABLE login_attempts ADD COLUMN IF NOT EXISTS browser_version TEXT;

-- 添加完整的User-Agent字段索引（用于快速查询特定设备）
CREATE INDEX IF NOT EXISTS idx_login_attempts_device_type ON login_attempts(device_type);
CREATE INDEX IF NOT EXISTS idx_login_attempts_os ON login_attempts(os);
CREATE INDEX IF NOT EXISTS idx_login_attempts_browser ON login_attempts(browser);

-- ============================================================================
-- 2. 完善 audit_logs 表 - 确保字段完整性
-- ============================================================================

-- audit_logs 表已经存在完整字段，只需确保索引优化
-- 已有字段：id, user_id, event_type, ip_address, user_agent, details, created_at

-- 添加操作人字段（记录是谁执行的操作，用于管理员操作审计）
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS operator_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS operator_username TEXT;

-- 添加target_user_id字段（记录被操作的用户ID，用于用户管理审计）
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_username TEXT;

-- 添加操作结果字段
DO $$
BEGIN
    ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'audit_logs_status_check' AND conrelid = 'audit_logs'::regclass
    ) THEN
        ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_status_check CHECK (status IN ('success', 'failure'));
    END IF;
END $$;

-- 添加错误信息字段
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS error_message TEXT;

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_audit_logs_operator_id ON audit_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_target_user_id ON audit_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_status ON audit_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created_at ON audit_logs(user_id, created_at);

-- ============================================================================
-- 3. 创建审计日志事件类型枚举（注释说明，实际存储为TEXT）
-- ============================================================================

-- 用户管理操作事件类型：
-- - user_created: 创建用户
-- - user_updated: 更新用户信息
-- - user_disabled: 禁用用户
-- - user_enabled: 启用用户
-- - user_deleted: 删除用户（永久）
-- - user_password_reset: 管理员重置密码
-- - user_unlocked: 解锁账户
--
-- 认证事件类型：
-- - login_success: 登录成功
-- - login_failed: 登录失败
-- - account_locked: 账户被锁定
-- - password_changed: 用户修改密码
-- - logout: 用户登出

-- ============================================================================
-- 4. 数据修复 - 补充现有记录的设备信息（基于user_agent解析）
-- ============================================================================

-- 基于User-Agent字符串更新device_type
UPDATE login_attempts
SET device_type = CASE
    WHEN user_agent LIKE '%Mobile%' OR user_agent LIKE '%Android%' OR user_agent LIKE '%iPhone%' THEN 'Mobile'
    WHEN user_agent LIKE '%Tablet%' OR user_agent LIKE '%iPad%' THEN 'Tablet'
    WHEN user_agent LIKE '%Bot%' OR user_agent LIKE '%Spider%' OR user_agent LIKE '%Crawler%' THEN 'Bot'
    ELSE 'Desktop'
END
WHERE device_type = 'Unknown';

-- 基于User-Agent字符串更新os
UPDATE login_attempts
SET os = CASE
    WHEN user_agent LIKE '%Windows%' THEN 'Windows'
    WHEN user_agent LIKE '%Macintosh%' OR user_agent LIKE '%Mac OS%' THEN 'macOS'
    WHEN user_agent LIKE '%Linux%' THEN 'Linux'
    WHEN user_agent LIKE '%iPhone%' OR user_agent LIKE '%iPad%' THEN 'iOS'
    WHEN user_agent LIKE '%Android%' THEN 'Android'
    ELSE 'Unknown'
END
WHERE os = 'Unknown';

-- 基于User-Agent字符串更新browser
UPDATE login_attempts
SET browser = CASE
    WHEN user_agent LIKE '%Edg/%' THEN 'Edge'
    WHEN user_agent LIKE '%Chrome/%' AND user_agent NOT LIKE '%Edg/%' THEN 'Chrome'
    WHEN user_agent LIKE '%Firefox/%' THEN 'Firefox'
    WHEN user_agent LIKE '%Safari/%' AND user_agent NOT LIKE '%Chrome/%' THEN 'Safari'
    WHEN user_agent LIKE '%curl/%' THEN 'curl'
    WHEN user_agent LIKE '%Postman%' THEN 'Postman'
    ELSE 'Unknown'
END
WHERE browser = 'Unknown';

-- ============================================================================
-- 5. 创建统计视图 - 便于快速查询审计统计信息
-- ============================================================================

-- 用户登录统计视图
CREATE OR REPLACE VIEW v_login_stats AS
SELECT
    username_or_email,
    COUNT(*) as total_attempts,
    SUM(CASE WHEN success = TRUE THEN 1 ELSE 0 END) as successful_logins,
    SUM(CASE WHEN success = FALSE THEN 1 ELSE 0 END) as failed_logins,
    MAX(attempted_at) as last_attempt,
    device_type,
    os,
    browser
FROM login_attempts
GROUP BY username_or_email, device_type, os, browser;

-- 用户操作审计统计视图
CREATE OR REPLACE VIEW v_user_audit_stats AS
SELECT
    operator_id,
    operator_username,
    event_type,
    COUNT(*) as operation_count,
    MAX(created_at) as last_operation,
    SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
    SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count
FROM audit_logs
WHERE event_type LIKE 'user_%'
GROUP BY operator_id, operator_username, event_type;

-- ============================================================================
-- Migration完成
-- ============================================================================

-- ====================================================================
-- SOURCE: pg-migrations/078_fix_boolean_columns.pg.sql
-- ====================================================================
-- 078_fix_boolean_columns.pg.sql
-- 修复 PostgreSQL 中应该是 BOOLEAN 但实际是 INTEGER 的列
-- 问题：某些表的 is_deleted, is_active 列可能从 SQLite 迁移时保留了 INTEGER 类型
-- 导致错误：operator does not exist: integer = boolean

-- 安全检查：只在列类型是 INTEGER 时才执行转换
-- 这样可以在已经是 BOOLEAN 的数据库上安全运行

-- 1. 修复 offers 表的 is_deleted 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offers' AND column_name = 'is_deleted'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE offers
        ALTER COLUMN is_deleted TYPE BOOLEAN
        USING (is_deleted = 1 OR is_deleted::text = 'true');

        ALTER TABLE offers
        ALTER COLUMN is_deleted SET DEFAULT FALSE;

        RAISE NOTICE 'offers.is_deleted 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'offers.is_deleted 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 2. 修复 offers 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offers' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE offers
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE offers
        ALTER COLUMN is_active SET DEFAULT TRUE;

        RAISE NOTICE 'offers.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'offers.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 3. 修复 campaigns 表的 is_deleted 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'campaigns' AND column_name = 'is_deleted'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE campaigns
        ALTER COLUMN is_deleted TYPE BOOLEAN
        USING (is_deleted = 1 OR is_deleted::text = 'true');

        ALTER TABLE campaigns
        ALTER COLUMN is_deleted SET DEFAULT FALSE;

        RAISE NOTICE 'campaigns.is_deleted 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'campaigns.is_deleted 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 4. 修复 campaigns 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'campaigns' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE campaigns
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE campaigns
        ALTER COLUMN is_active SET DEFAULT FALSE;

        RAISE NOTICE 'campaigns.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'campaigns.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 5. 修复 google_ads_accounts 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'google_ads_accounts' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE google_ads_accounts
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE google_ads_accounts
        ALTER COLUMN is_active SET DEFAULT TRUE;

        RAISE NOTICE 'google_ads_accounts.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'google_ads_accounts.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 6. 修复 prompt_versions 表的 is_active 列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'prompt_versions' AND column_name = 'is_active'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE prompt_versions
        ALTER COLUMN is_active TYPE BOOLEAN
        USING (is_active = 1 OR is_active::text = 'true');

        ALTER TABLE prompt_versions
        ALTER COLUMN is_active SET DEFAULT FALSE;

        RAISE NOTICE 'prompt_versions.is_active 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'prompt_versions.is_active 已经是 BOOLEAN 类型，跳过';
    END IF;
END $$;

-- 7. 修复 system_settings 表的布尔列
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name = 'is_sensitive'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE system_settings
        ALTER COLUMN is_sensitive TYPE BOOLEAN
        USING (is_sensitive = 1 OR is_sensitive::text = 'true');

        ALTER TABLE system_settings
        ALTER COLUMN is_sensitive SET DEFAULT FALSE;

        RAISE NOTICE 'system_settings.is_sensitive 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'system_settings.is_sensitive 已经是 BOOLEAN 类型或不存在，跳过';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name = 'is_required'
        AND data_type IN ('integer', 'smallint', 'bigint')
    ) THEN
        ALTER TABLE system_settings
        ALTER COLUMN is_required TYPE BOOLEAN
        USING (is_required = 1 OR is_required::text = 'true');

        ALTER TABLE system_settings
        ALTER COLUMN is_required SET DEFAULT FALSE;

        RAISE NOTICE 'system_settings.is_required 已从 INTEGER 转换为 BOOLEAN';
    ELSE
        RAISE NOTICE 'system_settings.is_required 已经是 BOOLEAN 类型或不存在，跳过';
    END IF;
END $$;

-- 验证转换结果
SELECT
    table_name,
    column_name,
    data_type,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public'
AND column_name IN ('is_deleted', 'is_active', 'is_sensitive', 'is_required')
ORDER BY table_name, column_name;

-- ====================================================================
-- SOURCE: pg-migrations/079_update_gemini_model_config.pg.sql
-- ====================================================================
-- 迁移目标：下线Gemini 3 Pro Preview，上线Gemini 3 Flash

-- PostgreSQL版本：更新或删除系统设置中的Gemini Pro Preview相关配置
-- 如果用户之前选择了Gemini 3 Pro Preview，重置为默认值Gemini 2.5 Pro

UPDATE system_settings
SET
  value = 'gemini-2.5-pro',
  updated_at = NOW(),
  validation_status = NULL,
  validation_message = '已自动重置：Gemini 3 Pro Preview已下线，改用Gemini 2.5 Pro'
WHERE
  category = 'ai'
  AND key = 'gemini_model'
  AND value = 'gemini-3-pro-preview';

-- 更新全局默认值描述
UPDATE system_settings
SET
  description = 'Gemini Pro级别模型选择：2.5-pro或3-flash',
  updated_at = NOW()
WHERE
  user_id IS NULL
  AND category = 'ai'
  AND key = 'gemini_model';

-- ====================================================================
-- SOURCE: pg-migrations/080_launch_score_v4.15_prompt_activation.pg.sql
-- ====================================================================
-- Migration: 080_launch_score_v4.15_prompt_activation.pg.sql
-- Database: PostgreSQL
-- Purpose: Create and activate Launch Score v4.15 prompt with new scoring dimensions
-- Date: 2025-12-18
-- Author: Claude Code
--
-- Changes:
-- 1. Create new launch_score v4.15 prompt version
-- 2. Deactivate v4.14 (previous version)
-- 3. Implement new scoring structure:
--    - launchViability: 35 → 40 (removed profitScore, increased competitionScore, added marketPotentialScore)
--    - adQuality: 30 (unchanged)
--    - keywordStrategy: 20 (unchanged)
--    - basicConfig: 15 → 10 (removed budgetScore)
--    - Total: 100 points (guaranteed)
--
-- New Features:
-- - Final URL now only checks accessibility (0 or 5 points, no partial credit)
-- - profitScore field deprecated (always = 0)
-- - competitionScore increased: 0-10 → 0-15
-- - marketPotentialScore added: 0-10 (brand search volume + competition combined assessment)
-- - budgetScore deprecated in basicConfig (always = 0)

BEGIN TRANSACTION;

-- 1. Deactivate v4.14
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'launch_score' AND version = 'v4.14';

-- 2. Create or update v4.15 version (use ON CONFLICT to handle existing versions)
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
) VALUES (
  'launch_score',
  'v4.15',
  '投放评分',
  'Launch Score评估v4.15',
  '修改Launch Score评分系统：1) Final URL仅检查可访问性(满分5分) 2) 取消利润空间得分(profitScore=0) 3) 重新分配4维度(40+30+20+10=100) 4) 竞争度得分从10→15分 5) 新增市场潜力得分(10分)',
  'src/lib/scoring.ts',
  'calculateLaunchScore',
  '你是一位专业的Google Ads广告投放评估专家，使用4维度评分系统进行评估。

**重要：所有输出必须使用简体中文，包括问题描述(issues)和改进建议(suggestions)。**

=== 广告系列概览 ===
品牌: {{brand}}
产品: {{productName}}
目标国家: {{targetCountry}}
目标语言: {{targetLanguage}}
广告预算: {{budget}}
最高CPC: {{maxCpc}}

=== 品牌搜索数据 ===
品牌名称: {{brand}}
品牌月搜索量: {{brandSearchVolume}}
品牌竞争程度: {{brandCompetition}}

=== 关键词数据 ===
关键词总数: {{keywordCount}}
匹配类型分布: {{matchTypeDistribution}}
关键词搜索量:
{{keywordsWithVolume}}

否定关键词 ({{negativeKeywordsCount}}个): {{negativeKeywords}}

=== 广告创意 ===
标题数量: {{headlineCount}}
描述数量: {{descriptionCount}}
标题示例: {{sampleHeadlines}}
描述示例: {{sampleDescriptions}}
标题多样性: {{headlineDiversity}}%
广告强度: {{adStrength}}

=== 着陆页 ===
最终网址: {{finalUrl}}
页面类型: {{pageType}}

=== 4维度评分系统 (总分100分) ===

**维度1: 投放可行性 (40分)**
评估该广告系列是否值得投放，基于市场潜力。

- 品牌搜索量得分 (0-15分):
  * 月搜索量0-100: 0-3分 (品牌知名度很低)
  * 月搜索量100-500: 4-7分 (新兴品牌)
  * 月搜索量500-2000: 8-11分 (成熟品牌)
  * 月搜索量2000+: 12-15分 (强势品牌)

- 竞争度得分 (0-15分):
  * 竞争度评估基于关键词搜索数据中的竞争度级别:
  * 低竞争 (LOW): 12-15分 (有利可图，易获胜)
  * 中等竞争 (MEDIUM): 7-11分 (正常竞争，需要优化)
  * 高竞争 (HIGH): 0-6分 (激烈竞争，需要大量投入)

- 市场潜力得分 (0-10分):
  * 基于品牌搜索量与竞争度的综合判断:
  * 高搜索量 + 低竞争: 9-10分 (最优市场)
  * 高搜索量 + 中竞争: 7-8分 (良好市场)
  * 高搜索量 + 高竞争: 5-6分 (需要投入)
  * 中搜索量 + 低竞争: 7-8分 (稳定市场)
  * 中搜索量 + 中竞争: 5-6分 (正常市场)
  * 中搜索量 + 高竞争: 3-4分 (需谨慎)
  * 低搜索量 + 任何竞争: 0-3分 (市场小)

**维度2: 广告质量 (30分)**
评估广告创意的质量和效果。

- 广告强度得分 (0-15分):
  * POOR(差): 0-3分
  * AVERAGE(一般): 4-8分
  * GOOD(良好): 9-12分
  * EXCELLENT(优秀): 13-15分

- 标题多样性得分 (0-8分):
  * 评估15个标题的独特性和多样性
  * 高多样性(>80%): 7-8分
  * 中等多样性(50-80%): 4-6分
  * 低多样性(<50%): 0-3分

- 描述质量得分 (0-7分):
  * 强CTA和卖点: 6-7分
  * 一般但可用: 3-5分
  * 弱或缺少CTA: 0-2分

**维度3: 关键词策略 (20分)**
评估关键词选择和定向策略。

- 相关性得分 (0-8分):
  * 关键词与产品/品牌的匹配程度
  * 高相关性: 7-8分
  * 中等相关性: 4-6分
  * 低相关性: 0-3分

- 匹配类型得分 (0-6分):
  * 精确/词组/广泛匹配均衡: 5-6分
  * 主要使用一种类型: 2-4分
  * 仅使用广泛匹配: 0-1分
  * 注意：如果匹配类型为"Not specified"，给予中等分数(3-4分)

- 否定关键词得分 (0-6分):
  * 完善的否定词列表(20+个): 5-6分
  * 基本覆盖(10-20个): 3-4分
  * 最少覆盖(5-10个): 1-2分
  * 无否定关键词: 0分 (严重问题)

**维度4: 基础配置 (10分)**
评估技术设置和配置。

- 国家/语言匹配得分 (0-5分):
  * 完全匹配: 5分
  * 轻微不匹配: 2-4分
  * 严重不匹配: 0-1分

- 最终网址得分 (0-5分):
  * URL可以正常访问(HTTP 200): 5分 (满分)
  * URL无法访问或存在问题: 0分

=== 输出格式 ===
仅返回有效的JSON，使用以下精确结构:

{
  "launchViability": {
    "score": 38,
    "brandSearchVolume": 1500,
    "brandSearchScore": 14,
    "profitMargin": 0,
    "profitScore": 0,
    "competitionLevel": "MEDIUM",
    "competitionScore": 14,
    "marketPotentialScore": 10,
    "issues": ["品牌搜索量处于中等水平，市场认知度需提升"],
    "suggestions": ["建议先通过其他渠道提升品牌知名度"]
  },
  "adQuality": {
    "score": 28,
    "adStrength": "GOOD",
    "adStrengthScore": 12,
    "headlineDiversity": 85,
    "headlineDiversityScore": 7,
    "descriptionQuality": 80,
    "descriptionQualityScore": 6,
    "issues": [],
    "suggestions": ["增加更多独特的标题变体"]
  },
  "keywordStrategy": {
    "score": 18,
    "relevanceScore": 7,
    "matchTypeScore": 5,
    "negativeKeywordsScore": 4,
    "totalKeywords": 50,
    "negativeKeywordsCount": 15,
    "matchTypeDistribution": {"EXACT": 20, "PHRASE": 15, "BROAD": 15},
    "issues": ["否定关键词数量不足"],
    "suggestions": ["添加免费、下载、维修等否定关键词"]
  },
  "basicConfig": {
    "score": 10,
    "countryLanguageScore": 5,
    "finalUrlScore": 5,
    "budgetScore": 0,
    "targetCountry": "US",
    "targetLanguage": "English",
    "finalUrl": "https://example.com",
    "dailyBudget": 10,
    "maxCpc": 0.17,
    "issues": [],
    "suggestions": []
  },
  "overallRecommendations": [
    "优先建议1：针对最重要的改进点",
    "重要建议2：显著影响投放效果的优化",
    "可选建议3：进一步提升的方向"
  ]
}

**输出规则（严格遵守）：**
1. 使用上述精确的字段名称
2. 所有评分必须在各维度限制范围内
3. 总分 = launchViability.score + adQuality.score + keywordStrategy.score + basicConfig.score (必须 = 100)
4. 仅返回JSON对象，不要添加其他文本、markdown标记或代码块
5. **所有issues、suggestions和overallRecommendations必须使用简体中文**
6. profitMargin字段保留但设置为0（不再评估盈亏平衡CPC）
7. profitScore字段必须设置为0（已取消利润空间评分）
8. 新增marketPotentialScore字段(0-10分)在launchViability中，用于综合评估品牌搜索量与竞争度
9. basicConfig中budgetScore字段已移除评分职责，保留字段但设置为0
10. 如果某些数据缺失（如匹配类型为"Not specified"），给予合理的中等分数，不要过度惩罚
11. issues数组描述具体问题，suggestions数组提供可操作的改进建议
12. overallRecommendations提供3-5条最重要的综合改进建议',
  'Chinese',
  1,
  true,
  'v4.14 → v4.15: 修改评分维度权重(40+30+20+10=100)、取消利润评分、新增市场潜力评分、Final URL仅检查可访问性',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;

COMMIT;

-- Verification Query (run after migration to verify activation):
-- SELECT version, is_active FROM prompt_versions
-- WHERE prompt_id = 'launch_score'
-- ORDER BY created_at DESC LIMIT 5;

-- ====================================================================
-- SOURCE: pg-migrations/081_launch_score_v4.16_matchtype_scoring.pg.sql
-- ====================================================================
-- Migration: 081_launch_score_v4.16_matchtype_scoring.pg.sql
-- Database: PostgreSQL
-- Purpose: Update Launch Score to v4.16 with intelligent matchType scoring strategy
-- Date: 2025-12-18
-- Author: Claude Code
--
-- Changes:
-- 1. Create new launch_score v4.16 prompt version
-- 2. Deactivate v4.15 (previous version)
-- 3. Update matchType scoring logic (0-6 points):
--    - Reward EXACT match for brand keywords (brand protection)
--    - Reward PHRASE match for brand-related and generic keywords (quality control)
--    - Penalize excessive BROAD match usage (>30% = risk)
--    - Scoring examples:
--      * EXACT: 5 + PHRASE: 25 + BROAD: 0 = 6 points (perfect)
--      * EXACT: 3 + PHRASE: 20 + BROAD: 7 = 4 points (good)
--      * EXACT: 0 + PHRASE: 15 + BROAD: 15 = 2 points (risky)
--
-- Related Code Changes:
-- - src/lib/ad-creative-generator.ts: Auto-assign matchType during creative generation
-- - src/lib/keyword-generator.ts: KISS-principle negative keywords (10 categories, 77+ keywords)
--
-- Migration Strategy:
-- - Only insert new prompt version, no table structure changes
-- - Existing launch_scores data remains compatible
-- - Prompt cache must be cleared after migration

BEGIN TRANSACTION;

-- 1. Deactivate v4.15
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'launch_score' AND version = 'v4.15';

-- 2. Create or update v4.16 version (use ON CONFLICT to handle existing versions)
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
) VALUES (
  'launch_score',
  'v4.16',
  '投放评分',
  'Launch Score评估v4.16 - 智能matchType评分',
  '更新matchType评分逻辑：奖励品牌词EXACT精准匹配和非品牌词PHRASE控制性扩展策略。最优策略：纯品牌词→EXACT，品牌相关词→PHRASE，非品牌通用词→PHRASE，BROAD占比≤10%为最优。',
  'src/lib/scoring.ts',
  'calculateLaunchScore',
  '你是一位专业的Google Ads广告投放评估专家，使用4维度评分系统进行评估。

**重要：所有输出必须使用简体中文，包括问题描述(issues)和改进建议(suggestions)。**

=== 广告系列概览 ===
品牌: {{brand}}
产品: {{productName}}
目标国家: {{targetCountry}}
目标语言: {{targetLanguage}}
广告预算: {{budget}}
最高CPC: {{maxCpc}}

=== 品牌搜索数据 ===
品牌名称: {{brand}}
品牌月搜索量: {{brandSearchVolume}}
品牌竞争程度: {{brandCompetition}}

=== 关键词数据 ===
关键词总数: {{keywordCount}}
匹配类型分布: {{matchTypeDistribution}}
关键词搜索量:
{{keywordsWithVolume}}

否定关键词 ({{negativeKeywordsCount}}个): {{negativeKeywords}}

=== 广告创意 ===
标题数量: {{headlineCount}}
描述数量: {{descriptionCount}}
标题示例: {{sampleHeadlines}}
描述示例: {{sampleDescriptions}}
标题多样性: {{headlineDiversity}}%
广告强度: {{adStrength}}

=== 着陆页 ===
最终网址: {{finalUrl}}
页面类型: {{pageType}}

=== 4维度评分系统 (总分100分) ===

**维度1: 投放可行性 (40分)**
评估该广告系列是否值得投放，基于市场潜力。

- 品牌搜索量得分 (0-15分):
  * 月搜索量0-100: 0-3分 (品牌知名度很低)
  * 月搜索量100-500: 4-7分 (新兴品牌)
  * 月搜索量500-2000: 8-11分 (成熟品牌)
  * 月搜索量2000+: 12-15分 (强势品牌)

- 竞争度得分 (0-15分):
  * 竞争度评估基于关键词搜索数据中的竞争度级别:
  * 低竞争 (LOW): 12-15分 (有利可图，易获胜)
  * 中等竞争 (MEDIUM): 7-11分 (正常竞争，需要优化)
  * 高竞争 (HIGH): 0-6分 (激烈竞争，需要大量投入)

- 市场潜力得分 (0-10分):
  * 基于品牌搜索量与竞争度的综合判断:
  * 高搜索量 + 低竞争: 9-10分 (最优市场)
  * 高搜索量 + 中竞争: 7-8分 (良好市场)
  * 高搜索量 + 高竞争: 5-6分 (需要投入)
  * 中搜索量 + 低竞争: 7-8分 (稳定市场)
  * 中搜索量 + 中竞争: 5-6分 (正常市场)
  * 中搜索量 + 高竞争: 3-4分 (需谨慎)
  * 低搜索量 + 任何竞争: 0-3分 (市场小)

**维度2: 广告质量 (30分)**
评估广告创意的质量和效果。

- 广告强度得分 (0-15分):
  * POOR(差): 0-3分
  * AVERAGE(一般): 4-8分
  * GOOD(良好): 9-12分
  * EXCELLENT(优秀): 13-15分

- 标题多样性得分 (0-8分):
  * 评估15个标题的独特性和多样性
  * 高多样性(>80%): 7-8分
  * 中等多样性(50-80%): 4-6分
  * 低多样性(<50%): 0-3分

- 描述质量得分 (0-7分):
  * 强CTA和卖点: 6-7分
  * 一般但可用: 3-5分
  * 弱或缺少CTA: 0-2分

**维度3: 关键词策略 (20分)**
评估关键词选择和定向策略。

- 相关性得分 (0-8分):
  * 关键词与产品/品牌的匹配程度
  * 高相关性: 7-8分
  * 中等相关性: 4-6分
  * 低相关性: 0-3分

- 匹配类型得分 (0-6分) **新策略(v4.16)**:
  * 评估策略：品牌词精准化 + 非品牌词控制性扩展

  **最优策略 (5-6分)**：
  - 纯品牌词使用EXACT精准匹配（品牌保护）
  - 品牌相关词使用PHRASE词组匹配（受控扩展）
  - 非品牌通用词使用PHRASE词组匹配（质量控制）
  - BROAD广泛匹配占比 ≤ 10%（新账户慎用）

  **良好策略 (3-4分)**：
  - 大部分关键词使用EXACT或PHRASE
  - BROAD广泛匹配占比 10-30%
  - 品牌词未完全保护（部分使用PHRASE）

  **风险策略 (0-2分)**：
  - 品牌词未使用EXACT精准匹配（严重问题）
  - BROAD广泛匹配占比 > 30%（流量失控风险）
  - 仅使用单一匹配类型

  **评分示例**：
  - EXACT: 5个 + PHRASE: 25个 + BROAD: 0个 = 6分（完美策略）
  - EXACT: 3个 + PHRASE: 20个 + BROAD: 7个 = 4分（良好）
  - EXACT: 0个 + PHRASE: 15个 + BROAD: 15个 = 2分（风险）
  - Not specified（未设置）: 3-4分（中等，提示需要设置）

- 否定关键词得分 (0-6分):
  * 完善的否定词列表(20+个): 5-6分
  * 基本覆盖(10-20个): 3-4分
  * 最少覆盖(5-10个): 1-2分
  * 无否定关键词: 0分 (严重问题)

**维度4: 基础配置 (10分)**
评估技术设置和配置。

- 国家/语言匹配得分 (0-5分):
  * 完全匹配: 5分
  * 轻微不匹配: 2-4分
  * 严重不匹配: 0-1分

- 最终网址得分 (0-5分):
  * URL可以正常访问(HTTP 200): 5分 (满分)
  * URL无法访问或存在问题: 0分

=== 输出格式 ===
仅返回有效的JSON，使用以下精确结构:

{
  "launchViability": {
    "score": 38,
    "brandSearchVolume": 1500,
    "brandSearchScore": 14,
    "profitMargin": 0,
    "profitScore": 0,
    "competitionLevel": "LOW",
    "competitionScore": 14,
    "marketPotentialScore": 10,
    "issues": [],
    "suggestions": ["考虑扩展到其他低竞争市场"]
  },
  "adQuality": {
    "score": 28,
    "adStrength": "GOOD",
    "adStrengthScore": 12,
    "headlineDiversity": 85,
    "headlineDiversityScore": 7,
    "descriptionQuality": 90,
    "descriptionQualityScore": 6,
    "issues": [],
    "suggestions": ["可进一步提升标题差异化至95%以上"]
  },
  "keywordStrategy": {
    "score": 18,
    "relevanceScore": 7,
    "matchTypeScore": 6,
    "negativeKeywordsScore": 5,
    "totalKeywords": 15,
    "negativeKeywordsCount": 8,
    "matchTypeDistribution": {
      "EXACT": 5,
      "PHRASE": 8,
      "BROAD": 2
    },
    "issues": [],
    "suggestions": ["增加品牌保护型否定关键词"]
  },
  "basicConfig": {
    "score": 10,
    "countryLanguageScore": 5,
    "finalUrlScore": 5,
    "budgetScore": 0,
    "targetCountry": "US",
    "targetLanguage": "English",
    "finalUrl": "https://example.com",
    "dailyBudget": 10,
    "maxCpc": 0.17,
    "issues": [],
    "suggestions": []
  },
  "overallRecommendations": [
    "优先建议1：针对最重要的改进点",
    "重要建议2：显著影响投放效果的优化",
    "可选建议3：进一步提升的方向"
  ]
}

**输出规则（严格遵守）：**
1. 使用上述精确的字段名称
2. 所有评分必须在各维度限制范围内
3. 总分 = launchViability.score + adQuality.score + keywordStrategy.score + basicConfig.score (范围0-100，各维度独立评分)
4. 仅返回JSON对象，不要添加其他文本、markdown标记或代码块
5. **所有issues、suggestions和overallRecommendations必须使用简体中文**
6. profitMargin字段保留但设置为0（不再评估盈亏平衡CPC）
7. profitScore字段必须设置为0（已取消利润空间评分）
8. 新增marketPotentialScore字段(0-10分)在launchViability中，用于综合评估品牌搜索量与竞争度
9. basicConfig中budgetScore字段已移除评分职责，保留字段但设置为0
10. 如果某些数据缺失（如匹配类型为"Not specified"），给予合理的中等分数，不要过度惩罚
11. issues数组描述具体问题，suggestions数组提供可操作的改进建议
12. overallRecommendations提供3-5条最重要的综合改进建议
13. **v4.16新增**: matchType评分遵循"品牌词精准化 + 非品牌词控制性扩展"策略，奖励EXACT品牌保护和PHRASE质量控制',
  'Chinese',
  1,
  true,
  'v4.15 → v4.16: 更新matchType评分逻辑，奖励品牌词EXACT精准匹配和非品牌词PHRASE控制性扩展策略。新策略：纯品牌词→EXACT，品牌相关词→PHRASE，非品牌通用词→PHRASE，BROAD占比≤10%为最优。',
  NOW()
) ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes;

COMMIT;

-- Verification Query (run after migration to verify activation):
-- SELECT version, is_active, name FROM prompt_versions
-- WHERE prompt_id = 'launch_score'
-- ORDER BY created_at DESC LIMIT 5;

-- Expected Result:
-- v4.16 | true  | Launch Score评估v4.16 - 智能matchType评分
-- v4.15 | false | Launch Score评估v4.15
-- v4.14 | false | Launch Score评估v4.14

-- Post-Migration Steps:
-- 1. Clear prompt cache: npx tsx scripts/clear-prompt-cache.ts
-- 2. Verify new prompt loaded correctly
-- 3. Test Launch Score calculation with new matchType scoring

-- ====================================================================
-- SOURCE: pg-migrations/082_add_negative_keyword_matchtype.pg.sql
-- ====================================================================
-- Migration: 082_add_negative_keyword_matchtype.pg.sql
-- Purpose: Add support for negative keyword match type configuration (PostgreSQL version)
-- Date: 2025-12-18
-- Database: PostgreSQL
-- Description:
--   Google Ads API requires specifying match type for negative keywords (BROAD/PHRASE/EXACT).
--   Previously, all negative keywords were hardcoded to BROAD match, causing unintended filtering.
--   This migration adds a JSONB field to track match type for each negative keyword.
--
-- PostgreSQL-specific features used:
--   - JSONB type for efficient JSON storage and querying
--   - jsonb_object_agg() for aggregation
--   - GIN index for performance
--   - Regex operator ~ for pattern matching
--
-- Example data structure:
--   negative_keywords = ["or", "free", "how to"]
--   negative_keywords_match_type = {
--     "or": "EXACT",
--     "free": "EXACT",
--     "how to": "PHRASE"
--   }

BEGIN;

-- Add the new column to ad_creatives table
ALTER TABLE ad_creatives
ADD COLUMN IF NOT EXISTS negative_keywords_match_type JSONB DEFAULT '{}'::jsonb;

-- Initialize with default values for existing creatives
-- Strategy:
--   - Single-word negative keywords → EXACT match (防止误伤，如 "or" 不应匹配 "doorbell" 中的字母)
--   - Multi-word phrases → PHRASE match (允许词序变化，但不允许额外词)
--
-- Note: negative_keywords is stored as TEXT containing JSON array
UPDATE ad_creatives
SET negative_keywords_match_type = (
  SELECT jsonb_object_agg(
    kw,
    CASE
      WHEN kw ~ ' ' THEN 'PHRASE'::text  -- Contains space → PHRASE match
      ELSE 'EXACT'::text                  -- Single word → EXACT match
    END
  )
  FROM jsonb_array_elements_text(
    CASE
      WHEN negative_keywords IS NULL OR negative_keywords = '' THEN '[]'::jsonb
      WHEN negative_keywords = 'null' THEN '[]'::jsonb
      ELSE negative_keywords::jsonb
    END
  ) AS kw
)
WHERE negative_keywords IS NOT NULL
  AND negative_keywords != ''
  AND negative_keywords != 'null'
  AND jsonb_array_length(
    CASE
      WHEN negative_keywords IS NULL OR negative_keywords = '' THEN '[]'::jsonb
      WHEN negative_keywords = 'null' THEN '[]'::jsonb
      ELSE negative_keywords::jsonb
    END
  ) > 0;

-- Create GIN index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS idx_ad_creatives_negative_keywords_match_type
ON ad_creatives USING GIN (negative_keywords_match_type);

-- Add column comment for documentation
COMMENT ON COLUMN ad_creatives.negative_keywords_match_type IS
'JSONB map of negative keywords to their match types (BROAD/PHRASE/EXACT).
Example: {"or": "EXACT", "how to": "PHRASE"}.
Prevents unintended filtering due to partial word matches.
Used by createGoogleAdsKeywordsBatch() to determine correct match type for negative keywords.';

COMMIT;

-- ====================================================================
-- SOURCE: pg-migrations/083_update_queue_config_campaign_publish.pg.sql
-- ====================================================================
-- Migration: Update queue config to include campaign-publish task type
-- Description: Add campaign-publish to perTypeConcurrency configuration
-- Date: 2025-12-19
-- Affected: system_settings table (queue config)

-- Update queue configuration to include campaign-publish task type
UPDATE system_settings
SET
  value = jsonb_set(
    value::jsonb,
    '{perTypeConcurrency,campaign-publish}',
    '2'::jsonb
  )::text,
  updated_at = NOW()
WHERE
  category = 'queue'
  AND key = 'config'
  AND user_id IS NULL
  AND (value::jsonb->'perTypeConcurrency'->>'campaign-publish') IS NULL;

-- Verification query
-- This should return the updated config with campaign-publish
SELECT value
FROM system_settings
WHERE category = 'queue' AND key = 'config' AND user_id IS NULL;

-- Expected result: perTypeConcurrency should include "campaign-publish": 2

-- ====================================================================
-- SOURCE: pg-migrations/084_add_system_settings_unique_constraint.pg.sql
-- ====================================================================
-- Migration: Add unique constraint to system_settings (PostgreSQL - FIXED VERSION)
-- Purpose: Prevent duplicate (category, key) entries with non-empty values
-- IMPORTANT: This version preserves global templates (user_id IS NULL, value = NULL)
-- Date: 2025-12-20 (Fixed)

-- Step 1: Clean up duplicate user configuration records only
-- Remove duplicate user configurations, but preserve global templates
DELETE FROM system_settings s1
WHERE s1.user_id IS NOT NULL  -- Only delete user configurations
  AND s1.value IS NOT NULL
  AND s1.value <> ''
  AND EXISTS (
    SELECT 1 FROM system_settings s2
    WHERE s2.category = s1.category
      AND s2.key = s1.key
      AND s2.user_id IS NOT NULL  -- Only compare user configurations
      AND s2.value IS NOT NULL
      AND s2.value <> ''
      AND s2.updated_at > s1.updated_at  -- Keep the latest record
      AND s2.id != s1.id
  );

-- Step 2: Remove empty/null user configurations (but NOT global templates)
DELETE FROM system_settings
WHERE user_id IS NOT NULL  -- Only delete user configurations
  AND (value IS NULL OR value = '');

-- Step 3: Create unique partial index to prevent future duplicates
-- This index only applies to records with non-empty values
-- Global templates (value = NULL) and user configurations (value = JSON) can coexist
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_settings_category_key_unique
  ON system_settings(category, key)
  WHERE value IS NOT NULL AND value <> '';

-- Verification queries (commented out for production)
-- Check for duplicates in non-null values
-- SELECT category, key, COUNT(*) as count
-- FROM system_settings
-- WHERE value IS NOT NULL AND value <> ''
-- GROUP BY category, key
-- HAVING COUNT(*) > 1;

-- Check global templates exist
-- SELECT category, key, 'Global Template' as type
-- FROM system_settings
-- WHERE user_id IS NULL
-- GROUP BY category, key
-- ORDER BY category, key;

-- ====================================================================
-- SOURCE: pg-migrations/085_add_missing_proxy_urls_template.pg.sql
-- ====================================================================
-- Migration: Add missing proxy.urls global template (PostgreSQL)
-- Purpose: Insert the missing global template record for proxy.urls configuration
-- Date: 2025-12-20

-- Insert the global template for proxy.urls if it doesn't exist
-- PostgreSQL uses WHERE NOT EXISTS pattern instead of INSERT OR IGNORE
INSERT INTO system_settings (
  user_id,
  category,
  key,
  value,
  data_type,
  is_sensitive,
  is_required,
  description
)
SELECT
  NULL,
  'proxy',
  'urls',
  NULL,
  'json',
  false,
  false,
  '代理URL配置，JSON格式存储国家与代理URL的映射'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'proxy'
    AND key = 'urls'
    AND user_id IS NULL
);

-- Verification query (commented out for production)
-- SELECT user_id, category, key, value, data_type, description
-- FROM system_settings
-- WHERE category = 'proxy' AND key = 'urls';

-- ====================================================================
-- SOURCE: pg-migrations/086_fix_system_settings_unique_constraint.pg.sql
-- ====================================================================
-- Migration: Fix unique constraint for system_settings (PostgreSQL)
-- Purpose: Ensure global templates are also unique, not just user configurations
-- Date: 2025-12-20

-- Step 1: Clean up duplicate global templates
-- Keep only one global template per (category, key)
DELETE FROM system_settings s1
WHERE s1.user_id IS NULL
  AND s1.value IS NULL
  AND EXISTS (
    SELECT 1 FROM system_settings s2
    WHERE s2.category = s1.category
      AND s2.key = s1.key
      AND s2.user_id IS NULL
      AND s2.value IS NULL
      AND s2.id < s1.id  -- Keep the record with the smallest ID
  );

-- Step 2: Create more comprehensive unique constraints
-- Drop the existing partial index
DROP INDEX IF EXISTS idx_system_settings_category_key_unique;

-- Create a unique index for user configurations
-- This ensures each user can have only one config per (category, key)
CREATE UNIQUE INDEX idx_system_settings_user_config_unique
  ON system_settings(category, key, user_id)
  WHERE user_id IS NOT NULL AND value IS NOT NULL AND value <> '';

-- Create a unique index for global templates
-- This ensures only one global template per (category, key)
CREATE UNIQUE INDEX idx_system_settings_global_template_unique
  ON system_settings(category, key)
  WHERE user_id IS NULL AND value IS NULL;

-- Verification queries (commented out for production)
-- Check global templates are unique
-- SELECT category, key, COUNT(*) as count
-- FROM system_settings
-- WHERE user_id IS NULL AND value IS NULL
-- GROUP BY category, key
-- HAVING COUNT(*) > 1;

-- Check user configurations are unique per user
-- SELECT category, key, user_id, COUNT(*) as count
-- FROM system_settings
-- WHERE user_id IS NOT NULL AND value IS NOT NULL AND value <> ''
-- GROUP BY category, key, user_id
-- HAVING COUNT(*) > 1;

-- ====================================================================
-- SOURCE: pg-migrations/087_restore_global_templates.pg.sql
-- ====================================================================
-- Emergency Fix: Restore all missing global templates (PostgreSQL)
-- Purpose: Re-insert all global templates that were deleted by 084 migration
-- Date: 2025-12-20
-- This is a CRITICAL fix for production

-- Google Ads settings
INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'login_customer_id', NULL, 'string', false, true, 'MCC管理账户ID，用于访问您管理的广告账户'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'login_customer_id' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'client_id', NULL, 'string', true, false, 'OAuth 2.0客户端ID'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'client_id' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'client_secret', NULL, 'string', true, false, 'OAuth 2.0客户端密钥'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'client_secret' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, description
)
SELECT NULL, 'google_ads', 'developer_token', NULL, 'string', true, false, 'Google Ads API开发者令牌'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'google_ads' AND key = 'developer_token' AND user_id IS NULL);

-- AI settings
INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'use_vertex_ai', NULL, 'boolean', false, false, 'false', 'AI模式选择：true=Vertex AI, false=Gemini API'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'use_vertex_ai' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gemini_api_key', NULL, 'string', true, false, NULL, 'Gemini API密钥'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gemini_api_key' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gemini_model', NULL, 'string', false, false, 'gemini-2.5-pro', 'Gemini模型名称'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gemini_model' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gcp_project_id', NULL, 'string', false, false, NULL, 'GCP项目ID'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gcp_project_id' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gcp_location', NULL, 'string', false, false, 'us-central1', 'GCP区域'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gcp_location' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'ai', 'gcp_service_account_json', NULL, 'text', true, false, NULL, 'GCP Service Account JSON凭证'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'ai' AND key = 'gcp_service_account_json' AND user_id IS NULL);

-- System settings
INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'currency', NULL, 'string', false, false, 'CNY', '默认货币单位'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'currency' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'language', NULL, 'string', false, false, 'zh-CN', '系统语言'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'language' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'sync_interval_hours', NULL, 'number', false, false, '6', '数据同步间隔（小时）'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'sync_interval_hours' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'link_check_enabled', NULL, 'boolean', false, false, 'true', '是否启用链接检查'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'link_check_enabled' AND user_id IS NULL);

INSERT INTO system_settings (
  user_id, category, key, value, data_type, is_sensitive, is_required, default_value, description
)
SELECT NULL, 'system', 'link_check_time', NULL, 'string', false, false, '02:00', '链接检查时间'
WHERE NOT EXISTS (SELECT 1 FROM system_settings WHERE category = 'system' AND key = 'link_check_time' AND user_id IS NULL);

-- Verification
SELECT 'Global templates restored: ' || COUNT(*) as status
FROM system_settings
WHERE user_id IS NULL;

-- ====================================================================
-- SOURCE: pg-migrations/088_add_bucket_d_to_keyword_pools.pg.sql
-- ====================================================================
-- Migration: Add Bucket D (High Purchase Intent) to Offer Keyword Pools (PostgreSQL)
-- Date: 2025-12-22
-- Description: Adds bucket_d_keywords and bucket_d_intent fields to support 5 creative buckets (A/B/C/D/S)

-- Add bucket_d_keywords column (JSONB for PostgreSQL)
ALTER TABLE offer_keyword_pools
ADD COLUMN IF NOT EXISTS bucket_d_keywords JSONB DEFAULT '[]'::jsonb;

-- Add bucket_d_intent column
ALTER TABLE offer_keyword_pools
ADD COLUMN IF NOT EXISTS bucket_d_intent TEXT DEFAULT '高购买意图';

-- Update existing records to have default values
UPDATE offer_keyword_pools
SET bucket_d_keywords = '[]'::jsonb, bucket_d_intent = '高购买意图'
WHERE bucket_d_keywords IS NULL OR bucket_d_intent IS NULL;

-- ====================================================================
-- SOURCE: pg-migrations/089_add_bucket_d_to_ad_creatives.pg.sql
-- ====================================================================
-- Migration: Add Bucket D to ad_creatives keyword_bucket constraint (PostgreSQL)
-- Date: 2025-12-22
-- Description: Updates CHECK constraint to support 'D' bucket in addition to 'A', 'B', 'C', 'S'

-- PostgreSQL supports ALTER TABLE DROP/ADD CONSTRAINT
ALTER TABLE ad_creatives
DROP CONSTRAINT IF EXISTS ad_creatives_keyword_bucket_check;

ALTER TABLE ad_creatives
ADD CONSTRAINT ad_creatives_keyword_bucket_check
CHECK (keyword_bucket IN ('A', 'B', 'C', 'D', 'S'));

-- ====================================================================
-- SOURCE: pg-migrations/090_update_keyword_intent_clustering_v4.15.pg.sql
-- ====================================================================
-- Migration: 090_update_keyword_intent_clustering_v4.15
-- Description: 更新keyword_intent_clustering prompt到 v4.15，支持4桶聚类
-- Created: 2025-12-22
-- Version: v4.14 → v4.15
-- Prompts: 1 个 (keyword_intent_clustering)
-- Database: PostgreSQL
-- Author: Claude Code

-- ========================================
-- keyword_intent_clustering: v4.14 → v4.15
-- ========================================

-- 1. 将当前活跃版本设为非活跃
-- PostgreSQL使用TRUE/FALSE而不是1/0
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

-- 2. 插入新版本
-- PostgreSQL语法与SQLite基本相同，注意字符串转义使用单引号''
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  change_notes
) VALUES (
  'keyword_intent_clustering',
  'v4.15',
  '关键词管理',
  '关键词意图聚类v4.15',
  '支持4桶聚类：品牌导向、场景导向、功能导向、高购买意图导向',
  'src/lib/offer-keyword-pool.ts',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。请将以下关键词按用户搜索意图分成4个语义桶。

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

# 分桶规则

## 桶A - 品牌导向 (Brand-Oriented)
**用户画像**：知道要买什么品牌，搜索品牌相关内容
**关键词特征**：
- 品牌+产品词：brand camera, brand vacuum, brand headphones
- 型号相关词：brand model xxx, brand pro, brand plus
- 官方渠道词：brand official, brand store, brand website
- 品牌系列词：brand indoor, brand outdoor, brand doorbell

**示例**：
- eufy security camera
- eufy official store
- eufy outdoor camera
- eufy doorbell
- eufycam 2 pro

## 桶B - 场景导向 (Scenario-Oriented)
**用户画像**：知道要解决什么问题，搜索使用场景/应用环境
**关键词特征**：
- 使用场景词：home security, baby monitor, pet watching
- 应用环境词：garage camera, driveway security, backyard monitoring
- 解决方案词：protect home, monitor baby, watch pets
- 注意：不包含具体功能/规格词

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- driveway security
- garage monitoring

## 桶C - 功能导向 (Feature-Oriented)
**用户画像**：关注技术规格、功能特性、产品评价
**关键词特征**：
- 功能特性词：wireless, night vision, 2k resolution, solar powered
- 技术规格词：4k camera, 180 degree view, long battery
- 购买意图词：best, top rated, cheap, affordable
- 比较词：vs, alternative, better than

**示例**：
- wireless security camera
- night vision camera
- 2k resolution camera
- best doorbell camera
- affordable home camera

## 桶D - 高购买意图导向 (High Purchase Intent)
**用户画像**：有明确购买意图，搜索具体产品或优惠信息
**关键词特征**：
- 购买相关词：buy, purchase, deal, sale, discount, coupon, cheap, price
- 交易词：shop, order, online, store, cheapest, best price
- 促销词：clearance, promotion, offer, bundle, package
- 紧迫感词：limited, today, now, urgent

**示例**：
- buy security camera
- security camera deals
- discount camera
- cheapest security camera
- camera sale today
- security camera coupon
- best price security camera
- buy eufy camera online

# 分桶边界说明（重要）

**场景导向 vs 功能导向的区别**：
- 场景导向 = "在哪里用/为什么用"（Where/Why）
- 功能导向 = "要什么功能/什么规格"（What/How）

**高购买意图导向识别**：
- 包含购买动作词：buy, purchase, shop, order
- 包含价格/优惠词：deal, discount, cheap, price, coupon
- 包含紧迫感词：today, now, limited, urgent
- 包含交易平台词：online, store, shop

**混合关键词处理**：
- "buy wireless camera" → 高购买意图导向（buy是购买动作）
- "wireless baby monitor" → 功能导向（wireless是功能特征）
- "home security" → 场景导向（没有功能词和购买词）
- "4k home camera" → 功能导向（4k是技术规格）
- "security camera deals" → 高购买意图导向（deals是优惠词）

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶，不能重复
2. **完整性**：所有关键词都必须分配，不能遗漏
3. **均衡性**：尽量保持4个桶的关键词数量相对均衡（理想比例 20%-30%每桶）
4. **语义一致**：同一个桶内的关键词应该有相似的搜索意图
5. **高意图优先**：如果关键词同时符合多个桶的特征，高购买意图导向优先

# 输出格式（JSON）

{
  "bucketA": {
    "intent": "品牌导向",
    "intentEn": "Brand-Oriented",
    "description": "用户知道要买什么品牌",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketB": {
    "intent": "场景导向",
    "intentEn": "Scenario-Oriented",
    "description": "用户知道要解决什么问题",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketC": {
    "intent": "功能导向",
    "intentEn": "Feature-Oriented",
    "description": "用户关注技术规格/功能特性",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "bucketD": {
    "intent": "高购买意图导向",
    "intentEn": "High Purchase Intent",
    "description": "用户有明确购买意图，搜索优惠和购买信息",
    "keywords": ["keyword1", "keyword2", ...]
  },
  "statistics": {
    "totalKeywords": 90,
    "bucketACount": 30,
    "bucketBCount": 30,
    "bucketCCount": 20,
    "bucketDCount": 10,
    "balanceScore": 0.95
  }
}

# 注意事项

1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中，不能遗漏
3. balanceScore计算方式：1 - (max差异 / 总数)，越接近1越均衡
4. 高购买意图导向关键词可以与品牌词、场景词、功能词重叠，优先归入桶D',
  'Chinese',
  TRUE,
  '
v4.15 更新内容:
1. 新增桶D - 高购买意图导向，支持4桶聚类
2. 更新分桶规则和示例，添加高意图识别逻辑
3. 更新输出格式，包含bucketD和相应的统计数据
4. 整合高意图关键词到聚类流程中，避免单独生成
'
);

-- Migration completed successfully
-- Total prompts updated: 1
-- Next version: v4.16 (待规划)

-- ====================================================================
-- SOURCE: pg-migrations/091_092_093_update_prompts_v4.15.pg.sql
-- ====================================================================
-- Migration: 091_092_093_update_prompts_v4.15
-- Description: 整合三个prompt更新迁移，优化关键词提取质量，添加严格的质量要求和格式规范
-- Created: 2025-12-22
-- Version: v4.14 → v4.15
-- Prompts: 3 个 (brand_analysis_store, review_analysis, product_analysis_single)
-- Database: PostgreSQL
-- Author: Claude Code

-- ========================================
-- brand_analysis_store: v4.14 → v4.15
-- ========================================

-- 1. 将当前活跃版本设为非活跃
-- PostgreSQL使用TRUE/FALSE而不是1/0
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'brand_analysis_store' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'brand_analysis_store',
  'v4.15',
  'ai_analysis',
  '品牌店铺分析v4.15',
  '优化关键词提取质量，添加严格的质量要求和格式规范',
  'src/lib/ai.ts',
  'analyzeBrandStore',
  'You are a professional brand analyst. Analyze the BRAND STORE PAGE data and extract comprehensive brand information.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🎯 SUPPLEMENTARY DATA (v3.4) ===
**Technical Details** (product specifications if available):
{{technicalDetails}}

**Review Highlights** (key customer feedback if available):
{{reviewHighlights}}

⚠️ USE THIS DATA: If Technical Details or Review Highlights are available (not "Not available"),
incorporate them into your analysis for richer insights about product quality and customer satisfaction.

=== ANALYSIS METHODOLOGY ===

Hot Score Formula: Rating × log10(Review Count + 1)
- TOP 5 HOT-SELLING = highest scores (proven winners)
- Other best sellers = good performers

=== ANALYSIS PRIORITIES ===

1. **Hot Products Analysis** (TOP 5 by Hot Score):
   - Product names and categories
   - Price points and positioning
   - Review scores and volume
   - Why these products succeed
   - 🆕 Include insights from {{technicalDetails}} if available

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
   - 🆕 Validate with {{reviewHighlights}} if available

5. **Quality Indicators**:
   - Amazon Choice badge
   - Best Seller rankings
   - Prime eligibility
   - Active promotions
   - High review counts (500+)
   - 🆕 Customer sentiment from {{reviewHighlights}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.
Category examples: {{categoryExamples}}

=== KEYWORDS QUALITY REQUIREMENTS (CRITICAL) ===
"keywords" 字段必须严格遵循以下要求：

1. **输出格式**：
   - JSON数组格式：["关键词1", "关键词2", "关键词3"]
   - 每个关键词用双引号包围
   - 关键词之间用英文逗号分隔

2. **长度限制**：
   - 每个关键词≤5个单词
   - 禁止：超过5个单词的长描述

3. **允许的关键词类型**：
   ✅ **品牌相关词**：{{pageData.brand}}, {{pageData.brand}} official, {{pageData.brand}} store
   ✅ **产品类别词**：smart ring, fitness tracker, health monitor
   ✅ **功能词**：sleep tracking, heart rate monitoring, stress tracking
   ✅ **场景词**：workout tracking, health monitoring, wellness tracking

4. **严格禁止的关键词**：
   ❌ **购买渠道**：store, shop, amazon, ebay, near me, official
   ❌ **价格词**：price, cost, cheap, discount, sale, deal, coupon, code
   ❌ **时间词**：2025, 2024, black friday, prime day, cyber monday
   ❌ **查询词**：history, tracker, locator, review, compare, vs
   ❌ **购买行为**：buy, purchase, order, where to buy

5. **数量要求**：
   - 生成15-25个关键词
   - 确保涵盖品牌、产品类别、功能、场景等不同维度

6. **示例**（错误示例）：
   ❌ "RingConn Gen 2 Smart Ring, weltweit erstes Schlafapnoe-Monitoring, Keine App-Abonnement" (太长)
   ❌ "ringconn store amazon discount code 2025" (过度组合)
   ❌ "ringconn price history" (查询词)

7. **示例**（正确示例）：
   ✅ ["smart ring", "fitness tracker", "health monitor", "sleep tracking", "heart rate monitoring"]

=== OUTPUT FORMAT ===
Return a COMPLETE JSON object:
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
      "price": "$XX.XX",
      "rating": 4.5,
      "reviewCount": 1234,
      "hotScore": 3.87,
      "successFactors": ["Factor 1", "Factor 2"],
      "productHighlights": ["Key feature 1", "Key feature 2", "Key feature 3"]
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
}

=== IMPORTANT NOTES ===
- Ensure "keywords" field follows ALL quality requirements above
- Do NOT include any prohibited keywords
- Focus on brand identity, product categories, and use cases
- Keywords should be search-friendly and have commercial value',
  'English',
  1,
  TRUE,
  'v4.15: 优化关键词提取质量，添加长度限制、禁止模式、数量要求等严格规范'
);

-- ========================================
-- review_analysis: v4.14 → v4.15
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'review_analysis' AND is_active = TRUE;

-- 2. 插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'review_analysis',
  'v4.15',
  'ai_analysis',
  '评论分析v4.15',
  '优化关键词提取质量，添加严格的质量要求和格式规范',
  'src/lib/ai.ts',
  'analyzeReviews',
  'You are an expert e-commerce review analyst specializing in extracting actionable insights from customer reviews.

=== INPUT DATA ===
Product Name: {{productName}}
Total Reviews: {{totalReviews}}
Target Language: {{langName}}

=== REVIEWS DATA ===
{{reviewTexts}}

=== ANALYSIS REQUIREMENTS ===

1. **Sentiment Distribution** (Quantitative)
   - Calculate positive (4-5 stars), neutral (3 stars), negative (1-2 stars) percentages
   - Provide rating breakdown by star count

2. **Positive Keywords** (Top 10)
   - Extract frequently mentioned positive attributes
   - Include context for each keyword

3. **Negative Keywords** (Top 10)
   - Extract frequently mentioned complaints or issues
   - Include context for each keyword

4. **Real Use Cases** (5-8 scenarios)
   - Identify specific scenarios where customers use the product
   - Extract direct quotes or paraphrased examples

5. **Purchase Reasons** (Top 5)
   - Why customers bought this product
   - What problems they were trying to solve

6. **User Profiles** (3-5 types)
   - Categorize customer types based on their reviews
   - Describe characteristics and needs of each profile

7. **Common Pain Points** (Top 5)
   - Issues customers experienced
   - Severity level and frequency

8. **Quantitative Highlights** (CRITICAL - Extract ALL numbers from reviews)
   **This is the most important section for advertising!**

   Extract EVERY specific number, measurement, or quantifiable claim mentioned in reviews:

   **Performance Metrics:**
   - Battery life: "8 hours", "lasts all day", "3 days on single charge"
   - Suction power: "2000Pa", "powerful suction", "picks up everything"
   - Coverage area: "2000 sq ft", "whole house", "3 bedrooms"
   - Speed/Time: "cleans in 30 minutes", "charges in 2 hours"

   **Quality Indicators:**
   - Durability: "2 years", "after 6 months", "still working"
   - Accuracy: "99% accurate", "precise to 0.1mm", "within 2 inches"
   - Efficiency: "saves 50% time", "reduces effort by 80%", "3x faster"

   **Usage Statistics:**
   - Frequency: "daily use", "every week", "3 times per month"
   - Volume: "holds 10 cups", "cleans 5 rooms", "covers 1000 sq ft"
   - Comparisons: "better than X", "lasts 2x longer", "50% cheaper than Y"

   **User Satisfaction:**
   - Ratings mentioned: "4.8 stars", "highly rated", "best product I have used"
   - Recommendation rates: "99% recommend", "all my friends bought this"
   - Return rates: "no returns needed", "0% defect rate"

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.

=== KEYWORDS QUALITY REQUIREMENTS (CRITICAL) ===
"topPositiveKeywords" 和 "topNegativeKeywords" 字段必须严格遵循以下要求：

1. **输出格式**：
   - JSON数组格式，每个元素包含 keyword, frequency, context 字段
   - keyword 字段用双引号包围
   - frequency 为数字，context 为字符串描述

2. **长度限制**：
   - 每个关键词≤5个单词
   - 禁止：超过5个单词的长描述

3. **允许的关键词类型**：
   ✅ **产品特征词**：durable, lightweight, easy to use, long battery
   ✅ **质量描述词**：excellent quality, reliable, sturdy, well-made
   ✅ **功能词**：fast charging, wireless, waterproof, compact
   ✅ **性能词**：powerful, efficient, smooth, quiet operation

4. **严格禁止的关键词**：
   ❌ **购买渠道**：store, shop, amazon, ebay, near me, official
   ❌ **价格词**：price, cost, cheap, discount, sale, deal, coupon, code
   ❌ **时间词**：2025, 2024, black friday, prime day, cyber monday
   ❌ **查询词**：history, tracker, locator, review, compare, vs
   ❌ **购买行为**：buy, purchase, order, where to buy

5. **数量要求**：
   - 生成10个关键词
   - 确保涵盖不同维度和方面

6. **示例**（错误示例）：
   ❌ "RingConn Gen 2 Smart Ring, weltweit erstes Schlafapnoe-Monitoring" (太长)
   ❌ "amazon store discount code 2025" (过度组合)
   ❌ "ringconn price history" (查询词)

7. **示例**（正确示例）：
   ✅ {"keyword": "excellent quality", "frequency": 156, "context": "Customers frequently praise the build quality and materials"}

=== OUTPUT FORMAT ===
Return COMPLETE JSON:

{
  "productName": "string",
  "analysisDate": "ISO date",
  "sentimentDistribution": {
    "totalReviews": number,
    "positive": number,
    "neutral": number,
    "negative": number,
    "ratingBreakdown": {
      "5_star": number,
      "4_star": number,
      "3_star": number,
      "2_star": number,
      "1_star": number
    }
  },
  "topPositiveKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "topNegativeKeywords": [
    {
      "keyword": "string",
      "frequency": number,
      "context": "string"
    }
  ],
  "realUseCases": ["string"],
  "purchaseReasons": ["string"],
  "userProfiles": [
    {
      "profile": "string",
      "description": "string"
    }
  ],
  "commonPainPoints": ["string"],
  "quantitativeHighlights": [
    {
      "metric": "string",
      "value": "string",
      "context": "string",
      "adCopy": "string"
    }
  ],
  "competitorMentions": ["string"],
  "analyzedReviewCount": number,
  "verifiedReviewCount": number
}

IMPORTANT: Extract AT LEAST 8-12 quantitative highlights if the reviews contain numbers. Look for ANY mention of time, duration, frequency, measurements, percentages, or comparisons.',
  'English',
  1,
  TRUE,
  'v4.15: 优化关键词提取质量，添加长度限制、禁止模式、数量要求等严格规范'
);

-- ========================================
-- product_analysis_single: v4.14 → v4.15
-- ========================================

-- 1. 删除之前不完整的v4.15版本
DELETE FROM prompt_versions
WHERE prompt_id = 'product_analysis_single' AND version = 'v4.15';

-- 2. 将当前活跃的v4.14设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'product_analysis_single' AND version = 'v4.14' AND is_active = TRUE;

-- 3. 插入完整的新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'product_analysis_single',
  'v4.15',
  'ai_analysis',
  '单品产品分析v4.15',
  '优化关键词提取质量，添加严格的质量要求和格式规范',
  'src/lib/ai.ts',
  'analyzeProductPage',
  'You are a professional product analyst. Analyze the following Amazon product page data comprehensively.

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

=== KEYWORDS QUALITY REQUIREMENTS (CRITICAL) ===
"keywords" 字段必须严格遵循以下要求：

1. **输出格式**：
   - JSON数组格式：["关键词1", "关键词2", "关键词3"]
   - 每个关键词用双引号包围
   - 关键词之间用英文逗号分隔

2. **长度限制**：
   - 每个关键词≤5个单词
   - 禁止：超过5个单词的长描述

3. **允许的关键词类型**：
   ✅ **品牌相关词**：{{pageData.brand}}, {{pageData.brand}} official
   ✅ **产品类别词**：smart ring, fitness tracker, health monitor
   ✅ **功能词**：sleep tracking, heart rate monitoring, stress tracking
   ✅ **场景词**：workout tracking, health monitoring, wellness tracking

4. **严格禁止的关键词**：
   ❌ **购买渠道**：store, shop, amazon, ebay, near me, official
   ❌ **价格词**：price, cost, cheap, discount, sale, deal, coupon, code
   ❌ **时间词**：2025, 2024, black friday, prime day, cyber monday
   ❌ **查询词**：history, tracker, locator, review, compare, vs
   ❌ **购买行为**：buy, purchase, order, where to buy

5. **数量要求**：
   - 生成15-25个关键词
   - 确保涵盖品牌、产品类别、功能、场景等不同维度

6. **示例**（错误示例）：
   ❌ "RingConn Gen 2 Smart Ring, weltweit erstes Schlafapnoe-Monitoring, Keine App-Abonnement" (太长)
   ❌ "ringconn store amazon discount code 2025" (过度组合)
   ❌ "ringconn price history" (查询词)

7. **示例**（正确示例）：
   ✅ ["smart ring", "fitness tracker", "health monitor", "sleep tracking", "heart rate monitoring"]

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
  "productHighlights": ["Key spec 1 (verified by reviews)", "Key spec 2", "Key spec 3"]
}

=== IMPORTANT NOTES ===
- Ensure "keywords" field follows ALL quality requirements above
- Do NOT include any prohibited keywords
- Focus on product features, use cases, and technical specifications
- Keywords should be search-friendly and have commercial value',
  'English',
  1,
  TRUE,
  'v4.15: 优化关键词提取质量，添加长度限制、禁止模式、数量要求等严格规范（完整版本）'
);

-- ====================================================================
-- SOURCE: pg-migrations/092_sync_competition_data_to_global_keywords.pg.sql
-- ====================================================================
-- PostgreSQL Migration: 082_sync_competition_data_to_global_keywords.pg.sql
-- Purpose: 同步competition数据到global_keywords表 (PostgreSQL版本)
-- Date: 2025-12-19

-- 背景：
-- LaunchScore的竞争度评分(competitionScore)依赖于关键词的competition数据
-- 之前的implementation中，competition数据只在API调用时获取，但在缓存/数据库中丢失
-- 这导致计算出的竞争度始终为 UNKNOWN
--
-- 修复目标：
-- 1. 确保global_keywords表结构中有competition_level字段（已有）
-- 2. 为现有的关键词数据，标记为需要刷新
-- 3. 后续所有新获取的关键词都会正确保存competition数据
--
-- 注意：
-- - 此迁移仅标记数据为需要刷新（通过更新cached_at）
-- - 实际的API调用和数据更新会在应用运行时自动进行
-- - 不会阻塞应用启动

-- Step 1: 验证表存在
-- global_keywords表应该由之前的迁移创建并包含competition_level字段

-- Step 2: 清空过期的缓存数据（7天前）
-- 这样下次查询时会触发API调用来刷新competition数据
UPDATE global_keywords
SET cached_at = NOW() - INTERVAL '8 days'
WHERE created_at < NOW() - INTERVAL '7 days'
  AND (competition_level IS NULL OR competition_level = '');

-- Step 3: 对于最近7天内的数据，如果competition_level为空，也标记为需要更新
UPDATE global_keywords
SET cached_at = NOW() - INTERVAL '8 days'
WHERE (competition_level IS NULL OR competition_level = '')
  AND created_at >= NOW() - INTERVAL '7 days';

-- 完成标记
-- 应用重启后，以下流程会自动进行：
-- 1. getKeywordSearchVolumes() 检查global_keywords表
-- 2. 如果cached_at超过7天，会重新调用Google Ads API
-- 3. API返回时，competition数据会被正确保存到competition_level字段
-- 4. 后续查询会从表中读取competition_level而不是UNKNOWN

-- ====================================================================
-- SOURCE: pg-migrations/094_add_batch_cancellation.pg.sql
-- ====================================================================
-- ===================================================
-- Migration: 094_add_batch_cancellation.pg.sql
-- Description: 为batch_tasks添加取消功能支持 (PostgreSQL)
-- Created: 2025-12-23
-- ===================================================

-- 🔥 问题背景：
-- 当代理质量差导致批量任务大量失败时，无法及时终止任务
-- 用户需要等待所有任务执行完毕才能重新上传

-- 🎯 解决方案：
-- 1. 添加'cancelled'状态支持
-- 2. 记录取消时间和取消原因
-- 3. 支持用户主动取消批量任务

-- Step 1: 添加新字段到batch_tasks
ALTER TABLE batch_tasks ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE batch_tasks ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE batch_tasks ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Step 2: 更新status约束以包含'cancelled'状态
-- 删除旧约束
ALTER TABLE batch_tasks DROP CONSTRAINT IF EXISTS batch_tasks_status_check;

-- 添加新约束
ALTER TABLE batch_tasks ADD CONSTRAINT batch_tasks_status_check
  CHECK (status IN ('pending', 'running', 'completed', 'failed', 'partial', 'cancelled'));

-- Step 3: 为upload_records添加cancelled状态支持
-- 删除旧约束
ALTER TABLE upload_records DROP CONSTRAINT IF EXISTS upload_records_status_check;

-- 添加新约束
ALTER TABLE upload_records ADD CONSTRAINT upload_records_status_check
  CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'partial', 'cancelled'));

-- ✅ Migration complete!
-- 用户现在可以通过 POST /api/offers/batch/[batchId]/cancel 取消批量任务

-- ====================================================================
-- SOURCE: pg-migrations/095_create_google_ads_service_accounts.pg.sql
-- ====================================================================
-- 创建 Google Ads 服务账号表
CREATE TABLE IF NOT EXISTS google_ads_service_accounts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  mcc_customer_id TEXT NOT NULL,
  developer_token TEXT NOT NULL,
  service_account_email TEXT NOT NULL,
  private_key TEXT NOT NULL,
  project_id TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_service_accounts_user ON google_ads_service_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_service_accounts_active ON google_ads_service_accounts(user_id, is_active);

-- 修改 google_ads_accounts 表，添加认证类型字段
ALTER TABLE google_ads_accounts ADD COLUMN IF NOT EXISTS auth_type TEXT DEFAULT 'oauth';
ALTER TABLE google_ads_accounts ADD COLUMN IF NOT EXISTS service_account_id TEXT REFERENCES google_ads_service_accounts(id);

-- ====================================================================
-- SOURCE: pg-migrations/096_update_ad_creative_generation_v4.15.pg.sql
-- ====================================================================
-- Migration: 096_update_ad_creative_generation_v4.15
-- Description: 更新广告创意生成prompt v4.15，强化货币符号本地化、紧迫感生成、价格优势量化
-- Created: 2025-12-23
-- Version: v4.14 → v4.15
-- Prompts: 1个 (ad_creative_generation)
-- Database: PostgreSQL
-- Author: Claude Code
-- Safety: 防重复执行 - 使用 ON CONFLICT DO NOTHING

-- ========================================
-- ad_creative_generation: v4.14 → v4.15
-- ========================================

-- 0. 检查是否已是最新版本（防重复执行）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM prompt_versions
        WHERE prompt_id = 'ad_creative_generation'
          AND version = 'v4.15'
          AND is_active = TRUE
    ) THEN
        RAISE NOTICE 'v4.15 已是活跃版本，跳过迁移';
    ELSE
        -- 1. 将当前活跃版本设为非活跃（只有存在活跃版本时才执行）
        UPDATE prompt_versions
        SET is_active = FALSE
        WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

        -- 2. 插入新版本（使用 ON CONFLICT 防止重复插入）
        INSERT INTO prompt_versions (
          prompt_id,
          version,
          category,
          name,
          description,
          file_path,
          function_name,
          prompt_content,
          language,
          created_by,
          is_active,
          change_notes
        ) VALUES (
          'ad_creative_generation',
          'v4.15',
          '广告创意生成',
          '广告创意生成v4.15 - 货币/紧迫感/价格优化版',
          '强化货币符号本地化、紧迫感生成、价格优势量化要求',
          'src/lib/ad-creative-generator.ts',
          'buildAdCreativePrompt',
          '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

## 🆕 v4.10 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**
**✅ 关键词嵌入和主题一致性不会冲突**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 这些关键词已经是"品牌词 + 桶匹配词"的组合
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ✅ 正确: "Solar Powered Cameras" (关键词: solar camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)
- ❌ 错误: "Best Quality Product" (无关键词)

**规则3: 嵌入与主题双重验证**
- 每个嵌入的关键词必须同时满足：
  - ✅ 来自{{ai_keywords_section}}
  - ✅ 符合{{bucket_intent}}主题
- 由于关键词已预筛选，两个条件天然兼容

## 🎯 v4.10 主题一致性要求

{{bucket_info_section}}

### 主题约束规则

**桶A（品牌导向）文案风格**:
- Headlines: 突出品牌实力、官方正品、品牌优势
- Descriptions: 强调品牌价值、官方保障、品牌故事
- ✅ 示例: "Official Eufy Store | Trusted Brand Quality"

**桶B（场景导向）文案风格**:
- Headlines: 突出应用场景、解决方案、使用环境
- Descriptions: 描述使用场景、用户收益、痛点解决
- ✅ 示例: "Protect Your Home 24/7 | Eufy Smart Security"

**桶C（功能导向）文案风格**:
- Headlines: 突出核心功能、技术优势、性能参数
- Descriptions: 强调差异化功能、技术参数、用户评价
- ✅ 示例: "4K Ultra HD Night Vision | Eufy Camera"

### 主题一致性检查清单

- [ ] 100% Headlines体现{{bucket_intent}}主题
- [ ] 100% Descriptions体现{{bucket_intent}}主题
- [ ] 100% 嵌入的关键词来自{{ai_keywords_section}}（已预筛选）
- [ ] 53%+ Headlines包含关键词

## 🔥 v4.15 关键优化 (CRITICAL)

### 💰 1. 货币符号本地化 (P0 CRITICAL)

**{{localization_section}}**

**🔴 强制要求**：所有价格必须使用正确的本地货币符号！
- ✅ UK (GBP): "Save £170", "Only £499", "Was £669 Now £499"
- ✅ US (USD): "Save $170", "Only $499", "Was $669 Now $499"
- ✅ EU (EUR): "Save €170", "Only €499", "Was €669 Now €499"
- ❌ 禁止: UK市场使用"$"或"€"，必须用"£"

### ⏰ 2. 紧迫感表达 (P1 CRITICAL)

**所有广告创意必须包含紧迫感元素！**
- **至少 2-3 个 headlines 必须包含紧迫感表达**
- 紧迫感类型：
  - **即时行动**: "Order Now", "Shop Today", "Get Yours Now"
  - **时间紧迫**: "Limited Time", "Ends Soon", "Today Only", "Offer Ends Tonight"
  - **稀缺信号**: "Limited Stock", "Almost Gone", "Few Left", "Selling Fast"
  - **FOMO**: "Don''t Miss Out", "Last Chance", "Act Fast"

**✅ 正确示例**:
- "Reolink NVR Kit: Save £170 - Order Now"
- "8 Camera 4K System - Limited Time Offer"
- "Reolink Security: Don''t Miss Out - Save £170"
- "4K CCTV System - Only 5 Left in Stock"

**❌ 禁止**: "Limited Stock", "Limited Time", "Limited Offer" (这些太相似)

### 💵 3. 价格优势量化 (P0 CRITICAL)

**所有促销类 headlines 必须使用具体金额，不能只用百分比！**

**✅ GOOD (具体金额)**:
- "Save £170 Today"
- "Was £669, Now £499 - Save £170"
- "Reolink NVR Kit: Only £499 - Save £170"
- "Best Value: £499 vs £669 Elsewhere"

**❌ BAD (只有百分比)**:
- "20% Off"
- "Save 20%"
- "Discount Applied"
- "Great Deal"

**🎯 强制要求**:
- 至少 2 个 headlines 必须使用具体节省金额
- 使用价格锚点: "Was X, Now Y" 或 "Save X"
- 如果只有百分比折扣，必须估算金额: "Save 20% - £170 Off"

## v4.7 RSA Display Path (继承)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"
**⚠️ CRITICAL**: ONLY the first headline can use {KeyWord:...} format.

**🚨 v4.10 HEADLINE REQUIREMENTS**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Theme Consistency**: 100% headlines MUST match {{bucket_intent}} theme
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Diversity**: <20% text similarity, no 2+ shared words (excluding embedded keywords from {{ai_keywords_section}})
- 🔥 **Urgency**: 2-3 headlines MUST include urgency elements (see v4.15 section above)
- 🔥 **Price Quantification**: Promo headlines MUST use specific amounts, NOT just percentages (see v4.15 section above)

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element
- 🔥 **Urgency**: At least 1 description MUST include urgency element
- 🔥 **Price Clarity**: If discussing deals, use specific currency symbols and amounts

### KEYWORDS (输出{{ai_keywords_section}}中的全部关键词)
**⚠️ 直接输出{{ai_keywords_section}}中的所有关键词，不要生成新关键词**
**⚠️ 所有关键词必须使用目标语言 {{target_language}}**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool, "themeMatch":true}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool, "keywords":["keyword1"], "themeMatch":true}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "bucket_type": "{{bucket_type}}",
  "bucket_intent": "{{bucket_intent}}",
  "keyword_layer_validation": {
    "brand_keywords_used": ["brand1", "brand2"],
    "bucket_keywords_used": ["kw1", "kw2", "kw3"],
    "total_keywords_embedded": 8,
    "embedding_rate": 0.53
  },
  "theme_consistency": {
    "headline_match_rate": 1.0,
    "description_match_rate": 1.0,
    "overall_score": 1.0
  },
  "quality_metrics": {"headline_diversity_score":N, "keyword_embedding_rate":0.53, "emotional_trigger_count":N, "question_headline_count":N, "usp_front_loaded_count":N, "urgency_headline_count":2, "estimated_ad_strength":"EXCELLENT"}
}',
          'English',
          1,
          TRUE,
          'v4.15 更新内容:
1. 新增货币符号本地化要求 (P0 CRITICAL)
2. 新增紧迫感表达要求 (P1 CRITICAL)
3. 新增价格优势量化要求 (P0 CRITICAL)
4. 更新OUTPUT结构添加urgency_headline_count字段'
        )
        ON CONFLICT (prompt_id, version) DO NOTHING;

        RAISE NOTICE 'v4.15 迁移完成';
    END IF;
END $$;

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 3;

-- ====================================================================
-- SOURCE: pg-migrations/097_ad_creative_types_optimization.pg.sql
-- ====================================================================
-- ===================================================
-- Migration: 097_ad_creative_types_optimization.pg.sql
-- Description: 广告创意类型优化 - 添加generated_buckets字段和更新prompt v4.16
-- Created: 2025-12-23
-- Version: v4.15 → v4.16
-- Database: PostgreSQL
-- Author: Claude Code
-- Safety: 防重复执行 - 使用 DO $$, IF EXISTS, ON CONFLICT DO NOTHING
-- ===================================================

-- ========================================
-- Part 1: 添加 generated_buckets 字段
-- ========================================

-- 🔥 优化背景：
-- 用户点击5次生成5个广告创意，需要记录已生成的创意类型
-- 每次点击时自动选择下一个未生成的类型，避免重复

-- Step 1.1: 检查字段是否已存在（防重复执行）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offers' AND column_name = 'generated_buckets'
    ) THEN
        ALTER TABLE offers ADD COLUMN IF NOT EXISTS generated_buckets TEXT;
        RAISE NOTICE 'generated_buckets 字段已添加';
    ELSE
        RAISE NOTICE 'generated_buckets 字段已存在，跳过添加';
    END IF;
END $$;

-- 设置默认值
ALTER TABLE offers ALTER COLUMN generated_buckets SET DEFAULT '[]';

-- 更新现有记录的默认值
UPDATE offers SET generated_buckets = '[]' WHERE generated_buckets IS NULL;

-- 创建索引加速查询（防重复）
CREATE INDEX IF NOT EXISTS idx_offers_generated_buckets ON offers((generated_buckets::jsonb));

-- ========================================
-- Part 2: 更新 Prompt v4.15 → v4.16
-- ========================================

-- Step 2.0: 检查是否已是 v4.16 活跃版本（防重复执行）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM prompt_versions
        WHERE prompt_id = 'ad_creative_generation'
          AND version = 'v4.16'
          AND is_active = TRUE
    ) THEN
        RAISE NOTICE 'v4.16 已是活跃版本，跳过迁移';
    ELSE
        -- Step 2.1: 将当前活跃版本设为非活跃（只有存在活跃版本时才执行）
        UPDATE prompt_versions
        SET is_active = FALSE
        WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

        -- Step 2.2: 插入新版本 v4.16（使用 ON CONFLICT 防止重复插入）
        INSERT INTO prompt_versions (
          prompt_id,
          version,
          category,
          name,
          description,
          file_path,
          function_name,
          prompt_content,
          language,
          created_by,
          is_active,
          change_notes
        ) VALUES (
          'ad_creative_generation',
          'v4.16',
          '广告创意生成',
          '广告创意生成v4.16 - 链接类型区分 + 智能创意选择',
          '根据 page_type 区分单品/店铺，使用不同的创意策略和关键词分布；支持智能选择下一个创意类型',
          'src/lib/ad-creative-generator.ts',
          'buildAdCreativePrompt',
          '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}
{{link_type_section}}

## 🆕 v4.10 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale" (关键词: security camera)
- ❌ 错误: "Camera Camera Security" (关键词堆砌)

## 🔥 v4.15 关键优化 (CRITICAL)

### 💰 1. 货币符号本地化 (P0 CRITICAL)

**{{localization_section}}**

**🔴 强制要求**：所有价格必须使用正确的本地货币符号！
- ✅ UK (GBP): "Save £170", "Only £499"
- ✅ US (USD): "Save $170", "Only $499"
- ❌ 禁止: UK市场使用"$"或"€"，必须用"£"

### ⏰ 2. 紧迫感表达 (P1 CRITICAL)

**所有广告创意必须包含紧迫感元素！**
- **至少 2-3 个 headlines 必须包含紧迫感表达**
- 紧迫感类型：
  - 即时行动: "Order Now", "Shop Today", "Get Yours Now"
  - 时间紧迫: "Limited Time", "Ends Soon", "Today Only"
  - 稀缺信号: "Limited Stock", "Almost Gone", "Few Left"
  - FOMO: "Don''t Miss Out", "Last Chance", "Act Fast"

**✅ 正确示例**:
- "Reolink NVR Kit: Save £170 - Order Now"
- "8 Camera 4K System - Limited Time Offer"

### 💵 3. 价格优势量化 (P0 CRITICAL)

**所有促销类 headlines 必须使用具体金额，不能只用百分比！**

**✅ GOOD (具体金额)**:
- "Save £170 Today"
- "Was £669, Now £499 - Save £170"

**❌ BAD (只有百分比)**:
- "20% Off"
- "Save 20%"

## 🔗 v4.16 链接类型策略 (CRITICAL)

**{{link_type_section}}**

### 单品链接 (Product Page) 策略

**当前链接类型**: 产品页面 (Product Page)
**目标**: 最大化转化，让用户购买这个具体产品

**桶类型与关键词分布**:
| 桶 | 类型 | 品牌词 | 产品型号词 | 功能词 | 价格词 |
|----|------|:-----:|:---------:|:-----:|:-----:|
| A | Product-Specific | 30% | **50%** | 20% | 0% |
| B | Purchase-Intent | 20% | 30% | 10% | **40%** |
| C | Feature-Focused | 20% | 20% | **60%** | 0% |
| D | Urgency-Promo | 20% | 20% | 20% | 20% |
| S | Comprehensive | 40% | 30% | 30% | 0% |

**核心要求**:
- 标题必须与具体产品相关联
- 至少 2 个标题包含具体产品型号或参数
- 至少 2 个描述包含具体价格或折扣信息

### 店铺链接 (Store Page) 策略

**当前链接类型**: 店铺页面 (Store Page)
**目标**: 最大化进店，扩大品牌认知

**桶类型与关键词分布**:
| 桶 | 类型 | 品牌词 | 场景词 | 品类词 | 信任词 |
|----|------|:-----:|:-----:|:-----:|:-----:|
| A | Brand-Trust | **80%** | 10% | 10% | 0% |
| B | Scene-Solution | 20% | **60%** | 20% | 0% |
| C | Collection-Highlight | 40% | 20% | **30%** | 10% |
| D | Trust-Signals | 30% | 10% | 20% | **40%** |
| S | Store-Overview | **50%** | 30% | 20% | 0% |

## 🎯 v4.10 主题一致性要求

{{bucket_info_section}}

### 主题约束规则

**桶A（品牌导向）文案风格**:
- Headlines: 突出品牌实力、官方正品、品牌优势
- Descriptions: 强调品牌价值、官方保障、品牌故事

**桶B（场景导向）文案风格**:
- Headlines: 突出应用场景、解决方案、使用环境
- Descriptions: 描述使用场景、用户收益、痛点解决

**桶C（功能导向）文案风格**:
- Headlines: 突出核心功能、技术优势、性能参数
- Descriptions: 强调差异化功能、技术参数、用户评价

## v4.7 RSA Display Path (继承)

**path1 (必填，最多15字符)**: 核心产品类别或品牌关键词
**path2 (可选，最多15字符)**: 产品特性、型号或促销信息

## REQUIREMENTS (Target: EXCELLENT Ad Strength)

### HEADLINES (15 required, ≤30 chars each)
**FIRST HEADLINE (MANDATORY)**: "{KeyWord:{{brand}}} Official" - If exceeds 30 chars, use "{KeyWord:{{brand}}}"

**🚨 v4.10 HEADLINE REQUIREMENTS**:
- 🔥 **Keyword Embedding**: 8/15 (53%+) headlines MUST contain keywords from {{ai_keywords_section}}
- 🔥 **Theme Consistency**: 100% headlines MUST match {{bucket_intent}} theme
- 🔥 **Emotional Triggers**: 3+ headlines with emotional power words
- 🔥 **Question Headlines**: 1-2 question-style headlines
- 🔥 **Number Usage**: 5+ headlines with specific numbers
- 🔥 **Urgency**: 2-3 headlines MUST include urgency elements
- 🔥 **Price Quantification**: Promo headlines MUST use specific amounts

### DESCRIPTIONS (4 required, ≤90 chars each)

**🎯 v4.10 DESCRIPTION REQUIREMENTS**:
- 🔥 **Theme Consistency**: 100% descriptions MUST match {{bucket_intent}} theme
- 🔥 **Keyword Integration**: Include 1-2 keywords from {{ai_keywords_section}} per description
- 🔥 **USP Front-Loading**: Strongest USP in first 30 characters
- 🔥 **Social Proof**: 2/4 descriptions must include proof element
- 🔥 **Urgency**: At least 1 description MUST include urgency element
- 🔥 **Price Clarity**: If discussing deals, use specific currency symbols and amounts

### KEYWORDS (输出{{ai_keywords_section}}中的全部关键词)
**⚠️ 直接输出{{ai_keywords_section}}中的所有关键词，不要生成新关键词**
**⚠️ 所有关键词必须使用目标语言 {{target_language}}**

{{exclude_keywords_section}}

### CALLOUTS (4-6, ≤25 chars)
{{callout_guidance}}

### SITELINKS (6): text≤25, desc≤35, url="/"

## FORBIDDEN CONTENT:
**❌ Prohibited Words**: "100%", "best", "guarantee", "miracle", ALL CA abuse
**❌ Prohibited Symbols**: ★ ☆ ⭐ 🌟 ✨ © ® ™ • ● ◆ ▪ → ← ↑ ↓ ✓ ✔ ✗ ✘ ❤ ♥ ⚡ 🔥 💎 👍 👎
**❌ Excessive Punctuation**: "!!!", "???", "..."

## OUTPUT (JSON only, no markdown):
{
  "headlines": [{"text":"...", "type":"brand|feature|promo|cta|urgency|social_proof|question|emotional", "length":N, "keywords":["keyword1"], "hasNumber":bool, "hasUrgency":bool, "hasEmotionalTrigger":bool, "isQuestion":bool, "themeMatch":true}...],
  "descriptions": [{"text":"...", "type":"feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length":N, "hasCTA":bool, "first30Chars":"...", "hasSocialProof":bool, "keywords":["keyword1"], "themeMatch":true}...],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text":"...", "url":"/", "description":"..."}],
  "path1": "...",
  "path2": "...",
  "theme": "...",
  "bucket_type": "{{bucket_type}}",
  "bucket_intent": "{{bucket_intent}}",
  "quality_metrics": {"urgency_headline_count":2, "estimated_ad_strength":"EXCELLENT"}
}',
          'English',
          1,
          TRUE,
          'v4.16 更新内容:
1. 新增链接类型策略（单品 vs 店铺）
2. 新增智能创意选择机制
3. 优化关键词来源优先级
4. 强化主题一致性要求
5. 保留v4.15的货币符号、紧迫感、价格量化优化'
        )
        ON CONFLICT (prompt_id, version) DO NOTHING;

        RAISE NOTICE 'v4.16 迁移完成';
    END IF;
END $$;

-- ========================================
-- Part 3: 验证迁移结果
-- ========================================

-- 验证字段添加成功
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'offers' AND column_name = 'generated_buckets';

-- 验证 prompt 版本
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 3;

-- ✅ Migration complete!
-- 新功能：
-- 1. offers.generated_buckets 字段用于记录已生成的创意类型
-- 2. ad_creative_generation prompt 更新到 v4.16
-- 3. 支持链接类型区分和智能创意选择
-- 4. 防重复执行 - 多次运行安全

-- ====================================================================
-- SOURCE: pg-migrations/098_add_store_keyword_buckets.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 098_add_store_keyword_buckets.pg.sql
-- Description: 为店铺链接添加关键词分桶字段，支持5种店铺创意类型
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- ============================================================
-- PART 1: 添加店铺关键词分桶字段
-- ============================================================

-- 店铺链接的5种创意类型对应不同的关键词策略：
-- A (Brand-Trust): 品牌信任导向 - 80%品牌词 + 10%场景词 + 10%品类词
-- B (Scene-Solution): 场景解决导向 - 20%品牌词 + 60%场景词 + 20%品类词
-- C (Collection-Highlight): 精选推荐导向 - 40%品牌词 + 20%场景词 + 30%品类词 + 10%信任词
-- D (Trust-Signals): 信任信号导向 - 30%品牌词 + 10%场景词 + 20%品类词 + 40%信任词
-- S (Store-Overview): 店铺全景导向 - 50%品牌词 + 30%场景词 + 20%品类词

-- Step 1.1: 检查字段是否已存在（防重复执行）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offer_keyword_pools' AND column_name = 'store_bucket_a_keywords'
    ) THEN
        -- 添加店铺分桶关键词字段
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_a_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_b_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_c_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_d_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_s_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;

        -- 添加店铺分桶意图描述
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_a_intent TEXT DEFAULT '品牌商品集合';
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_b_intent TEXT DEFAULT '商品需求场景';
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_c_intent TEXT DEFAULT '热门商品线';
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_d_intent TEXT DEFAULT '信任服务信号';
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS store_bucket_s_intent TEXT DEFAULT '店铺全量覆盖';

        -- 添加店铺链接类型标识
        ALTER TABLE offer_keyword_pools ADD COLUMN IF NOT EXISTS link_type TEXT DEFAULT 'product';

        RAISE NOTICE '店铺关键词分桶字段已添加';
    ELSE
        RAISE NOTICE '店铺关键词分桶字段已存在，跳过添加';
    END IF;
END $$;

-- Step 1.2: 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_offer_keyword_pools_link_type ON offer_keyword_pools(link_type);

-- ============================================================
-- PART 2: 验证迁移结果
-- ============================================================

-- 验证字段添加成功
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'offer_keyword_pools' AND column_name LIKE 'store_%'
ORDER BY column_name;

-- 查看结构
SELECT id, offer_id, link_type,
       jsonb_array_length(store_bucket_a_keywords) > 0 as has_store_a,
       jsonb_array_length(store_bucket_b_keywords) > 0 as has_store_b,
       jsonb_array_length(store_bucket_c_keywords) > 0 as has_store_c,
       jsonb_array_length(store_bucket_d_keywords) > 0 as has_store_d,
       jsonb_array_length(store_bucket_s_keywords) > 0 as has_store_s
FROM offer_keyword_pools
LIMIT 5;

-- ✅ Migration complete!
-- 新增字段：
-- 1. store_bucket_a_keywords ~ store_bucket_s_keywords: 店铺5种创意类型的关键词
-- 2. store_bucket_a_intent ~ store_bucket_s_intent: 店铺5种创意类型的意图描述
-- 3. link_type: 标识关键词池适用的链接类型（product/store）
-- 4. idx_offer_keyword_pools_link_type: 链接类型索引

-- ====================================================================
-- SOURCE: pg-migrations/099_keyword_clustering_v4.16.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 099_keyword_clustering_v4.16.pg.sql
-- Description: 关键词聚类Prompt v4.16 - 支持店铺链接类型区分
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- ============================================================
-- keyword_intent_clustering: v4.15 → v4.16
-- ============================================================

-- Step 1: 检查是否已是 v4.16 活跃版本（防重复执行）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM prompt_versions
        WHERE prompt_id = 'keyword_intent_clustering'
          AND version = 'v4.16'
          AND is_active = TRUE
    ) THEN
        RAISE NOTICE 'v4.16 已是活跃版本，跳过迁移';
    ELSE
        -- Step 2: 将当前活跃版本设为非活跃
        UPDATE prompt_versions
        SET is_active = FALSE
        WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

        -- Step 3: 插入新版本 v4.16
        INSERT INTO prompt_versions (
          prompt_id,
          version,
          category,
          name,
          description,
          file_path,
          function_name,
          prompt_content,
          language,
          created_by,
          is_active,
          change_notes
        ) VALUES (
          'keyword_intent_clustering',
          'v4.16',
          '关键词聚类',
          '关键词意图聚类v4.16 - 支持店铺链接类型区分',
          '根据链接类型（单品/店铺）使用不同的分桶策略，支持5种店铺创意类型',
          'src/lib/offer-keyword-pool.ts',
          'clusterKeywordsByIntent',
          '你是一个专业的Google Ads关键词分析专家。根据链接类型将关键词按用户搜索意图分成语义桶。

# 链接类型
链接类型：{{linkType}}
{{^linkType}}product{{/linkType}}
- product (单品链接): 目标是让用户购买具体产品
- store (店铺链接): 目标是让用户进入店铺

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

{{^linkType}}
# ========================================
# 单品链接分桶策略 (Product Page)
# ========================================
## 桶A - 产品型号导向 (Product-Specific)
**用户画像**：搜索具体产品型号、配置
**关键词特征**：
- 型号词：model xxx, pro, plus, max, ultra
- 产品词：camera, doorbell, vacuum, speaker
- 配置词：2k, 4k, 1080p, wireless, solar

**示例**：
- eufy security camera
- eufy doorbell 2k
- eufycam 2 pro
- eufy solar panel

## 桶B - 购买意图导向 (Purchase-Intent)
**用户画像**：有购买意向，搜索价格/优惠
**关键词特征**：
- 价格词：price, cost, cheap, affordable, deal, discount
- 购买词：buy, purchase, shop, order
- 促销词：sale, clearance, promotion, bundle

**示例**：
- buy security camera
- security camera deal
- eufy camera price
- discount doorbell

## 桶C - 功能特性导向 (Feature-Focused)
**用户画像**：关注技术规格、功能特性
**关键词特征**：
- 功能词：night vision, motion detection, two-way audio
- 规格词：4k, 2k, 1080p, wireless, battery
- 性能词：long battery, solar powered, waterproof

**示例**：
- wireless security camera
- night vision doorbell
- solar powered camera
- 4k security system

## 桶D - 紧迫促销导向 (Urgency-Promo)
**用户画像**：追求即时购买、最佳优惠
**关键词特征**：
- 紧迫感词：limited, today, now, urgent, ends soon
- 限时词：flash sale, today only, limited time
- 库存词：in stock, available, few left

**示例**：
- security camera today
- doorbell camera sale
- limited time offer
- eufy camera in stock

{{/linkType}}
{{#linkType}}
{{#equals linkType "store"}}
# ========================================
# 店铺链接分桶策略 (Store Page)
# ========================================

## 桶A - 品牌信任导向 (Brand-Trust)
**用户画像**：认可品牌，寻求官方购买渠道
**关键词特征**：
- 品牌官方词：brand official, brand store, brand website
- 授权词：authorized, certified, genuine
- 正品保障词：authentic, original, real

**示例**：
- eufy official store
- eufy authorized dealer
- buy eufy authentic
- eufy official website

## 桶B - 场景解决方案导向 (Scene-Solution)
**用户画像**：有具体使用场景需求
**关键词特征**：
- 场景词：home security, baby monitor, pet watching
- 环境词：indoor, outdoor, garage, backyard
- 解决方案词：protect home, monitor baby, watch pets

**示例**：
- home security system
- baby monitor camera
- pet watching camera
- outdoor security

## 桶C - 精选推荐导向 (Collection-Highlight)
**用户画像**：想了解店铺热销/推荐产品
**关键词特征**：
- 热销词：best seller, top rated, popular
- 推荐词：recommended, featured, choice
- 系列词：indoor camera series, outdoor kit

**示例**：
- eufy best seller
- top rated security camera
- eufy outdoor camera kit
- featured products

## 桶D - 信任信号导向 (Trust-Signals)
**用户画像**：关注店铺信誉、售后保障
**关键词特征**：
- 评价词：review, rating, testimonial
- 保障词：warranty, guarantee, replacement
- 服务词：support, service, installation

**示例**：
- eufy camera review
- security camera warranty
- eufy customer support
- installation service

## 桶S - 店铺全景导向 (Store-Overview)
**用户画像**：想全面了解店铺
**关键词特征**：
- 店铺概览词：all products, full range, complete collection
- 分类词：camera, doorbell, sensor, accessory
- 综合词：eufy store, eufy products, eufy catalog

**示例**：
- eufy store
- eufy all products
- eufy security camera
- eufy product catalog
{{/equals}}
{{/linkType}}
{{/linkType}}

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶
2. **完整性**：所有关键词都必须分配
3. **均衡性**：保持各桶关键词数量相对均衡
4. **高意图优先**：如果关键词符合多个桶，优先归入高意图桶

{{^linkType}}
# 输出格式（单品链接 - 4桶）
{
  "bucketA": { "intent": "产品型号导向", "intentEn": "Product-Specific", "keywords": [...] },
  "bucketB": { "intent": "购买意图导向", "intentEn": "Purchase-Intent", "keywords": [...] },
  "bucketC": { "intent": "功能特性导向", "intentEn": "Feature-Focused", "keywords": [...] },
  "bucketD": { "intent": "紧迫促销导向", "intentEn": "Urgency-Promo", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "balanceScore": 0.95 }
}
{{/linkType}}
{{#linkType}}
{{#equals linkType "store"}}
# 输出格式（店铺链接 - 5桶）
{
  "bucketA": { "intent": "品牌信任导向", "intentEn": "Brand-Trust", "keywords": [...] },
  "bucketB": { "intent": "场景解决方案导向", "intentEn": "Scene-Solution", "keywords": [...] },
  "bucketC": { "intent": "精选推荐导向", "intentEn": "Collection-Highlight", "keywords": [...] },
  "bucketD": { "intent": "信任信号导向", "intentEn": "Trust-Signals", "keywords": [...] },
  "bucketS": { "intent": "店铺全景导向", "intentEn": "Store-Overview", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "bucketSCount": N, "balanceScore": 0.95 }
}
{{/equals}}
{{/linkType}}

注意事项：
1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中
3. balanceScore = 1 - (max差异 / 总数)',
          'Chinese',
          1,
          TRUE,
          'v4.16 更新内容:
1. 支持链接类型参数 (linkType: product/store)
2. 单品链接: 4桶策略 (A产品/B购买/C功能/D紧迫)
3. 店铺链接: 5桶策略 (A品牌/B场景/C精选/D信任/S全景)
4. 优化各桶的关键词特征和示例'
        )
        ON CONFLICT (prompt_id, version) DO NOTHING;

        RAISE NOTICE 'v4.16 迁移完成';
    END IF;
END $$;

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering'
ORDER BY version DESC
LIMIT 3;

-- ====================================================================
-- SOURCE: pg-migrations/100_keyword_clustering_v4.17.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 100_keyword_clustering_v4.17.pg.sql
-- Description: 关键词聚类Prompt v4.17 - 修复店铺链接聚类不均衡问题
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- ============================================================
-- keyword_intent_clustering: v4.16 → v4.17
-- ============================================================

-- Step 1: 检查是否已是 v4.17 活跃版本（防重复执行）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM prompt_versions
        WHERE prompt_id = 'keyword_intent_clustering'
          AND version = 'v4.17'
          AND is_active = TRUE
    ) THEN
        RAISE NOTICE 'v4.17 已是活跃版本，跳过迁移';
    ELSE
        -- Step 2: 将当前活跃版本设为非活跃
        UPDATE prompt_versions
        SET is_active = FALSE
        WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

        -- Step 3: 插入新版本 v4.17
        INSERT INTO prompt_versions (
          prompt_id,
          version,
          category,
          name,
          description,
          file_path,
          function_name,
          prompt_content,
          language,
          created_by,
          is_active,
          change_notes
        ) VALUES (
          'keyword_intent_clustering',
          'v4.17',
          '关键词聚类',
          '关键词意图聚类v4.17 - 修复店铺链接聚类不均衡',
          '修复v4.16店铺链接聚类不均衡问题，明确各桶边界，添加强制均衡分配规则',
          'src/lib/offer-keyword-pool.ts',
          'clusterKeywordsByIntent',
          '你是一个专业的Google Ads关键词分析专家。根据链接类型将关键词按用户搜索意图分成语义桶。

# 链接类型
链接类型：{{linkType}}
{{^linkType}}product{{/linkType}}
- product (单品链接): 目标是让用户购买具体产品
- store (店铺链接): 目标是让用户进入店铺

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

{{^linkType}}
# ========================================
# 单品链接分桶策略 (Product Page)
# ========================================
## 桶A - 产品型号导向 (Product-Specific)
**用户画像**：搜索具体产品型号、配置
**关键词特征**：
- 型号词：model xxx, pro, plus, max, ultra
- 产品词：camera, doorbell, vacuum, speaker
- 配置词：2k, 4k, 1080p, wireless, solar

**示例**：
- eufy security camera
- eufy doorbell 2k
- eufycam 2 pro
- eufy solar panel

## 桶B - 购买意图导向 (Purchase-Intent)
**用户画像**：有购买意向，搜索价格/优惠
**关键词特征**：
- 价格词：price, cost, cheap, affordable, deal, discount
- 购买词：buy, purchase, shop, order
- 促销词：sale, clearance, promotion, bundle

**示例**：
- buy security camera
- security camera deal
- eufy camera price
- discount doorbell

## 桶C - 功能特性导向 (Feature-Focused)
**用户画像**：关注技术规格、功能特性
**关键词特征**：
- 功能词：night vision, motion detection, two-way audio
- 规格词：4k, 2k, 1080p, wireless, battery
- 性能词：long battery, solar powered, waterproof

**示例**：
- wireless security camera
- night vision doorbell
- solar powered camera
- 4k security system

## 桶D - 紧迫促销导向 (Urgency-Promo)
**用户画像**：追求即时购买、最佳优惠
**关键词特征**：
- 紧迫感词：limited, today, now, urgent, ends soon
- 限时词：flash sale, today only, limited time
- 库存词：in stock, available, few left

**示例**：
- security camera today
- doorbell camera sale
- limited time offer
- eufy camera in stock

{{/linkType}}
{{#linkType}}
{{#equals linkType "store"}}
# ========================================
# 店铺链接分桶策略 (Store Page) - v4.17 修复版
# ========================================

## 🔥 v4.17 核心原则：均衡分配

**重要**：确保5个桶都有合理分布！如果某些桶没有完美匹配的关键词，请按以下规则分配：

### 桶A - 品牌信任导向 (Brand-Trust)
**用户画像**：认可品牌，寻求官方购买渠道
**关键词特征**：
- 官方词：official, store, website, shop
- 授权词：authorized, certified, genuine
- 正品保障：authentic, original, real
- 购买导向：buy, purchase, get

**示例**：
- roborock official store
- roborock buy
- eufy authorized dealer
- buy eufy authentic

### 桶B - 场景解决方案导向 (Scene-Solution)
**用户画像**：有具体使用场景需求
**关键词特征**：
- 场景词：home, house, floor, carpet, pet, baby, kitchen
- 环境词：indoor, outdoor, garage, backyard, living room
- 任务词：clean, mop, vacuum, sweep, wash

**示例**：
- home cleaning robot
- pet hair vacuum
- floor cleaning mop
- indoor robot vacuum

### 桶C - 精选推荐导向 (Collection-Highlight)
**用户画像**：想了解店铺热销/推荐产品
**关键词特征**：
- 热销词：best, top, popular, seller, rating
- 推荐词：recommended, featured, choice, new
- 高端词：pro, ultra, max, premium

**示例**：
- roborock best seller
- top rated robot vacuum
- roborock ultra
- new robot vacuum

### 桶D - 信任信号导向 (Trust-Signals)
**用户画像**：关注店铺信誉、售后保障
**关键词特征**：
- 评价词：review, rating, testimonial, feedback
- 保障词：warranty, guarantee, replacement, return
- 服务词：support, service, installation, help

**示例**：
- roborock review
- robot vacuum warranty
- vacuum cleaner support

### 桶S - 店铺全景导向 (Store-Overview)
**用户画像**：想全面了解店铺
**关键词特征**：
- 店铺概览：all products, full range, complete, entire
- 产品类别：vacuum, mop, robot, cleaner
- 品牌+产品：brand + product type（不含特定型号）

**示例**：
- roborock vacuum
- robot mop
- roborock robot cleaner
- roborock all products

{{/equals}}
{{/linkType}}
{{/linkType}}

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶
2. **完整性**：所有关键词都必须分配
3. **🔥 均衡性（v4.17核心）**：
   - 确保5个桶都有关键词分布
   - 如果某个桶没有完美匹配，扩展关键词特征定义
   - 目标是每个桶至少有 15-25% 的关键词
   - 宁可让关键词"勉强"符合某个桶，也不要让某个桶为空
4. **高意图优先**：如果关键词符合多个桶，优先归入高意图桶

# 输出格式（店铺链接 - 5桶）
{
  "bucketA": { "intent": "品牌信任导向", "intentEn": "Brand-Trust", "keywords": [...] },
  "bucketB": { "intent": "场景解决方案导向", "intentEn": "Scene-Solution", "keywords": [...] },
  "bucketC": { "intent": "精选推荐导向", "intentEn": "Collection-Highlight", "keywords": [...] },
  "bucketD": { "intent": "信任信号导向", "intentEn": "Trust-Signals", "keywords": [...] },
  "bucketS": { "intent": "店铺全景导向", "intentEn": "Store-Overview", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "bucketSCount": N, "balanceScore": 0.95 }
}

注意事项：
1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中
3. balanceScore = 1 - (max差异 / 总数)
4. 🔥 确保没有桶为空！即使关键词不完全符合某个桶的定义，也要分配一些',
          'Chinese',
          1,
          TRUE,
          'v4.17 更新内容:
1. 修复v4.16聚类不均衡问题（A/B/D桶常为空）
2. 明确各桶的关键词特征，避免模糊边界
3. 添加"强制均衡分配"规则
4. 扩展产品型号词的匹配规则（如 ultra→C桶精选推荐）
5. 确保即使关键词不完美匹配，每个桶也要有数据'
        )
        ON CONFLICT (prompt_id, version) DO NOTHING;

        RAISE NOTICE 'v4.17 迁移完成';
    END IF;
END $$;

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering'
ORDER BY version DESC
LIMIT 3;

-- ====================================================================
-- SOURCE: pg-migrations/101_ad_creative_generation_v4.17_final.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 101_ad_creative_generation_v4.17_final
-- Description: 广告创意生成Prompt v4.17最终版 - 支持店铺链接类型区分 + JSON输出修复
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- ========================================
-- ad_creative_generation: v4.8 → v4.17
-- ========================================

-- 0. 检查是否已是 v4.17 活跃版本（防重复执行）
-- PostgreSQL 使用 ON CONFLICT DO NOTHING 实现幂等性插入
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.17',
  '广告创意生成',
  '广告创意生成v4.17 - 支持店铺链接类型区分 + JSON输出修复',
  '支持链接类型区分，优化JSON输出格式，确保AI返回结构化JSON而非自由文本',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. If you cannot generate valid JSON, return an error message starting with "ERROR:".',
  'English',
  1,
  FALSE,
  'v4.17 最终版:
1. 支持链接类型参数 (product/store)
2. 店铺链接: 5种创意类型 (A品牌/B场景/C精选/D信任/S全景)
3. 直接内嵌JSON输出格式要求，移除 {{output_format_section}} 变量
4. 添加 CRITICAL REQUIREMENTS 强调必须返回JSON'
)
ON CONFLICT (prompt_id, version) DO NOTHING;

-- 1. 将当前活跃版本设为非活跃
-- PostgreSQL: is_active 是 BOOLEAN 类型，使用 FALSE
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2. 将 v4.17 设为活跃版本
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.17';

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 5;

-- ✅ Migration complete!

-- ========================================
-- SQLite vs PostgreSQL 迁移差异说明
-- ========================================
--
-- 1. INSERT 幂等性:
--    SQLite: INSERT OR IGNORE INTO ...
--    PostgreSQL: INSERT INTO ... ON CONFLICT (prompt_id, version) DO NOTHING
--
-- 2. BOOLEAN 值:
--    SQLite: is_active = 1 / is_active = 0
--    PostgreSQL: is_active = TRUE / is_active = FALSE
--
-- 3. 日期时间函数:
--    SQLite: datetime(''now'', '-24 hours')
--    PostgreSQL: CURRENT_TIMESTAMP - INTERVAL '24 hours'
--
-- 4. 字符串拼接:
--    SQLite: CONCAT(a, b) 或 a || b
--    PostgreSQL: a || b 或 CONCAT(a, b)
--
-- 5. 条件表达式:
--    SQLite: CASE WHEN ... THEN ... END
--    PostgreSQL: CASE WHEN ... THEN ... END (相同)
--

-- ====================================================================
-- SOURCE: pg-migrations/102_fix_generated_buckets_inconsistency.pg.sql
-- ====================================================================
-- Migration: 修复 generated_buckets 字段不一致问题 (PostgreSQL)
-- Date: 2025-12-24
-- Description: 将 ad_creatives.keyword_bucket 聚合到 offers.generated_buckets 字段

-- 问题背景:
-- 1. v4.16 新增了 generated_buckets 字段用于跟踪已生成的创意类型
-- 2. 在该功能添加前生成的创意，数据库字段没有被更新
-- 3. 导致前端"创意类型进度"显示不正确

-- 解决方案:
-- 从 ad_creatives 表实时聚合 keyword_bucket，更新到 offers 表

-- 批量修复所有不一致的 offer
WITH bucket_aggregation AS (
  SELECT
    offer_id,
    json_agg(DISTINCT keyword_bucket ORDER BY keyword_bucket) as actual_buckets
  FROM ad_creatives
  WHERE keyword_bucket IS NOT NULL
  GROUP BY offer_id
)
UPDATE offers o
SET generated_buckets = ba.actual_buckets::text
FROM bucket_aggregation ba
WHERE o.id = ba.offer_id
  AND (o.generated_buckets IS NULL OR o.generated_buckets = '[]');

-- 验证修复结果
SELECT
  COUNT(*) as fixed_count
FROM offers o
INNER JOIN (
  SELECT
    offer_id,
    COUNT(DISTINCT keyword_bucket) as bucket_count
  FROM ad_creatives
  WHERE keyword_bucket IS NOT NULL
  GROUP BY offer_id
  HAVING COUNT(DISTINCT keyword_bucket) > 0
) ac ON o.id = ac.offer_id
WHERE o.generated_buckets IS NOT NULL
  AND o.generated_buckets != '[]';

-- ====================================================================
-- SOURCE: pg-migrations/103_keyword_clustering_v4.18_enhanced.pg.sql
-- ====================================================================
-- 关键词意图聚类 v4.18 - 增强店铺链接分桶精准度
-- 修复问题：
-- 1. 添加明确的排除规则，避免关键词被错误分配
-- 2. 强化桶之间的边界定义
-- 3. 添加优先级规则处理多义关键词

-- 停用旧版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keyword_intent_clustering';

-- 幂等性：避免重复执行时 v4.18 已存在导致唯一约束失败
DELETE FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.18';

-- 插入新版本 v4.18
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  is_active,
  created_at
) VALUES (
  'keyword_intent_clustering',
  'v4.18',
  '关键词聚类',
  '关键词意图聚类v4.18 - 增强店铺链接分桶精准度',
  '修复店铺链接分桶精准度，添加排除规则避免错误分配',
  'keyword_intent_clustering.txt',
  'clusterKeywordsByIntent',
  '你是一个专业的Google Ads关键词分析专家。根据链接类型将关键词按用户搜索意图分成语义桶。

# 链接类型
链接类型：{{linkType}}
{{^linkType}}product{{/linkType}}
- product (单品链接): 目标是让用户购买具体产品
- store (店铺链接): 目标是让用户进入店铺

# 品牌信息
品牌名称：{{brandName}}
产品类别：{{productCategory}}

# 待分类关键词（已排除纯品牌词）
{{keywords}}

{{^linkType}}
# ========================================
# 单品链接分桶策略 (Product Page)
# ========================================
## 桶A - 产品型号导向 (Product-Specific)
**用户画像**：搜索具体产品型号、配置
**关键词特征**：
- 型号词：model xxx, pro, plus, max, ultra
- 产品词：camera, doorbell, vacuum, speaker
- 配置词：2k, 4k, 1080p, wireless, solar

**示例**：
- eufy security camera
- eufy doorbell 2k
- eufycam 2 pro
- eufy solar panel

## 桶B - 购买意图导向 (Purchase-Intent)
**用户画像**：有购买意向，搜索价格/优惠
**关键词特征**：
- 价格词：price, cost, cheap, affordable, deal, discount
- 购买词：buy, purchase, shop, order
- 促销词：sale, clearance, promotion, bundle

**示例**：
- buy security camera
- security camera deal
- eufy camera price
- discount doorbell

## 桶C - 功能特性导向 (Feature-Focused)
**用户画像**：关注技术规格、功能特性
**关键词特征**：
- 功能词：night vision, motion detection, two-way audio
- 规格词：4k, 2k, 1080p, wireless, battery
- 性能词：long battery, solar powered, waterproof

**示例**：
- wireless security camera
- night vision doorbell
- solar powered camera
- 4k security system

## 桶D - 紧迫促销导向 (Urgency-Promo)
**用户画像**：追求即时购买、最佳优惠
**关键词特征**：
- 紧迫感词：limited, today, now, urgent, ends soon
- 限时词：flash sale, today only, limited time
- 库存词：in stock, available, few left

**示例**：
- security camera today
- doorbell camera sale
- limited time offer
- eufy camera in stock

{{/linkType}}
{{#linkType}}
{{#equals linkType "store"}}
# ========================================
# 店铺链接分桶策略 (Store Page) - v4.18 增强版
# ========================================

## 🔥 v4.18 核心原则：精准分配 + 明确排除

**重要原则**：
1. **明确边界**：每个桶都有清晰的包含规则和排除规则
2. **优先级排序**：当关键词符合多个桶时，按优先级分配
3. **均衡分布**：确保5个桶都有关键词，但不强制"勉强符合"

---

### 桶A - 品牌信任导向 (Brand-Trust) 【优先级：2】

**用户画像**：认可品牌，寻求官方购买渠道、正品保障
**包含规则**：
- 官方词：official, store, website, shop（当单独出现时）
- 授权词：authorized, certified, genuine, authentic
- 正品保障：original, real, warranty, guarantee（当强调品牌信任时）
- 纯购买导向：buy, purchase, get, order（不含促销/价格词时）

**❌ 排除规则（关键）**：
- 不包含促销词：discount, sale, deal, coupon, promo, code, offer, clearance
- 不包含价格词：price, cost, cheap, affordable, budget
- 不包含具体型号：s8, q7, s7, q5, max, ultra, pro（单独型号）
- 不包含地理位置：locations, near me, delivery, shipping, local

**优先级规则**：
- "roborock official store" → 桶A ✅（官方+店铺）
- "roborock store discount" → 桶S ❌（店铺+促销，促销优先）
- "roborock buy" → 桶A ✅（纯购买意图）
- "buy roborock s8" → 桶C ❌（含型号，型号优先）

**示例**（符合桶A）：
- roborock official store
- roborock authorized dealer
- buy roborock authentic
- roborock genuine products

**反例**（不应归入桶A）：
- roborock store discount code ❌ → 应归入桶S（含促销词）
- roborock store locations ❌ → 应归入桶B或桶S（地理位置）
- roborock s8 buy ❌ → 应归入桶C（含具体型号）

---

### 桶B - 场景解决方案导向 (Scene-Solution) 【优先级：3】

**用户画像**：有具体使用场景需求、想了解产品适用性
**包含规则**：
- 场景词：home, house, apartment, kitchen, living room, bedroom
- 环境词：indoor, outdoor, garage, backyard, patio
- 任务词：clean, mop, vacuum, sweep, wash
- 目标对象：floor, carpet, tile, hardwood, pet hair, baby

**❌ 排除规则（关键）**：
- 不包含具体型号：s8, q7, max, ultra, pro（除非与场景词强关联）
- 不包含地理位置：locations, near, delivery, store finder
- 不包含促销/价格：discount, sale, price, deal
- 不包含单纯产品类别：robot vacuum（不含使用场景）

**识别技巧**：
- 看关键词是否回答 "在哪里用？" "用来做什么？"
- "roborock for home" ✅（场景明确）
- "roborock s8" ❌（只有型号，无场景）
- "roborock pet hair" ✅（目标对象明确）

**示例**（符合桶B）：
- roborock home cleaning
- robot vacuum for pet hair
- roborock floor cleaner
- vacuum for hardwood floors

**反例**（不应归入桶B）：
- roborock store locations ❌ → 应归入桶S（地理位置，非使用场景）
- roborock s8 pro ❌ → 应归入桶C（具体型号）
- roborock vacuum ❌ → 应归入桶S（通用品类词）

---

### 桶C - 精选推荐导向 (Collection-Highlight) 【优先级：1】

**用户画像**：想了解店铺热销、推荐产品、具体型号
**包含规则**：
- 热销词：best, top, popular, best seller, #1, rated
- 推荐词：recommended, featured, choice, must have
- 新品词：new, latest, 2024, 2025, newest
- **具体型号**：s8, q7, s7 max, q5, s8 pro ultra（重要特征！）
- 高端词：premium, flagship, advanced

**❌ 排除规则**：
- 不包含促销/价格：discount, sale, price, deal（除非与型号强关联）
- 不包含评价词：review, rating, feedback（应归入桶D）

**优先级规则（最高）**：
- **包含具体型号的关键词，优先归入桶C**
- "roborock s8" → 桶C ✅
- "best roborock s8" → 桶C ✅
- "roborock s8 price" → 桶S ❌（型号+价格，价格优先）

**示例**（符合桶C）：
- roborock s8 pro ultra
- roborock q7 max
- best roborock vacuum
- top rated robot vacuum
- roborock new 2024

**反例**（不应归入桶C）：
- roborock price ❌ → 应归入桶S（价格查询）
- roborock review ❌ → 应归入桶D（评价查询）

---

### 桶D - 信任信号导向 (Trust-Signals) 【优先级：4】

**用户画像**：关注店铺信誉、用户评价、售后保障
**包含规则**：
- 评价词：review, rating, testimonial, feedback, comment, opinion
- 保障词：warranty, guarantee, replacement, refund, return policy
- 服务词：support, service, customer service, help, assistance
- 质量词：quality, reliability, durability

**❌ 排除规则（关键）**：
- 不包含价格词：price, cost, cheap, affordable（价格查询不是信任信号）
- 不包含促销词：discount, sale, deal, coupon
- 不包含具体型号（除非与评价强关联）："roborock review" ✅，"roborock s8" ❌

**示例**（符合桶D）：
- roborock review
- robot vacuum rating
- roborock warranty
- vacuum cleaner customer service
- roborock quality

**反例**（不应归入桶D）：
- roborock price ❌ → 应归入桶S（价格查询）
- roborock s8 ❌ → 应归入桶C（具体型号）
- roborock floor cleaning ❌ → 应归入桶B（使用场景）

---

### 桶S - 店铺全景导向 (Store-Overview) 【优先级：5】

**用户画像**：想全面了解店铺、查找店铺位置、寻找优惠促销
**包含规则**：
- 店铺相关：all products, full range, collection, catalog
- 品类通用：robot vacuum, vacuum cleaner（不含具体型号）
- **促销/价格**：discount, sale, deal, coupon, promo, code, price, cost, cheap
- **地理位置**：locations, store finder, near me, delivery, shipping
- 综合查询：品牌 + 品类（如 "roborock vacuum"）

**❌ 排除规则**：
- 不包含具体型号（除非与促销强关联）："roborock s8 price" 可归入桶S
- 不包含纯场景词："pet hair vacuum" → 桶B

**兜底规则**：
- 如果关键词不明确符合桶A/B/C/D，默认归入桶S
- 所有包含促销/价格词的关键词，默认归入桶S

**示例**（符合桶S）：
- roborock store discount code
- roborock sale
- roborock price
- roborock store locations
- robot vacuum（通用品类）
- roborock all products

---

## 🎯 分桶决策流程（v4.18）

按以下顺序检查关键词：

### 第1步：检查排他性特征（强制规则）
```
IF 包含 {discount, sale, deal, coupon, promo, code, price, cost, cheap}
  → 桶S（促销/价格优先）

ELSE IF 包含 {s8, q7, s7, q5, max, ultra, pro} 且为具体型号
  → 桶C（型号优先）

ELSE IF 包含 {review, rating, testimonial, feedback}
  → 桶D（评价优先）

ELSE 继续检查其他特征
```

### 第2步：检查场景特征
```
IF 包含 {home, house, pet hair, floor, carpet, hardwood} 且不含型号
  → 桶B（场景解决方案）
```

### 第3步：检查品牌信任特征
```
IF 包含 {official, authorized, genuine, authentic} 且不含促销/价格
  → 桶A（品牌信任）
```

### 第4步：兜底规则
```
ELSE
  → 桶S（店铺全景）
```

{{/equals}}
{{/linkType}}
{{/linkType}}

# 分桶原则

1. **互斥性**：每个关键词只能分到一个桶
2. **完整性**：所有关键词都必须分配
3. **🔥 精准性（v4.18核心）**：
   - 优先匹配明确特征（促销→桶S，型号→桶C，评价→桶D）
   - 使用排除规则避免错误分配
   - 按决策流程顺序检查（不再强制"勉强符合"）
4. **均衡性**：目标是每个桶有合理分布，但不强制平均

# 输出格式（店铺链接 - 5桶）
{
  "bucketA": { "intent": "品牌信任导向", "intentEn": "Brand-Trust", "description": "用户认可品牌，寻求官方购买渠道", "keywords": [...] },
  "bucketB": { "intent": "场景解决方案导向", "intentEn": "Scene-Solution", "description": "用户有具体使用场景需求", "keywords": [...] },
  "bucketC": { "intent": "精选推荐导向", "intentEn": "Collection-Highlight", "description": "用户想了解店铺热销/推荐产品", "keywords": [...] },
  "bucketD": { "intent": "信任信号导向", "intentEn": "Trust-Signals", "description": "用户关注店铺信誉、售后保障", "keywords": [...] },
  "bucketS": { "intent": "店铺全景导向", "intentEn": "Store-Overview", "description": "用户想全面了解店铺、查找优惠促销", "keywords": [...] },
  "statistics": { "totalKeywords": N, "bucketACount": N, "bucketBCount": N, "bucketCCount": N, "bucketDCount": N, "bucketSCount": N, "balanceScore": 0.95 }
}

注意事项：
1. 返回纯JSON，不要markdown代码块
2. 所有原始关键词必须出现在输出中
3. balanceScore = 1 - (max差异 / 总数)
4. 🔥 严格遵循排除规则和优先级！不要将促销词分到桶A，不要将型号词分到桶B',
  TRUE,
  NOW()
);

-- ====================================================================
-- SOURCE: pg-migrations/104_fix_timestamp_columns.pg.sql
-- ====================================================================
-- 修复时间戳列类型问题
-- 问题：PostgreSQL中 TEXT 类型的日期列无法与 TIMESTAMP WITH TIME ZONE 进行比较
-- 错误：operator does not exist: text >= timestamp with time zone
-- 影响：link_check_history.checked_at 列

-- 1. 修改 link_check_history 表的 checked_at 列类型从 TEXT 改为 TIMESTAMP WITH TIME ZONE
-- 使用 USING 子句将现有的 TEXT 格式转换为 TIMESTAMP
-- TEXT 格式应为 'YYYY-MM-DD HH24:MI:SS' 或 ISO 8601 格式

ALTER TABLE link_check_history
ALTER COLUMN checked_at TYPE TIMESTAMP WITH TIME ZONE
USING checked_at::TIMESTAMP WITH TIME ZONE;

-- 2. 确保 DEFAULT 值也是 TIMESTAMP WITH TIME ZONE 类型
ALTER TABLE link_check_history
ALTER COLUMN checked_at SET DEFAULT NOW();

-- ====================================================================
-- SOURCE: pg-migrations/105_strict_json_format_constraint.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 105_strict_json_format_constraint
-- Description: 修复JSON解析问题 - 强制AI返回对象格式而非数组
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- 错误: Unexpected non-whitespace character after JSON at position 3518
-- 原因: AI返回数组格式 [{...}] 而非对象格式 {...}
-- 修复: 在prompt中添加更严格的格式约束

-- ========================================
-- ad_creative_generation: v4.17 → v4.17_p1
-- ========================================

-- 0. 幂等性插入新版本
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.17_p1',
  '广告创意生成',
  '广告创意生成v4.17_p1 - JSON格式修复',
  '添加严格的JSON格式约束，防止AI返回数组格式',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## v4.16 关键词分层架构 (CRITICAL)

### 关键词数据说明

{{ai_keywords_section}}
{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**重要：上述关键词已经过分层筛选，只包含以下两类：**

1. 品牌词（共享层）- 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. 桶匹配词（独占层）- 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

## v4.10 关键词嵌入规则 (MANDATORY)

### 强制要求：8/15 (53%+) 标题必须包含关键词

**嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- 正确: "4K Security Camera Sale"
- 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## v4.11 描述嵌入规则 (MANDATORY)

### 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- 必须在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述必须包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## v4.15 本地化规则 (CRITICAL)

**本地化规则**:

**规则1: 货币符号**
- US: USD ($)
- UK: GBP (£)
- EU: EUR ()

**规则2: 紧急感本地化**
- US/UK: "Limited Time", "Today Only"
- DE: "Nur heute", "Oferta limitada"
- JP: "今だけ", "期間限定"

## v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS - JSON FORMAT (最重要)**:
1. RETURN A SINGLE JSON OBJECT - start with { and end with }
2. DO NOT wrap the response in an array [...]
3. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
4. All headlines and descriptions must be in the target language ({{target_language}})
5. All headlines must be ≤30 characters
6. All descriptions must be ≤90 characters
7. Return exactly 15 headlines and 4-5 descriptions
8. If you cannot generate valid JSON, return an error message starting with "ERROR:".',
  'English',
  1,
  FALSE,
  'v4.17_p1 JSON格式修复:
1. 添加严格的JSON格式约束（最重要要求）
2. 明确禁止返回数组格式 [...]
3. 强调必须返回单一对象 {...}'
)
ON CONFLICT (prompt_id, version) DO NOTHING;

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2. 将 v4.17_p1 设为活跃版本
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.17_p1';

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY version DESC
LIMIT 5;

-- Migration complete!

-- ====================================================================
-- SOURCE: pg-migrations/106_sitelinks_count_6.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 106_sitelinks_count_6
-- Description: 更新广告创意生成Prompt - 要求生成6个Sitelinks(从之前的隐式4个改为明确6个)
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- ========================================
-- ad_creative_generation: v4.17 → v4.17_p2
-- ========================================

-- 1. 将当前活跃版本设为非活跃
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- 幂等性：避免重复执行时 v4.17_p2 已存在导致唯一约束失败
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.17_p2';

-- 2. 插入新版本 v4.17_p2
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.17_p2',
  '广告创意生成',
  '广告创意生成v4.17_p2 - 明确要求6个Sitelinks',
  'Patch 2: 在Prompt中明确要求生成6个Sitelinks(之前只在JSON格式中隐式提及)',
  'src/lib/ad-creative-generator.ts',
  'buildAdCreativePrompt',
  '{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 🔧 v4.17_p2 Sitelinks要求 (2025-12-24)

### ⚠️ 强制要求：生成6个Sitelinks

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks（不多不少）
- 每个Sitelink必须有text、url、description三个字段

**规则2: 长度限制**
- text: 最多25个字符
- description: 最多35个字符
- url: 统一使用 "/" (系统会自动替换为真实URL)

**规则3: 多样性要求**
- 6个Sitelinks必须覆盖不同的用户意图
- 避免重复或相似的链接文本
- 建议类型分布：
  * 产品页/分类页 (2个)
  * 促销/优惠页 (1-2个)
  * 关于品牌/服务页 (1个)
  * 保障/退换货页 (1个)

**示例**:
```json
"sitelinks": [
  {"text": "Shop All Products", "url": "/", "description": "Browse our full collection"},
  {"text": "Best Sellers", "url": "/", "description": "Top-rated items this month"},
  {"text": "Special Offers", "url": "/", "description": "Save up to 30% on select items"},
  {"text": "About Us", "url": "/", "description": "Learn about our brand story"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8 stars from 10K+ customers"},
  {"text": "Free Shipping", "url": "/", "description": "On orders over $50"}
]
```

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. Return exactly 6 sitelinks (CRITICAL - 从之前的隐式改为明确要求)
7. If you cannot generate valid JSON, return an error message starting with "ERROR:".',
  'English',
  1,
  true,
  'v4.17_p2 Patch 2:
1. 在Prompt中明确要求生成6个Sitelinks
2. 添加"v4.17_p2 Sitelinks要求"专门章节，详细说明：
   - 数量固定：恰好6个
   - 长度限制：text≤25, desc≤35
   - 多样性要求：6种不同用户意图
   - 提供6个Sitelinks的示例
3. 在OUTPUT CRITICAL REQUIREMENTS中添加第6条：Return exactly 6 sitelinks
4. 同步修改配套代码：
   - brand-services-extractor.ts: slice(0, 4) → slice(0, 6)
   - ad-creative-scorer.ts: 建议4-6个 → 建议6个'
);

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 5;

-- ✅ Migration complete!

-- ====================================================================
-- SOURCE: pg-migrations/107_single_product_focus_prompt_v4.18.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 107_single_product_focus_prompt_v4.18
-- Description: 单品聚焦Prompt增强 v4.18 - 强制所有广告创意元素100%聚焦单品商品
-- Date: 2025-12-25
-- Database: PostgreSQL
-- =====================================================

-- ========================================
-- ad_creative_generation: v4.17_p2 → v4.18
-- ========================================

-- 问题背景：
-- 当用户创建单品链接Offer时（如Eufy Argus 3 Pro安防摄像头），期望所有广告元素聚焦该单品。
-- 但当前创意生成可能包含同品牌其他品类的内容（如doorbell、vacuum等）。
--
-- 解决方案：
-- 在Prompt中添加强制单品聚焦规则，要求AI生成的所有元素（Headlines、Descriptions、Sitelinks、Callouts）
-- 必须100%聚焦于单品，排除其他品类。

-- 步骤1：检查v4.18是否已存在
DO $$
BEGIN
  -- 如果v4.18已存在，直接激活并退出
  IF EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.18'
  ) THEN
    -- 将其他版本设为非活跃
    UPDATE prompt_versions
    SET is_active = false
    WHERE prompt_id = 'ad_creative_generation' AND version != 'v4.18';

    -- 激活v4.18
    UPDATE prompt_versions
    SET is_active = true
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.18';

    RAISE NOTICE 'ad_creative_generation v4.18 already exists, activated it';
    RETURN;
  END IF;

  -- v4.18不存在，执行插入流程
  -- 将当前活跃版本设为非活跃
  UPDATE prompt_versions
  SET is_active = false
  WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

  -- 插入新版本 v4.18
  INSERT INTO prompt_versions (
    prompt_id,
    version,
    category,
    name,
    description,
    file_path,
    function_name,
    prompt_content,
    language,
    created_by,
    is_active,
    change_notes
  ) VALUES (
    'ad_creative_generation',
    'v4.18',
    '广告创意生成',
    '广告创意生成v4.18 - 单品聚焦增强版',
    '广告创意生成v4.18 - 单品聚焦增强版',
    'src/lib/ad-creative-generator.ts',
    'buildAdCreativePrompt',
  '
{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 🔧 v4.17_p2 Sitelinks要求 (2025-12-24)

### ⚠️ 强制要求：生成6个Sitelinks

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks（不多不少）
- 每个Sitelink必须有text、url、description三个字段

**规则2: 长度限制**
- text: 最多25个字符
- description: 最多35个字符
- url: 统一使用 "/" (系统会自动替换为真实URL)

**规则3: 多样性要求**
- 6个Sitelinks必须覆盖不同的用户意图
- 避免重复或相似的链接文本
- 建议类型分布：
  * 产品页/分类页 (2个)
  * 促销/优惠页 (1-2个)
  * 关于品牌/服务页 (1个)
  * 保障/退换货页 (1个)

---

## 🎯 v4.18 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品

**单品信息**：
- 产品标题：{{product_title}}
- 主品类：{{category}}
- 核心卖点：{{unique_selling_points}}

---

### 📏 聚焦规则详解

#### 规则1: Headlines聚焦

**要求**：
- ✅ **必须**提到具体产品名称或主品类
- ✅ **必须**突出产品型号/规格/独特功能
- ❌ **禁止**提到其他品类名称
- ❌ **禁止**使用过于通用的品牌描述

**正确示例**（Eufy Argus 3 Pro Outdoor Security Camera）：
```
✅ "Eufy Argus 3 Pro - 2K Night Vision"
✅ "Outdoor Security Camera with Solar"
✅ "Wireless 2K Camera - Eufy"
✅ "Eufy Security Camera - AI Detection"
```

**错误示例**：
```
❌ "Eufy Smart Home Solutions" (太通用，未聚焦单品)
❌ "Cameras, Doorbells & More" (提到其他品类)
❌ "Complete Home Security Line" (暗示多产品)
❌ "Explore Eufy''s Full Lineup" (暗示产品系列)
```

---

#### 规则2: Descriptions聚焦

**要求**：
- ✅ **必须**描述单品的具体功能/特性/优势
- ✅ 可以使用产品应用场景（如"保护你的家庭"）
- ❌ **禁止**提到"browse our collection"（暗示多商品）
- ❌ **禁止**提到"explore our lineup"（暗示产品系列）
- ❌ **禁止**提到其他品类名称

**正确示例**：
```
✅ "2K resolution camera with AI person detection. Wireless setup in minutes."
✅ "Solar-powered outdoor camera. No monthly fees. Weatherproof IP67."
✅ "Color night vision security camera. See details even in darkness."
```

**错误示例**：
```
❌ "Browse our full smart home collection" (暗示多商品)
❌ "From doorbells to cameras, we have it all" (提到其他品类)
❌ "Complete security lineup for your home" (暗示多产品)
```

---

#### 规则3: Sitelinks聚焦

**要求**：
- ✅ **必须**每个Sitelink都与单品相关
- ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比（仅对比该品类下的型号）
- ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
- ❌ **禁止**指向其他品类页（如"View Our Doorbells"）
- ❌ **禁止**通用店铺页面（如"Browse Collection"）

**数量要求**：恰好6个Sitelinks

**正确示例**（安防摄像头）：
```json
"sitelinks": [
  {"text": "Product Details", "url": "/", "description": "Full specs & features"},
  {"text": "Tech Specs", "url": "/", "description": "Resolution, battery, storage"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 10K+ reviews"},
  {"text": "Installation Guide", "url": "/", "description": "Easy setup in 10 minutes"},
  {"text": "Warranty Info", "url": "/", "description": "2-year warranty included"},
  {"text": "Compare Models", "url": "/", "description": "Argus 2 vs Argus 3 Pro"}
]
```

**错误示例**：
```json
❌ {"text": "Shop All Cameras", "description": "..."} (暗示多商品)
❌ {"text": "View Our Doorbells", "description": "..."} (其他品类)
❌ {"text": "Browse Collection", "description": "..."} (通用店铺)
❌ {"text": "Smart Home Deals", "description": "..."} (多品类)
```

---

#### 规则4: Callouts聚焦

**要求**：
- ✅ **必须**突出单品的独特卖点/功能/优势
- ✅ 可以是：技术规格、功能特性、性能指标、保障信息
- ❌ **禁止**通用品牌卖点（如"Wide Product Range"）
- ❌ **禁止**暗示多商品（如"Full Product Line"）

**正确示例**（安防摄像头）：
```
✅ "2K Resolution"
✅ "Solar Powered"
✅ "AI Person Detection"
✅ "No Monthly Fees"
✅ "Weatherproof IP67"
✅ "Color Night Vision"
```

**错误示例**：
```
❌ "Wide Product Range" (暗示多商品)
❌ "Full Smart Home Line" (多品类)
❌ "Cameras & Doorbells" (其他品类)
```

---

#### 规则5: 关键词嵌入验证

**要求**：
- ✅ 从 {{ai_keywords_section}} 选择关键词嵌入
- ✅ 选中的关键词必须与单品相关
- ❌ 如果关键词提到其他品类，**跳过该词**

**检查逻辑**：
```
在嵌入关键词前，先检查关键词是否包含其他品类词：
- 如果包含 "doorbell", "vacuum", "lock", "bulb" 等非主品类词 → 跳过
- 如果包含主品类词 "camera", "security" → 可以嵌入
```

---

### ❗强制检查清单

生成内容前，确认以下所有项：

- [ ] 所有Headlines提到产品名称或主品类
- [ ] 没有任何内容提到其他品类（doorbell, vacuum, lock等）
- [ ] Sitelinks全部指向单品相关页面（无"Shop All", "Browse Collection"）
- [ ] Callouts突出单品卖点（无"Wide Product Range", "Full Line"）
- [ ] 嵌入的关键词都与单品相关（跳过了其他品类词）
- [ ] Descriptions描述单品功能，未提"explore our lineup"

---

### 🔍 自查问题

生成完成后，自问以下问题：

1. **产品聚焦测试**：删除品牌名后，用户能否识别出这是在推广哪个具体产品？
   - ✅ 能识别 → 聚焦度高
   - ❌ 不能识别 → 需要增加产品细节

2. **品类单一测试**：内容是否只提到一个品类？
   - ✅ 只提摄像头 → 聚焦度高
   - ❌ 提到摄像头+门铃 → 违反单品聚焦原则

3. **着陆页一致测试**：用户点击广告后，着陆页是否与广告描述完全一致？
   - ✅ 着陆页是单品页面 → 一致性高
   - ❌ 着陆页是产品列表或店铺 → 不一致

---

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. Return exactly 6 sitelinks (CRITICAL - 从之前的隐式改为明确要求)
7. If you cannot generate valid JSON, return an error message starting with "ERROR:".
8. **IMPORTANT**: Ensure ALL creative elements focus on the single product - no multi-product references!
  ',
  'English',
  1,
  true,  -- is_active = true (立即激活)
  'v4.18 单品聚焦增强:
1. 新增"🎯 v4.18 单品聚焦要求"章节（强制规则）
2. 详细规则1-5：Headlines/Descriptions/Sitelinks/Callouts/关键词嵌入
3. 强制检查清单（6项）
4. 自查问题（3个测试）
5. 确保所有创意元素100%聚焦单品商品
6. 代码层面：每个产品桶(A/B/C/D/S)添加单品聚焦约束
   - 桶A: 必须提到具体产品名称/型号
   - 桶B: 围绕单一产品描述购买优势
   - 桶C: 聚焦单品功能细节
   - 桶D: 单一产品的专属促销
   - 桶S: 综合创意添加Single Product Focus约束'
  );

  RAISE NOTICE 'ad_creative_generation v4.18 created and activated';
END $$;

-- ========================================
-- keyword_intent_clustering: 激活 v4.18
-- ========================================

-- 步骤2：激活keyword_intent_clustering v4.18（幂等操作）
DO $$
BEGIN
  -- 检查v4.18是否存在
  IF EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.18'
  ) THEN
    -- 将其他版本设为非活跃
    UPDATE prompt_versions
    SET is_active = false
    WHERE prompt_id = 'keyword_intent_clustering' AND version != 'v4.18';

    -- 激活v4.18
    UPDATE prompt_versions
    SET is_active = true
    WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.18';

    RAISE NOTICE 'keyword_intent_clustering v4.18 activated';
  ELSE
    RAISE NOTICE 'keyword_intent_clustering v4.18 does not exist, skipping';
  END IF;
END $$;

-- 验证结果
SELECT id, prompt_id, name, version, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 3;

SELECT id, prompt_id, version, is_active
FROM prompt_versions
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.18';

-- ✅ Migration complete!
-- 1. ad_creative_generation v4.18 已激活 - 包含单品聚焦规则
-- 2. keyword_intent_clustering v4.18 已激活 - 增强店铺链接分桶精准度
-- 两个Prompt现在都已就绪，系统将使用最新的优化版本生成广告创意

-- ====================================================================
-- SOURCE: pg-migrations/108_fix_google_ads_account_id_on_delete.pg.sql
-- ====================================================================
-- Migration: 108_fix_google_ads_account_id_on_delete
-- Date: 2025-12-25
-- Description: 修改google_ads_account_id外键约束，删除Ads账号时保留历史数据，设为NULL
-- Tables affected: campaigns, weekly_recommendations, optimization_recommendations, sync_logs

-- PostgreSQL支持ALTER TABLE FOREIGN KEY，比SQLite简单

-- =============================================================================
-- 1. campaigns 表
-- =============================================================================

-- 步骤1.1: 删除旧的外键约束
ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_google_ads_account_id_fkey;

-- 步骤1.2: 先将列设为可空（如果之前是NOT NULL）
ALTER TABLE campaigns ALTER COLUMN google_ads_account_id DROP NOT NULL;

-- 步骤1.3: 添加新的外键约束（SET NULL）
ALTER TABLE campaigns
ADD CONSTRAINT campaigns_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;

-- =============================================================================
-- 2. weekly_recommendations 表
-- =============================================================================

ALTER TABLE weekly_recommendations DROP CONSTRAINT IF EXISTS weekly_recommendations_google_ads_account_id_fkey;
ALTER TABLE weekly_recommendations ALTER COLUMN google_ads_account_id DROP NOT NULL;

ALTER TABLE weekly_recommendations
ADD CONSTRAINT weekly_recommendations_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;

-- =============================================================================
-- 3. optimization_recommendations 表
-- =============================================================================

ALTER TABLE optimization_recommendations DROP CONSTRAINT IF EXISTS optimization_recommendations_google_ads_account_id_fkey;
ALTER TABLE optimization_recommendations ALTER COLUMN google_ads_account_id DROP NOT NULL;

ALTER TABLE optimization_recommendations
ADD CONSTRAINT optimization_recommendations_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;

-- =============================================================================
-- 4. sync_logs 表
-- =============================================================================

ALTER TABLE sync_logs DROP CONSTRAINT IF EXISTS sync_logs_google_ads_account_id_fkey;
ALTER TABLE sync_logs ALTER COLUMN google_ads_account_id DROP NOT NULL;

ALTER TABLE sync_logs
ADD CONSTRAINT sync_logs_google_ads_account_id_fkey
FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE SET NULL;

-- ====================================================================
-- SOURCE: pg-migrations/108_product_model_emphasis_v4.19.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 108_product_model_emphasis_v4.19
-- Description: 产品型号强化 v4.19 - 提升产品型号在创意中的出现率
-- Date: 2025-12-25
-- Database: PostgreSQL
-- =====================================================

-- 问题背景：
-- v4.18已实现单品聚焦，但产品型号（如"Gen 2"）在标题中出现率仅60%。
-- 用户反馈希望提升到80%+，增强产品差异化识别度。

-- 解决方案：
-- 1. Headlines: 强制80%+标题包含完整产品型号
-- 2. Sitelinks: 建议在text中包含产品型号
-- 3. 新增产品对比建议（如Gen 1 vs Gen 2）

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM prompt_versions
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.19'
  ) THEN
    UPDATE prompt_versions SET is_active = false
    WHERE prompt_id = 'ad_creative_generation' AND version != 'v4.19';

    UPDATE prompt_versions SET is_active = true
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.19';

    RAISE NOTICE 'v4.19 already exists, activated';
    RETURN;
  END IF;

  UPDATE prompt_versions SET is_active = false
  WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

  INSERT INTO prompt_versions (
    prompt_id, version, category, name, description,
    file_path, function_name, prompt_content, language,
    created_by, is_active, change_notes
  ) VALUES (
    'ad_creative_generation',
    'v4.19',
    '广告创意生成',
    '广告创意生成v4.19 - 产品型号强化版',
    '在v4.18单品聚焦基础上，强化产品型号识别度',
    'src/lib/ad-creative-generator.ts',
    'buildAdCreativePrompt',
  '
{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 🔧 v4.17_p2 Sitelinks要求 (2025-12-24)

### ⚠️ 强制要求：生成6个Sitelinks

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks（不多不少）
- 每个Sitelink必须有text、url、description三个字段

**规则2: 长度限制**
- text: 最多25个字符
- description: 最多35个字符
- url: 统一使用 "/" (系统会自动替换为真实URL)

**规则3: 多样性要求**
- 6个Sitelinks必须覆盖不同的用户意图
- 避免重复或相似的链接文本
- 建议类型分布：
  * 产品页/分类页 (2个)
  * 促销/优惠页 (1-2个)
  * 关于品牌/服务页 (1个)
  * 保障/退换货页 (1个)

---

## 🎯 v4.18 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品

**单品信息**：
- 产品标题：{{product_title}}
- 主品类：{{category}}
- 核心卖点：{{unique_selling_points}}

---

### 📏 聚焦规则详解

#### 规则1: Headlines聚焦

**要求**：
- ✅ **必须**提到具体产品名称或主品类
- ✅ **必须**突出产品型号/规格/独特功能
- ✅ **🆕 v4.19: 至少80% (12/15)标题必须包含完整产品型号**
  * 如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号
  * 示例：RingConn Gen 2 → 12个标题必须包含"Gen 2"
  * 示例：Eufy Argus 3 Pro → 12个标题必须包含"3 Pro"或"Argus 3 Pro"
- ❌ **禁止**提到其他品类名称
- ❌ **禁止**使用过于通用的品牌描述

**正确示例**（RingConn Gen 2 Smart Ring）：
```
✅ "RingConn Gen 2 - 12 Days Battery" (包含Gen 2)
✅ "Gen 2 Smart Ring - No Subscription" (包含Gen 2)
✅ "Sleep Apnoe Monitor - Gen 2" (包含Gen 2)
✅ "RingConn Gen 2 Health Tracker" (包含Gen 2)
```

**错误示例**：
```
❌ "Smart Ring Health Tracking" (缺少Gen 2型号)
❌ "RingConn Health Monitor" (缺少Gen 2型号)
❌ "Your Health Tracker" (太通用，缺少产品型号)
```

**🎯 型号识别度检查**：
- 生成15个标题后，统计包含产品型号的数量
- 如果少于12个，重新生成直到满足要求

---

#### 规则2: Descriptions聚焦

**要求**：
- ✅ **必须**描述单品的具体功能/特性/优势
- ✅ **🆕 v4.19: 建议至少2个描述包含产品型号**
- ✅ 可以使用产品应用场景（如"保护你的家庭"）
- ❌ **禁止**提到"browse our collection"（暗示多商品）
- ❌ **禁止**提到"explore our lineup"（暗示产品系列）
- ❌ **禁止**提到其他品类名称

**正确示例**（RingConn Gen 2）：
```
✅ "RingConn Gen 2 with AI sleep apnoe monitoring. No subscription. Order now!"
✅ "The Gen 2 smart ring tracks stress, HRV & SpO2. 12-day battery life."
✅ "Accurate health data with RingConn. Compatible with iOS & Android."
```

---

#### 规则3: Sitelinks聚焦

**要求**：
- ✅ **必须**每个Sitelink都与单品相关
- ✅ **🆕 v4.19: 建议至少2个Sitelink的text包含产品型号**
  * 示例："Gen 2 Details", "Gen 2 Tech Specs", "Gen 2 vs Gen 1"
- ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比（仅对比该品类下的型号）
- ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
- ❌ **禁止**指向其他品类页（如"View Our Doorbells"）
- ❌ **禁止**通用店铺页面（如"Browse Collection"）

**数量要求**：恰好6个Sitelinks

**正确示例**（RingConn Gen 2）：
```json
"sitelinks": [
  {"text": "Gen 2 Details", "url": "/", "description": "Full specs & features"},
  {"text": "Gen 2 Tech Specs", "url": "/", "description": "Battery, sensors, materials"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 5K+ users"},
  {"text": "Size Guide", "url": "/", "description": "Find your perfect fit"},
  {"text": "Gen 2 vs Gen 1", "url": "/", "description": "New AI features & 2x battery"},
  {"text": "No Subscription", "url": "/", "description": "Lifetime free app access"}
]
```

**🆕 v4.19 产品对比建议**：
- 如果产品有前代版本（如Gen 1 vs Gen 2），建议添加1个对比Sitelink
- 对比内容应突出新版本的升级点

---

#### 规则4: Callouts聚焦

**要求**：
- ✅ **必须**突出单品的独特卖点/功能/优势
- ✅ 可以是：技术规格、功能特性、性能指标、保障信息
- ❌ **禁止**通用品牌卖点（如"Wide Product Range"）
- ❌ **禁止**暗示多商品（如"Full Product Line"）

**正确示例**（RingConn Gen 2）：
```
✅ "AI Sleep Apnoe Monitor"
✅ "12-Day Battery Life"
✅ "No Monthly Subscription"
✅ "Stress & HRV Tracking"
✅ "Waterproof IP68"
✅ "Compatible iOS & Android"
```

---

#### 规则5: 关键词嵌入验证

**要求**：
- ✅ 从 {{ai_keywords_section}} 选择关键词嵌入
- ✅ 选中的关键词必须与单品相关
- ❌ 如果关键词提到其他品类，**跳过该词**

---

### ❗强制检查清单

生成内容前，确认以下所有项：

- [ ] 至少12/15标题包含完整产品型号（如"Gen 2"）
- [ ] 至少2/4描述包含产品型号
- [ ] 至少2/6 Sitelinks的text包含产品型号
- [ ] 所有Headlines提到产品名称或主品类
- [ ] 没有任何内容提到其他品类（doorbell, vacuum, lock等）
- [ ] Sitelinks全部指向单品相关页面（无"Shop All", "Browse Collection"）
- [ ] Callouts突出单品卖点（无"Wide Product Range", "Full Line"）
- [ ] 嵌入的关键词都与单品相关（跳过了其他品类词）
- [ ] Descriptions描述单品功能，未提"explore our lineup"

---

### 🔍 自查问题

生成完成后，自问以下问题：

1. **产品型号识别度测试**：标题中产品型号出现率是否≥80%？
   - ✅ ≥12个标题包含型号 → 识别度高
   - ❌ <12个标题包含型号 → 需要重新生成

2. **产品聚焦测试**：删除品牌名后，用户能否识别出这是在推广哪个具体产品？
   - ✅ 能识别 → 聚焦度高
   - ❌ 不能识别 → 需要增加产品细节

3. **品类单一测试**：内容是否只提到一个品类？
   - ✅ 只提智能戒指 → 聚焦度高
   - ❌ 提到戒指+手环 → 违反单品聚焦原则

4. **着陆页一致测试**：用户点击广告后，着陆页是否与广告描述完全一致？
   - ✅ 着陆页是单品页面 → 一致性高
   - ❌ 着陆页是产品列表或店铺 → 不一致

---

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. Return exactly 6 sitelinks
7. **🆕 v4.19: At least 12/15 headlines MUST include the product model (e.g., "Gen 2")**
8. **🆕 v4.19: At least 2/4 descriptions SHOULD include the product model**
9. **🆕 v4.19: At least 2/6 sitelinks text SHOULD include the product model**
10. If you cannot generate valid JSON, return an error message starting with "ERROR:".
11. Ensure ALL creative elements focus on the single product - no multi-product references!
  ',
  'English',
  1,
  true,
  'v4.19 产品型号强化:
1. Headlines: 强制80% (12/15)标题包含完整产品型号
2. Descriptions: 建议至少2个描述包含产品型号
3. Sitelinks: 建议至少2个Sitelink text包含产品型号
4. 新增产品对比建议（如Gen 2 vs Gen 1）
5. 新增型号识别度检查清单
6. 提升产品差异化识别度，避免通用描述'
  );

  RAISE NOTICE 'v4.19 created and activated';
END $$;

-- 验证
SELECT id, prompt_id, version, is_active, created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 3;

-- ====================================================================
-- SOURCE: pg-migrations/109_create_offer_blacklist.pg.sql
-- ====================================================================
-- Migration: 109_create_offer_blacklist
-- Description: 创建Offer拉黑投放黑名单库（品牌+国家）
-- Date: 2025-12-25

CREATE TABLE IF NOT EXISTS offer_blacklist (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  brand TEXT NOT NULL,
  target_country TEXT NOT NULL,
  offer_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  UNIQUE(user_id, brand, target_country)
);

CREATE INDEX IF NOT EXISTS idx_offer_blacklist_user ON offer_blacklist(user_id);
CREATE INDEX IF NOT EXISTS idx_offer_blacklist_brand_country ON offer_blacklist(brand, target_country);

-- ====================================================================
-- SOURCE: pg-migrations/110_bucket_type_differentiation_v4.20.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 110_bucket_type_differentiation_v4.20
-- Description: 桶类型差异化角度 v4.20 - 单品+店铺链接差异化创意
-- Date: 2025-12-26
-- Database: PostgreSQL
-- =====================================================

-- PostgreSQL版本说明：
-- 1. 使用 INSERT ... WHERE NOT EXISTS 进行幂等插入
-- 2. 使用 NOW() 替代 datetime('now')
-- 3. 使用 || 进行字符串拼接
-- 4. 布尔值使用 true/false

-- 步骤1：停用其他版本，激活v4.20（使用事务）
DO $$
BEGIN
    -- 如果v4.20已存在，更新is_active
    IF EXISTS (SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20') THEN
        UPDATE prompt_versions
        SET is_active = false
        WHERE prompt_id = 'ad_creative_generation'
          AND version != 'v4.20'
          AND EXISTS (SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20');

        UPDATE prompt_versions
        SET is_active = true
        WHERE prompt_id = 'ad_creative_generation'
          AND version = 'v4.20';
    END IF;
END $$;

-- 步骤2：如果v4.20不存在，则创建（幂等插入）
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description,
  file_path, function_name, prompt_content, language,
  created_by, is_active, change_notes, created_at
)
SELECT
  'ad_creative_generation',
  'v4.20',
  '广告创意生成',
  '广告创意生成v4.20 - 桶类型差异化角度版',
  '新增5个桶类型的差异化角度规则（单品+店铺）：

【单品链接】
1. 桶A品牌导向：品牌3个 + 产品6个 + 促销3个 + 场景3个
2. 桶B场景导向：场景6个 + 产品4个 + 品牌2个 + 促销3个
3. 桶C功能导向：功能6个 + 产品4个 + 品牌2个 + 场景3个
4. 桶D高购买意图：促销5个 + 产品5个 + 品牌2个 + 场景3个
5. 桶S综合推广：平均分布各3个

【店铺链接】
1. 桶A品牌信任导向：官方授权、品牌保障
2. 桶B场景解决导向：展示产品如何解决用户问题
3. 桶C精选推荐导向：店铺热销和推荐产品
4. 桶D信任信号导向：评价、售后、保障
5. 桶S店铺全景导向：全面展示店铺，吸引探索',
  'database',
  'loadPrompt',
  '
{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 🔧 v4.17_p2 Sitelinks要求 (2025-12-24)

### ⚠️ 强制要求：生成6个Sitelinks

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks（不多不少）
- 每个Sitelink必须有text、url、description三个字段

**规则2: 长度限制**
- text: 最多25个字符
- description: 最多35个字符
- url: 统一使用 "/" (系统会自动替换为真实URL)

**规则3: 多样性要求**
- 6个Sitelinks必须覆盖不同的用户意图
- 避免重复或相似的链接文本
- 建议类型分布：
  * 产品页/分类页 (2个)
  * 促销/优惠页 (1-2个)
  * 关于品牌/服务页 (1个)
  * 保障/退换货页 (1个)

---

## 🎯 v4.18 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品

**单品信息**：
- 产品标题：{{product_title}}
- 主品类：{{category}}
- 核心卖点：{{unique_selling_points}}

---

### 📏 聚焦规则详解

#### 规则1: Headlines聚焦

**要求**：
- ✅ **必须**提到具体产品名称或主品类
- ✅ **必须**突出产品型号/规格/独特功能
- ✅ **🆕 v4.20: 至少80% (12/15)标题必须包含完整产品型号**
  * 如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号
  * 示例：RingConn Gen 2 → 12个标题必须包含"Gen 2"
  * 示例：Eufy Argus 3 Pro → 12个标题必须包含"3 Pro"或"Argus 3 Pro"
- ❌ **禁止**提到其他品类名称
- ❌ **禁止**使用过于通用的品牌描述

**正确示例**（RingConn Gen 2 Smart Ring）：
```
✅ "RingConn Gen 2 - 12 Days Battery" (包含Gen 2)
✅ "Gen 2 Smart Ring - No Subscription" (包含Gen 2)
✅ "Sleep Apnoe Monitor - Gen 2" (包含Gen 2)
✅ "RingConn Gen 2 Health Tracker" (包含Gen 2)
```

**错误示例**：
```
❌ "Smart Ring Health Tracking" (缺少Gen 2型号)
❌ "RingConn Health Monitor" (缺少Gen 2型号)
❌ "Your Health Tracker" (太通用，缺少产品型号)
```

**🎯 型号识别度检查**：
- 生成15个标题后，统计包含产品型号的数量
- 如果少于12个，重新生成直到满足要求

---

#### 规则2: Descriptions聚焦

**要求**：
- ✅ **必须**描述单品的具体功能/特性/优势
- ✅ **🆕 v4.20: 建议至少2个描述包含产品型号**
- ✅ 可以使用产品应用场景（如"保护你的家庭"）
- ❌ **禁止**提到"browse our collection"（暗示多商品）
- ❌ **禁止**提到"explore our lineup"（暗示产品系列）
- ❌ **禁止**提到其他品类名称

**正确示例**（RingConn Gen 2）：
```
✅ "RingConn Gen 2 with AI sleep apnoe monitoring. No subscription. Order now!"
✅ "The Gen 2 smart ring tracks stress, HRV & SpO2. 12-day battery life."
✅ "Accurate health data with RingConn. Compatible with iOS & Android."
```

---

#### 规则3: Sitelinks聚焦

**要求**：
- ✅ **必须**每个Sitelink都与单品相关
- ✅ **🆕 v4.20: 建议至少2个Sitelink的text包含产品型号**
  * 示例："Gen 2 Details", "Gen 2 Tech Specs", "Gen 2 vs Gen 1"
- ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比（仅对比该品类下的型号）
- ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
- ❌ **禁止**指向其他品类页（如"View Our Doorbells"）
- ❌ **禁止**通用店铺页面（如"Browse Collection"）

**数量要求**：恰好6个Sitelinks

**正确示例**（RingConn Gen 2）：
```json
"sitelinks": [
  {"text": "Gen 2 Details", "url": "/", "description": "Full specs & features"},
  {"text": "Gen 2 Tech Specs", "url": "/", "description": "Battery, sensors, materials"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 5K+ users"},
  {"text": "Size Guide", "url": "/", "description": "Find your perfect fit"},
  {"text": "Gen 2 vs Gen 1", "url": "/", "description": "New AI features & 2x battery"},
  {"text": "No Subscription", "url": "/", "description": "Lifetime free app access"}
]
```

**🆕 v4.20 产品对比建议**：
- 如果产品有前代版本（如Gen 1 vs Gen 2），建议添加1个对比Sitelink
- 对比内容应突出新版本的升级点

---

#### 规则4: Callouts聚焦

**要求**：
- ✅ **必须**突出单品的独特卖点/功能/优势
- ✅ 可以是：技术规格、功能特性、性能指标、保障信息
- ❌ **禁止**通用品牌卖点（如"Wide Product Range"）
- ❌ **禁止**暗示多商品（如"Full Product Line"）

**正确示例**（RingConn Gen 2）：
```
✅ "AI Sleep Apnoe Monitor"
✅ "12-Day Battery Life"
✅ "No Monthly Subscription"
✅ "Stress & HRV Tracking"
✅ "Waterproof IP68"
✅ "Compatible iOS & Android"
```

---

#### 规则5: 关键词嵌入验证

**要求**：
- ✅ 从 {{ai_keywords_section}} 选择关键词嵌入
- ✅ 选中的关键词必须与单品相关
- ❌ 如果关键词提到其他品类，**跳过该词**

---

### ❗强制检查清单

生成内容前，确认以下所有项：

- [ ] 至少12/15标题包含完整产品型号（如"Gen 2"）
- [ ] 至少2/4描述包含产品型号
- [ ] 至少2/6 Sitelinks的text包含产品型号
- [ ] 所有Headlines提到产品名称或主品类
- [ ] 没有任何内容提到其他品类（doorbell, vacuum, lock等）
- [ ] Sitelinks全部指向单品相关页面（无"Shop All", "Browse Collection"）
- [ ] Callouts突出单品卖点（无"Wide Product Range", "Full Line"）
- [ ] 嵌入的关键词都与单品相关（跳过了其他品类词）
- [ ] Descriptions描述单品功能，未提"explore our lineup"

---

### 🔍 自查问题

生成完成后，自问以下问题：

1. **产品型号识别度测试**：标题中产品型号出现率是否≥80%？
   - ✅ ≥12个标题包含型号 → 识别度高
   - ❌ <12个标题包含型号 → 需要重新生成

2. **产品聚焦测试**：删除品牌名后，用户能否识别出这是在推广哪个具体产品？
   - ✅ 能识别 → 聚焦度高
   - ❌ 不能识别 → 需要增加产品细节

3. **品类单一测试**：内容是否只提到一个品类？
   - ✅ 只提智能戒指 → 聚焦度高
   - ❌ 提到戒指+手环 → 违反单品聚焦原则

4. **着陆页一致测试**：用户点击广告后，着陆页是否与广告描述完全一致？
   - ✅ 着陆页是单品页面 → 一致性高
   - ❌ 着陆页是产品列表或店铺 → 不一致

---

## 🆕 v4.20 单品链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：5个差异化创意必须各自专注不同的表达角度

**单品聚焦** + **角度差异化** = 高效A/B测试

**当前桶信息**：
- 桶类型：{{bucket_type}}
- 桶主题：{{bucket_intent}}

---

### 📊 单品链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 | 标题分布要求 |
|---|---------|---------|---------|------------|
| A | Brand-Oriented | 品牌导向 | 强调品牌信誉、官方渠道、品质保障 | 品牌3个 + 产品6个 + 促销3个 + 场景3个 |
| B | Scenario-Oriented | 场景导向 | 强调使用场景、问题解决、生活方式 | 场景6个 + 产品4个 + 品牌2个 + 促销3个 |
| C | Feature-Oriented | 功能导向 | 强调技术参数、核心卖点、产品优势 | 功能6个 + 产品4个 + 品牌2个 + 场景3个 |
| D | High-Intent | 高购买意图 | 强调促销、紧迫感、购买动机 | 促销5个 + 产品5个 + 品牌2个 + 场景3个 |
| S | Synthetic | 综合推广 | 整合所有角度，覆盖最广泛用户群 | 平均分布（各3个） |

---

### 🎯 桶A - 品牌导向策略

**Theme示例**：
- "{{brand}} 官方正品"
- "{{brand}} Official Store"
- "Authentic {{brand}} Products"

**标题分布（15个）**：
- 品牌相关：3个（强调官方、正品、授权）
- 产品信息：6个（必须包含完整型号）
- 促销信息：3个（限时优惠、折扣）
- 使用场景：3个（适合人群、生活方式）

**示例标题**：
```
✅ "{{brand}} Official - Guaranteed Authentic"
✅ "Official {{brand}} Store France"
✅ "Original {{brand}} Products"
✅ "Roborock Qrevo Curv 2 Pro - 100% Genuine"
✅ "Authorized {{brand}} Dealer"
✅ "Official {{brand}} Warranty Included"
✅ "Qrevo Curv 2 Pro | Official Channel"
✅ "Buy Direct from {{brand}}"
✅ "Premium {{brand}} Collection"
✅ "Certified {{brand}} Quality"
✅ "Direct from {{brand}} Factory"
✅ "Genuine {{brand}} - No Fakes"
✅ "{{brand}} Official Shop"
✅ "Authentic {{brand}} Only"
✅ "Trusted {{brand}} Retailer"
```

**❌ 禁止使用**：
- 过于通用的品牌描述（如"Quality Products"）
- 未包含产品型号的标题（超过3个）

---

### 🎯 桶B - 场景导向策略

**Theme示例**：
- "宠物家庭专属清洁方案"
- "Pet Home Cleaning Solution"
- "For Families with Pets"

**标题分布（15个）**：
- 使用场景：6个（宠物家庭、清洁痛点、生活方式）
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个（官方、品质）
- 促销信息：3个（限时优惠）

**示例标题**：
```
✅ "Perfect for Homes with Pets"
✅ "Say Goodbye to Pet Hair"
✅ "Pet Owner? This Robot is for You"
✅ "Clean Pet Hair Instantly"
✅ "Ideal for Pet Families"
✅ "No More Pet Hair on Floors"
✅ "Roborock Qrevo Curv 2 Pro - Pet Care"
✅ "Qrevo Curv 2 Pro | Pet Home Expert"
✅ "{{brand}} for Pet Owners"
✅ "Tackle Pet Hair with Ease"
✅ "Cleaner Home for Pet Lovers"
✅ "Pet-Friendly Cleaning Robot"
✅ "Qrevo Curv 2 Pro -23% for Pet Owners"
✅ "{{brand}} Official Pet Solution"
✅ "Multi-Pet Household? No Problem"
```

**❌ 禁止使用**：
- 未突出宠物/场景相关的标题超过4个
- 过于技术导向的标题（应归入桶C）

---

### 🎯 桶C - 功能导向策略

**Theme示例**：
- "25000Pa超强吸力"
- "25000Pa Suction Power"
- "Ultimate Cleaning Performance"

**标题分布（15个）**：
- 核心功能：6个（吸力、洗涤、智能等）
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个（官方、品质）
- 使用场景：3个（适合人群）

**示例标题**：
```
✅ "25000Pa Suction Power"
✅ "100°C Hot Water Washing"
✅ "Ultra-Slim 7.98cm Design"
✅ "AdaptiLift Chassis Technology"
✅ "AI Pathfinding Algorithm"
✅ "Self-Cleaning Mop System"
✅ "Roborock Qrevo Curv 2 Pro - 25000Pa"
✅ "Qrevo Curv 2 Pro | Hot Wash 100°C"
✅ "{{brand}} | 25000 Pa Suction"
✅ "7.98cm Ultra-Thin Body"
✅ "Smart Obstacle Avoidance"
✅ "7-Week Self-Cleaning Station"
✅ "Qrevo Curv 2 Pro | AdaptiLift"
✅ "{{brand}} | All-in-One Cleaning"
✅ "5000Pa×5 Suction Power"
```

**❌ 禁止使用**：
- 未突出具体功能参数的标题超过4个
- 过于促销导向的标题（应归入桶D）

---

### 🎯 桶D - 高购买意图策略

**Theme示例**：
- "限时优惠 -23%"
- "Limited Time -23% Off"
- "Exclusive Discount"

**标题分布（15个）**：
- 促销信息：5个（折扣、限时、紧迫感）
- 产品信息：5个（必须包含完整型号）
- 品牌信息：2个（官方、品质）
- 使用场景：3个（适合人群）

**示例标题**：
```
✅ "-23% Limited Time Offer"
✅ "Best Price This Year"
✅ "Exclusive Online Discount"
✅ "Flash Sale - Save Now"
✅ "Special Launch Price"
✅ "Dont Miss This Deal"
✅ "Roborock Qrevo Curv 2 Pro -23% Off"
✅ "Qrevo Curv 2 Pro | €999 Instead of €1299"
✅ "{{brand}} | -23% This Week"
✅ "Only €999 - 23% Off"
✅ "Last Chance for Discount"
✅ "Special Offer Ends Soon"
✅ "Qrevo Curv 2 Pro | Launch Promo"
✅ "{{brand}} | Best Deal 2025"
✅ "Save €300 Today Only"
```

**❌ 禁止使用**：
- 未突出折扣/促销信息的标题超过4个
- 过于功能导向的标题（应归入桶C）

---

### 🎯 桶S - 综合推广策略

**Theme示例**：
- "全能清洁助手"
- "All-in-One Cleaning Assistant"
- "Complete Home Solution"

**标题分布（15个）**：
- 平均分布：各类型约3个
- 品牌相关：3个
- 产品信息：3个
- 促销信息：3个
- 功能信息：3个
- 场景信息：3个

**示例标题**：
```
✅ "Roborock Qrevo Curv 2 Pro | Official"
✅ "-23% Off | Limited Time Only"
✅ "25000Pa Suction | 100°C Wash"
✅ "Perfect for Pet Homes"
✅ "{{brand}} | Official Store"
✅ "Smart Cleaning Solution"
✅ "Qrevo Curv 2 Pro | All-in-One"
✅ "Save €300 | Best Price"
✅ "Ultra-Slim Design | AdaptiLift"
✅ "Family Cleaning Made Easy"
✅ "{{brand}} | Premium Quality"
✅ "Hot Sale | Dont Miss Out"
✅ "7.98cm | Fits Under Furniture"
✅ "Pet Hair? No Problem"
✅ "Top Rated Robot Vacuum"
```

---

## 🆕 v4.20 店铺链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：店铺链接的5个差异化创意必须各自专注不同的表达角度

**店铺目标**：驱动用户进店探索，扩大品牌认知

**当前桶信息**：
- 桶类型：{{bucket_type}}
- 桶主题：{{bucket_intent}}

---

### 📊 店铺链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 | 标题分布要求 |
|---|---------|---------|---------|------------|
| A | Brand-Trust | 品牌信任导向 | 官方授权、品牌保障、正品保证 | 品牌8个 + 场景1个 + 品类1个 |
| B | Scene-Solution | 场景解决导向 | 展示产品如何解决用户问题 | 品牌2个 + 场景6个 + 品类2个 |
| C | Collection-Highlight | 精选推荐导向 | 店铺热销和推荐产品 | 品牌4个 + 品类3个 + 信任2个 + 场景1个 |
| D | Trust-Signals | 信任信号导向 | 评价、售后、保障 | 品牌3个 + 信任4个 + 场景2个 + 品类1个 |
| S | Store-Overview | 店铺全景导向 | 全面展示店铺，吸引探索 | 品牌5个 + 场景3个 + 品类2个 |

---

### 🎯 桶A - 品牌信任导向策略

**Theme示例**：
- "{{brand}} 官方正品店"
- "{{brand}} Official Store"
- "Authorized {{brand}} Dealer"

**标题分布（15个）**：
- 品牌相关：8个（官方、授权、正品）
- 场景信息：1个
- 品类信息：1个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "{{brand}} Deutschland Shop"
✅ "Die Nr. 1 für Saugroboter"
✅ "Official {{brand}} Store"
✅ "Authorized {{brand}} Dealer"
✅ "Volle {{brand}} Garantie"
✅ "Von Experten Top Bewertet"
✅ "{{brand}} Official - Authentic"
✅ "Direkt vom Hersteller"
✅ "Certified {{brand}} Quality"
✅ "Original {{brand}} Products"
✅ "Trusted {{brand}} Retailer"
✅ "{{brand}} | Official Partner"
✅ "100% Genuine {{brand}}"
✅ "{{brand}} Store Deutschland"
✅ "Premium {{brand}} Collection"
```

**❌ 禁止使用**：
- 未突出官方/授权的标题超过3个
- 过于促销导向的标题（应归入桶D）

---

### 🎯 桶B - 场景解决导向策略

**Theme示例**：
- "智能清洁解决方案"
- "Smart Cleaning Solution"
- "Your Home Cleaning Answer"

**标题分布（15个）**：
- 品牌信息：2个
- 场景信息：6个（清洁痛点、生活方式）
- 品类信息：2个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "Täglich saubere Böden"
✅ "Mehr Zeit für Sie, weniger putzen"
✅ "Die Lösung für alle Bodenarten"
✅ "Mühelose Reinigung im Alltag"
✅ "Finden Sie Ihre Reinigungslösung"
✅ "Bereit für ein sauberes Zuhause"
✅ "{{brand}}: Die intelligente Lösung"
✅ "Der {{brand}} für Tierhalter"
✅ "Reinigung. Automatisiert."
✅ "Weniger Putzen, Mehr Leben"
✅ "Sagen Sie Adieu zu Schmutz"
✅ "Ihr Putzhelfer der Zukunft"
✅ "{{brand}} Store DE"
✅ "Auto-Reinigung für Ihr Zuhause"
✅ "Clever Reinigen mit {{brand}}"
```

**❌ 禁止使用**：
- 未突出场景/解决方案的标题超过4个
- 过于功能参数的标题（应归入桶C的变体）

---

### 🎯 桶C - 精选推荐导向策略

**Theme示例**：
- "店铺热销排行榜"
- "Best Sellers Collection"
- "Top Rated Products"

**标题分布（15个）**：
- 品牌信息：4个
- 品类信息：3个
- 信任信号：2个
- 场景信息：1个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "{{brand}} Bestseller Entdecken"
✅ "Top Bewertete Saugroboter"
✅ "Unsere Kundenlieblinge"
✅ "{{brand}} Store Deutschland"
✅ "Testsieger {{brand}} Entdecken"
✅ "Der {{brand}} S8 Pro Ultra"
✅ "{{brand}} Qrevo: Jetzt Ansehen"
✅ "Saug- & Wischroboter im Test"
✅ "Angebote für den {{brand}} S7"
✅ "Reinigung auf neuem Niveau"
✅ "Der neue {{brand}} S8 MaxV"
✅ "{{brand}} Kundenlieblinge"
✅ "Top-Rated {{brand}} Products"
✅ "Empfohlene {{brand}} Modelle"
✅ "Beliebteste {{brand}} Saugroboter"
```

**❌ 禁止使用**：
- 未突出热销/推荐的标题超过4个
- 过于促销导向的标题（应归入桶D）

---

### 🎯 桶D - 信任信号导向策略

**Theme示例**：
- "品质保障无忧购"
- "Warranty & Guarantee"
- "Trusted by Millions"

**标题分布（15个）**：
- 品牌信息：3个
- 信任信号：4个（评价、保障、售后）
- 场景信息：2个
- 品类信息：1个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "Volle {{brand}} Garantie"
✅ "Testsieger {{brand}} Entdecken"
✅ "Tausende Zufriedene Kunden"
✅ "Deutscher Service & Support"
✅ "Sicher Einkaufen bei {{brand}}"
✅ "{{brand}} | Testsieger"
✅ "Kostenloser Versand & Garantie"
✅ "Weltweit Trusted {{brand}}"
✅ "{{brand}} F25 RT: Jetzt Kaufen"
✅ "Jetzt {{brand}} Rabattcode Sichern"
✅ "Exklusive {{brand}} Rabattcodes"
✅ "{{brand}} Sale: S8 Serie"
✅ "{{brand}} QRevo: Top Bewertung"
✅ "{{brand}} Support Deutschland"
✅ "Zufriedene {{brand}} Kunden"
```

**❌ 禁止使用**：
- 未突出信任/保障信号的标题超过4个
- 过于产品导向的标题（应归入桶A）

---

### 🎯 桶S - 店铺全景导向策略

**Theme示例**：
- "一站式智能家居商店"
- "Complete Store Overview"
- "Explore All Products"

**标题分布（15个）**：
- 品牌信息：5个
- 场景信息：3个
- 品类信息：2个
- 其他：5个

**示例标题（Roborock德国店）**：
```
✅ "{{brand}} Official Store - DE"
✅ "Alle {{brand}} Modelle Hier"
✅ "Saug- & Wischroboter Shop"
✅ "Der Neue {{brand}} F25 RT"
✅ "{{brand}} Sale: Jetzt Sparen"
✅ "{{brand}} Q7 Max Im Angebot"
✅ "Entdecken Sie {{brand}}"
✅ "{{brand}} QV 35A: 8000Pa Kraft"
✅ "Intelligente Saugroboter"
✅ "{{brand}} Roboter für Zuhause"
✅ "{{brand}} Store Deutschland"
✅ "Komplette {{brand}} Kollektion"
✅ "Alle {{brand}} Saugroboter"
✅ "{{brand}} Produkte Entdecken"
✅ "{{brand}}: Alles für Reinigung"
```

**❌ 禁止使用**：
- 未突出店铺/全品类的标题超过3个
- 过于单一产品导向的标题

---

### 🔍 单品链接差异化验证检查

**生成完成后，检查以下问题**：

1. **桶角度一致性**：
   - 桶A的标题是否70%+与品牌/官方相关？
   - 桶B的标题是否50%+与使用场景相关？
   - 桶C的标题是否50%+与功能参数相关？
   - 桶D的标题是否50%+与促销/折扣相关？

2. **跨桶差异性**：
   - 5个创意之间是否有明显的主题角度差异？
   - 用户能一眼看出哪个是"品牌导向"、哪个是"促销导向"吗？

3. **单品聚焦一致性**：
   - 所有创意是否都聚焦同一个产品？
   - 是否有任何创意偏离到其他产品或品类？

---

### 🔍 店铺链接差异化验证检查

**生成完成后，检查以下问题**：

1. **桶角度一致性**：
   - 桶A的标题是否70%+与官方/授权/正品相关？
   - 桶B的标题是否50%+与场景/解决方案相关？
   - 桶C的标题是否50%+与热销/推荐相关？
   - 桶D的标题是否50%+与信任/保障相关？

2. **跨桶差异性**：
   - 5个店铺创意之间是否有明显的主题角度差异？
   - 用户能一眼看出哪个是"品牌信任"、哪个是"精选推荐"吗？

3. **店铺聚焦一致性**：
   - 所有创意是否都聚焦整个店铺（而非单个产品）？
   - 是否有创意过于聚焦某个单品（应使用单品链接策略）？

---

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. Return exactly 6 sitelinks
7. **🆕 v4.20: At least 12/15 headlines MUST include the product model (e.g., "Gen 2")**
8. **🆕 v4.20: Headlines MUST follow the {{bucket_type}} bucket strategy (brand/scenario/feature/high-intent/synthetic)**
9. **🆕 v4.20: 5 differentiated creatives MUST have distinct angles for effective A/B testing**
10. If you cannot generate valid JSON, return an error message starting with "ERROR:".
11. Ensure ALL creative elements focus on the correct target (single product OR entire store) - no mixed references!
  ',
  'zh-CN',
  1,
  true,
  'v4.20 桶类型差异化:
1. 新增单品链接5个桶类型的差异化角度定义和示例
2. 新增店铺链接5个桶类型的差异化角度定义和示例
3. 每个桶有明确的标题分布要求和禁止规则
4. 新增单品/店铺链接差异化验证检查清单
5. 保留v4.19单品聚焦规则（80%标题包含产品型号）',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_versions
  WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20'
);

-- 验证
SELECT id, prompt_id, version, is_active, created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 5;

-- ====================================================================
-- SOURCE: pg-migrations/111_prompt_v4.21_store_link_sitelink_optional.pg.sql
-- ====================================================================
-- =====================================================
-- Migration: 111_prompt_v4.21_store_link_sitelink_optional
-- Description: v4.21 - 店铺链接Sitelink型号可选版，修复前后冲突
-- Date: 2025-12-26
-- Database: PostgreSQL
-- =====================================================

-- ========================================
-- ad_creative_generation: v4.20 → v4.21
-- ========================================

-- 修复内容：
-- 1. 明确Sitelinks强制6个（单品+店铺链接通用规则）
-- 2. 单品链接：Sitelink包含型号（强制要求2个）
-- 3. 店铺链接：Sitelink可包含型号（可选，非强制）
-- 4. 修复v4.20中"店铺聚焦一致性"与"包含单品型号"的冲突

-- 使用DO $$ 块确保幂等性
DO $$
DECLARE
  v4_exists boolean;
  v4_21_exists boolean;
BEGIN
  -- 检查v4.21是否已存在
  SELECT INTO v4_21_exists
    EXISTS (
      SELECT 1 FROM prompt_versions
      WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.21'
    );

  -- 如果v4.21已存在，直接激活并退出
  IF v4_21_exists THEN
    -- 停用其他版本
    UPDATE prompt_versions
    SET is_active = false
    WHERE prompt_id = 'ad_creative_generation' AND version != 'v4.21';

    -- 激活v4.21
    UPDATE prompt_versions
    SET is_active = true
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.21';

    RAISE NOTICE 'ad_creative_generation v4.21 already exists, activated it';
    RETURN;
  END IF;

  -- 检查v4.20是否存在
  SELECT INTO v4_exists
    EXISTS (
      SELECT 1 FROM prompt_versions
      WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20'
    );

  -- 停用v4.20（如果存在）
  IF v4_exists THEN
    UPDATE prompt_versions
    SET is_active = false
    WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.20';

    RAISE NOTICE 'ad_creative_generation v4.20 deactivated';
  END IF;

  -- 插入v4.21
  INSERT INTO prompt_versions (
    prompt_id,
    version,
    category,
    name,
    description,
    file_path,
    function_name,
    prompt_content,
    language,
    created_by,
    is_active,
    change_notes,
    created_at
  ) VALUES (
    'ad_creative_generation',
    'v4.21',
    '广告创意生成',
    '广告创意生成v4.21 - 店铺链接Sitelink型号可选版',
    '修复v4.20前后冲突：
1. 明确Sitelinks强制6个（单品+店铺通用）
2. 单品链接：Sitelink包含型号（强制2个）
3. 店铺链接：Sitelink可含型号（可选）
4. 修复店铺聚焦与单品型号的冲突规则',
    'database',
    'loadPrompt',
    '
{{language_instruction}}

Generate Google Ads creative for {{brand}} ({{category}}).

{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}
{{enhanced_features_section}}{{localization_section}}{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}{{theme_section}}{{reference_performance_section}}{{extracted_elements_section}}

{{keywords_section}}

## 🆕 v4.16 关键词分层架构 (CRITICAL)

### 📊 关键词数据说明

{{ai_keywords_section}}
{{ai_competitive_section}}
{{ai_reviews_section}}

{{link_type_instructions}}

**⚠️ 重要：上述关键词已经过分层筛选，只包含以下两类：**

1. **品牌词（共享层）** - 所有创意都可以使用
   - 纯品牌词：{{brand}}, {{brand}} official, {{brand}} store
   - 品牌+品类词：{{brand}} camera, {{brand}} security

2. **桶匹配词（独占层）** - 只包含与当前桶主题匹配的关键词
   - 当前桶类型：{{bucket_type}}
   - 当前桶主题：{{bucket_intent}}

**✅ 这意味着：{{ai_keywords_section}}中的所有关键词都与{{bucket_intent}}主题兼容**

## 🔥 v4.10 关键词嵌入规则 (MANDATORY)

### ⚠️ 强制要求：8/15 (53%+) 标题必须包含关键词

**🔑 嵌入规则**:

**规则1: 关键词全部来自{{ai_keywords_section}}**
- 优先选择搜索量>1000的高价值关键词
- 品牌词必须出现在至少2个标题中
- 桶匹配词必须出现在至少6个标题中

**规则2: 嵌入方式 (自然融入，非堆砌)**
- ✅ 正确: "4K Security Camera Sale"
- ❌ 错误: "Camera Camera Security" (堆砌)

**规则3: 标题变体**
- 15个标题必须各不相同（避免重复）
- 每组5个标题使用不同的核心卖点和表达方式

## 🔥 v4.11 描述嵌入规则 (MANDATORY)

### ⚠️ 强制要求：5/5 (100%) 描述必须包含关键词

**规则1: 品牌词出现**
- **必须**在至少3个描述中包含品牌词 {{brand}}

**规则2: 行动号召 (Call-to-Action)**
- 每个描述**必须**包含明确的CTA
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours, Explore Collection, Discover More

**规则3: 描述结构**
- 长度：90-150字符
- 必须包含：核心卖点 + 品牌词/关键词 + 明确CTA

## 🔥 v4.15 本地化规则 (CRITICAL)

**🔑 本地化规则**:

**规则1: 货币符号**
- 🇺🇸 US: USD ($)
- 🇬🇧 UK: GBP (£)
- 🇪🇺 EU: EUR (€)

**规则2: 紧急感本地化**
- 🇺🇸/🇬🇧: "Limited Time", "Today Only"
- 🇩🇪: "Nur heute", "Oferta limitada"
- 🇯🇵: "今だけ", "期間限定"

## 🆕 v4.16 店铺链接特殊规则

{{store_creative_instructions}}

## 🔧 v4.21 Sitelinks要求 (2025-12-26)

### ⚠️ 强制要求：生成6个Sitelinks（单品+店铺链接通用规则）

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks（不多不少）
- 每个Sitelink必须有text、url、description三个字段

**规则2: 长度限制**
- text: 最多25个字符
- description: 最多35个字符
- url: 统一使用 "/" (系统会自动替换为真实URL)

**规则3: 多样性要求**
- 6个Sitelinks必须覆盖不同的用户意图
- 避免重复或相似的链接文本

---

## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品

**单品信息**：
- 产品标题：{{product_title}}
- 主品类：{{category}}
- 核心卖点：{{unique_selling_points}}

---

### 📏 聚焦规则详解

#### 规则1: Headlines聚焦

**要求**：
- ✅ **必须**提到具体产品名称或主品类
- ✅ **必须**突出产品型号/规格/独特功能
- ✅ **🆕 v4.21: 至少80% (12/15)标题必须包含完整产品型号**
  * 如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号
- ❌ **禁止**提到其他品类名称
- ❌ **禁止**使用过于通用的品牌描述

**🎯 型号识别度检查**：
- 生成15个标题后，统计包含产品型号的数量
- 如果少于12个，重新生成直到满足要求

---

#### 规则2: Descriptions聚焦

**要求**：
- ✅ **必须**描述单品的具体功能/特性/优势
- ✅ **🆕 v4.21: 建议至少2个描述包含产品型号**
- ✅ 可以使用产品应用场景
- ❌ **禁止**提到"browse our collection"（暗示多商品）
- ❌ **禁止**提到其他品类名称

---

#### 规则3: Sitelinks聚焦（单品链接）

**要求**：
- ✅ **必须**每个Sitelink都与单品相关
- ✅ **🆕 v4.21: 强制至少2个Sitelink的text包含产品型号**
  * 示例："Gen 2 Details", "Gen 2 Tech Specs", "Gen 2 vs Gen 1"
- ✅ 可以是：产品详情、技术规格、用户评价、安装指南、保修信息、型号对比
- ❌ **禁止**指向产品列表页（如"Shop All Cameras"）
- ❌ **禁止**指向其他品类页

**数量要求**：恰好6个Sitelinks

**正确示例**（RingConn Gen 2）：
```json
"sitelinks": [
  {"text": "Gen 2 Details", "url": "/", "description": "Full specs & features"},
  {"text": "Gen 2 Tech Specs", "url": "/", "description": "Battery, sensors, materials"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 5K+ users"},
  {"text": "Size Guide", "url": "/", "description": "Find your perfect fit"},
  {"text": "Gen 2 vs Gen 1", "url": "/", "description": "New AI features & 2x battery"},
  {"text": "No Subscription", "url": "/", "description": "Lifetime free app access"}
]
```

---

#### 规则4: Callouts聚焦

**要求**：
- ✅ **必须**突出单品的独特卖点/功能/优势
- ✅ 可以是：技术规格、功能特性、性能指标、保障信息
- ❌ **禁止**通用品牌卖点（如"Wide Product Range"）

---

#### 规则5: 关键词嵌入验证

**要求**：
- ✅ 从 {{ai_keywords_section}} 选择关键词嵌入
- ✅ 选中的关键词必须与单品相关
- ❌ 如果关键词提到其他品类，**跳过该词**

---

### ❗强制检查清单（单品链接）

生成内容前，确认以下所有项：

- [ ] 至少12/15标题包含完整产品型号（如"Gen 2"）- **强制**
- [ ] 至少2/4描述包含产品型号 - 建议
- [ ] 至少2/6 Sitelinks的text包含产品型号 - **强制**
- [ ] 所有Headlines提到产品名称或主品类
- [ ] 没有任何内容提到其他品类（doorbell, vacuum, lock等）
- [ ] Sitelinks全部指向单品相关页面（无"Shop All", "Browse Collection"）
- [ ] Callouts突出单品卖点（无"Wide Product Range", "Full Line"）

---

### 🔍 自查问题

1. **产品型号识别度测试**：标题中产品型号出现率是否≥80%？
2. **产品聚焦测试**：删除品牌名后，用户能否识别出这是在推广哪个具体产品？
3. **品类单一测试**：内容是否只提到一个品类？
4. **着陆页一致测试**：用户点击广告后，着陆页是否与广告描述完全一致？

---

## 🆕 v4.21 店铺链接Sitelinks规则（与单品链接区别）

### 📋 店铺链接 vs 单品链接 Sitelinks规则对比

| 规则 | 单品链接 | 店铺链接 |
|------|---------|---------|
| Sitelinks数量 | 6个（强制） | 6个（强制） |
| Sitelinks包含型号 | **强制**至少2个 | **可选**（可提增强相关性） |
| Sitelinks聚焦目标 | 单品详情/规格 | 店铺分类/热销/保障 |
| 示例 | "Gen 2 Details" | "Shop All Cameras" |

### 🎯 店铺链接 Sitelinks要求

**规则1: 数量固定**
- 必须生成**恰好6个**Sitelinks

**规则2: 店铺链接可选包含型号**
- ✅ **可以**在Sitelink中包含产品型号以增强相关性（示例："Qrevo S8 Details"）
- ✅ **可以**使用店铺通用链接（示例："Shop All {{brand}}", "New Arrivals"）
- ✅ **可以**使用分类页链接（示例："Sroboter", "Staubsauger"）
- ✅ **可以**使用保障/服务链接（示例："Warranty", "Support"）

**规则3: 店铺链接Sitelinks示例**
```json
"sitelinks": [
  {"text": "Shop All {{brand}}", "url": "/", "description": "Explore our full collection"},
  {"text": "New Arrivals", "url": "/", "description": "Latest products added"},
  {"text": "Qrevo S8 Details", "url": "/", "description": "Featured product specs"},
  {"text": "Customer Reviews", "url": "/", "description": "4.8★ from 10K+ users"},
  {"text": "Warranty Info", "url": "/", "description": "2-year warranty included"},
  {"text": "Support", "url": "/", "description": "24/7 customer service"}
]
```

**🆕 v4.21 店铺链接特别说明**：
- 店铺链接目标是驱动用户进店探索
- **允许**使用"Shop All"类通用链接（单品链接禁止）
- **可选**包含单品型号增强相关性（不强求）
- **必须**与店铺整体主题相关

---

### 🔍 店铺链接差异化验证检查

**生成完成后，检查以下问题**：

1. **桶角度一致性**：
   - 桶A的标题是否70%+与官方/授权/正品相关？
   - 桶B的标题是否50%+与场景/解决方案相关？
   - 桶C的标题是否50%+与热销/推荐相关？
   - 桶D的标题是否50%+与信任/保障相关？

2. **跨桶差异性**：
   - 5个店铺创意之间是否有明显的主题角度差异？

3. **店铺聚焦一致性**：
   - 所有创意是否都聚焦整个店铺？
   - ✅ 店铺链接**允许**使用"Shop All"类链接
   - ✅ 店铺链接**可以**包含单品型号增强相关性（可选）
   - ❌ 如果需要严格单品聚焦，请使用**单品链接**而非店铺链接

---

## 🆕 v4.21 单品链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：5个差异化创意必须各自专注不同的表达角度

**单品聚焦** + **角度差异化** = 高效A/B测试

**当前桶信息**：
- 桶类型：{{bucket_type}}
- 桶主题：{{bucket_intent}}

---

### 📊 单品链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 |
|---|---------|---------|---------|
| A | Brand-Oriented | 品牌导向 | 强调品牌信誉、官方渠道 |
| B | Scenario-Oriented | 场景导向 | 强调使用场景、问题解决 |
| C | Feature-Oriented | 功能导向 | 强调技术参数、核心卖点 |
| D | High-Intent | 高购买意图 | 强调促销、紧迫感 |
| S | Synthetic | 综合推广 | 整合所有角度 |

---

### 🎯 桶A - 品牌导向策略

**标题分布（15个）**：
- 品牌相关：3个
- 产品信息：6个（必须包含完整型号）
- 促销信息：3个
- 使用场景：3个

---

### 🎯 桶B - 场景导向策略

**标题分布（15个）**：
- 使用场景：6个
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个
- 促销信息：3个

---

### 🎯 桶C - 功能导向策略

**标题分布（15个）**：
- 核心功能：6个
- 产品信息：4个（必须包含完整型号）
- 品牌信息：2个
- 使用场景：3个

---

### 🎯 桶D - 高购买意图策略

**标题分布（15个）**：
- 促销信息：5个
- 产品信息：5个（必须包含完整型号）
- 品牌信息：2个
- 使用场景：3个

---

### 🎯 桶S - 综合推广策略

**标题分布（15个）**：
- 平均分布：各类型约3个

---

## 🆕 v4.21 店铺链接桶类型差异化角度规则 (CRITICAL - 2025-12-26)

### ⚠️ 强制规则：店铺链接的5个差异化创意必须各自专注不同的表达角度

**店铺目标**：驱动用户进店探索，扩大品牌认知

---

### 📊 店铺链接各桶类型的差异化角度定义

| 桶 | 英文主题 | 中文主题 | 核心策略 |
|---|---------|---------|---------|
| A | Brand-Trust | 品牌信任导向 | 官方授权、品牌保障 |
| B | Scene-Solution | 场景解决导向 | 展示产品如何解决用户问题 |
| C | Collection-Highlight | 精选推荐导向 | 店铺热销和推荐产品 |
| D | Trust-Signals | 信任信号导向 | 评价、售后、保障 |
| S | Store-Overview | 店铺全景导向 | 全面展示店铺 |

---

### 🎯 桶A - 品牌信任导向策略

**标题分布（15个）**：
- 品牌相关：8个（官方、授权、正品）
- 场景信息：1个
- 品类信息：1个

---

### 🎯 桶B - 场景解决导向策略

**标题分布（15个）**：
- 品牌信息：2个
- 场景信息：6个
- 品类信息：2个

---

### 🎯 桶C - 精选推荐导向策略

**标题分布（15个）**：
- 品牌信息：4个
- 品类信息：3个
- 信任信号：2个
- 场景信息：1个

---

### 🎯 桶D - 信任信号导向策略

**标题分布（15个）**：
- 品牌信息：3个
- 信任信号：4个（评价、保障、售后）
- 场景信息：2个
- 品类信息：1个

---

### 🎯 桶S - 店铺全景导向策略

**标题分布（15个）**：
- 品牌信息：5个
- 场景信息：3个
- 品类信息：2个

---

## 📋 OUTPUT (JSON only, no markdown):

{
  "headlines": [
    {"text": "...", "type": "brand|feature|promo|cta|urgency|social_proof|question|emotional", "length": N}
  ],
  "descriptions": [
    {"text": "...", "type": "feature-benefit-cta|problem-solution-proof|offer-urgency-trust|usp-differentiation", "length": N}
  ],
  "keywords": ["..."],
  "callouts": ["..."],
  "sitelinks": [{"text": "...", "url": "/", "description": "..."}],
  "path1": "...",
  "path2": "...",
  "theme": "..."
}

**CRITICAL REQUIREMENTS**:
1. You MUST return ONLY valid JSON - no markdown formatting, no explanations, no German/other language text
2. All headlines and descriptions must be in the target language ({{target_language}})
3. All headlines must be ≤30 characters
4. All descriptions must be ≤90 characters
5. Return exactly 15 headlines and 4-5 descriptions
6. Return exactly 6 sitelinks (CRITICAL - 强制要求)
7. **🆕 v4.21: 单品链接 - 至少12/15标题必须包含产品型号（强制）**
8. **🆕 v4.21: 单品链接 - 至少2/6 Sitelinks必须包含产品型号（强制）**
9. **🆕 v4.21: 店铺链接 - Sitelinks可包含产品型号（可选，非强制）**
10. **🆕 v4.21: 店铺链接允许使用"Shop All"类通用链接（单品链接禁止）**
11. **🆕 v4.21: 所有创意必须遵循{{bucket_type}}桶策略**
12. **🆕 v4.21: 5个差异化创意必须有明显角度差异**
13. If you cannot generate valid JSON, return an error message starting with "ERROR:".
14. Ensure ALL creative elements focus on the correct target (single product OR entire store) - no mixed references!
',
    'zh-CN',
    1,
    true,
    'v4.21 修复冲突:
1. 明确Sitelinks强制6个（单品+店铺通用）
2. 单品链接：Sitelink包含型号（强制2个）
3. 店铺链接：Sitelink可含型号（可选）
4. 店铺链接允许使用"Shop All"类通用链接
5. 修复v4.20店铺聚焦与单品型号的冲突规则',
    NOW()
  );

  RAISE NOTICE 'ad_creative_generation v4.21 created and activated';
END $$;

-- 验证
SELECT id, prompt_id, version, is_active, created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY id DESC
LIMIT 5;

-- ✅ Migration complete!
-- ad_creative_generation v4.21 已激活
-- 主要修复：
-- 1. 明确Sitelinks强制6个
-- 2. 单品链接Sitelink包含型号（强制2个）
-- 3. 店铺链接Sitelink可含型号（可选）
-- 4. 店铺链接允许使用"Shop All"类通用链接
-- 5. 修复v4.20店铺聚焦与单品型号的冲突规则

-- ====================================================================
-- SOURCE: pg-migrations/112_prompt_v4.22_reduce_product_model_emphasis.pg.sql
-- ====================================================================
-- Migration: 112_prompt_v4.22_reduce_product_model_emphasis.pg.sql
-- Description: 减少单品型号强制比例，提升创意多样性
-- Date: 2025-12-26
-- Changes:
--   1. Headlines: 80% (12/15) → 40-60% (6-9个) 包含产品型号
--   2. Descriptions: 至少2个 → 建议1-2个 包含产品型号
--   3. Sitelinks: 强制至少2个 → 建议1-2个 包含产品型号
--   4. 新增型号平衡策略：6-9个型号标题 + 6-9个品牌/功能/场景标题

-- PostgreSQL版本：更新prompt版本
-- 1) 如果 v4.22 已存在：仅更新其内容（避免 UNIQUE(prompt_id, version) 冲突）
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            prompt_content,
            '✅ **🆕 v4.21: 至少80% (12/15)标题必须包含完整产品型号**',
            '✅ **🆕 v4.22: 建议40-60% (6-9个)标题包含完整产品型号**'
          ),
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号',
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），建议6-9个标题包含该型号，其余标题可聚焦品牌、功能、场景'
        ),
        '🎯 型号识别度检查**：
 - 生成15个标题后，统计包含产品型号的数量
 - 如果少于12个，重新生成直到满足要求',
        '🎯 型号平衡策略**：
 - 6-9个标题：包含完整产品型号（强调具体产品）
 - 6-9个标题：聚焦品牌、功能、场景（扩大受众覆盖）
 - 保持整体多样性，避免过度重复型号'
      ),
      '✅ **🆕 v4.21: 建议至少2个描述包含产品型号**',
      '✅ **🆕 v4.22: 建议1-2个描述包含产品型号**'
    ),
    '✅ **🆕 v4.21: 强制至少2个Sitelink的text包含产品型号**',
    '✅ **🆕 v4.22: 建议1-2个Sitelink的text包含产品型号**'
  ),
  change_notes = '减少单品型号强制比例：Headlines 80%→40-60%，Descriptions/Sitelinks 2个→1-2个（建议）'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.22';

-- 2) 如果 v4.22 不存在：才把当前 active 的 v4.21 升级为 v4.22
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          REPLACE(
            prompt_content,
            '✅ **🆕 v4.21: 至少80% (12/15)标题必须包含完整产品型号**',
            '✅ **🆕 v4.22: 建议40-60% (6-9个)标题包含完整产品型号**'
          ),
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），则12个标题必须包含该型号',
          '如果产品名包含型号（如"Gen 2", "Pro", "3 Pro", "Air"），建议6-9个标题包含该型号，其余标题可聚焦品牌、功能、场景'
        ),
        '🎯 型号识别度检查**：
 - 生成15个标题后，统计包含产品型号的数量
 - 如果少于12个，重新生成直到满足要求',
        '🎯 型号平衡策略**：
 - 6-9个标题：包含完整产品型号（强调具体产品）
 - 6-9个标题：聚焦品牌、功能、场景（扩大受众覆盖）
 - 保持整体多样性，避免过度重复型号'
      ),
      '✅ **🆕 v4.21: 建议至少2个描述包含产品型号**',
      '✅ **🆕 v4.22: 建议1-2个描述包含产品型号**'
    ),
    '✅ **🆕 v4.21: 强制至少2个Sitelink的text包含产品型号**',
    '✅ **🆕 v4.22: 建议1-2个Sitelink的text包含产品型号**'
  ),
  version = 'v4.22',
  change_notes = '减少单品型号强制比例：Headlines 80%→40-60%，Descriptions/Sitelinks 2个→1-2个（建议）'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true AND version = 'v4.21'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.22'
  );

-- ====================================================================
-- SOURCE: pg-migrations/113_prompt_v4.25_headline_diversity_and_bucket_adaptation.pg.sql
-- ====================================================================
-- Migration: 113_prompt_v4.25_headline_diversity_and_bucket_adaptation.pg.sql
-- Description: 整合v4.23-v4.25：强制5+5+5结构 + 店铺链接例外 + 桶主题适配
-- Date: 2025-12-26
-- Changes:
--   v4.23: 强制3类headline结构(5+5+5)，提升单个创意内部多样性
--   v4.24: 修复店铺链接冲突，5+5+5仅适用单品链接
--   v4.25: 调整5+5+5结构适配桶主题（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）

-- SQLite & PostgreSQL通用版本

-- Step 1: 更新主规则（v4.23 → v4.25，整合店铺链接例外和桶适配）
-- 1) 如果 v4.25 已存在：仅更新其内容（避免 UNIQUE(prompt_id, version) 冲突）
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品',
    '## 🎯 v4.25 单个创意内部多样性 (CRITICAL - 2025-12-26)

### ⚠️ 适用范围：仅适用于单品链接（product link）

**如果是店铺链接（store link）**：
- 遵循 v4.16 店铺链接特殊规则（桶A/B/C/D/S）
- 不适用5+5+5结构
- 参考 {{store_creative_instructions}} 中的创意类型要求

**如果是单品链接（product link）**：
- 强制执行以下5+5+5结构，并根据当前桶主题调整

### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个（适配桶主题）

**桶A（品牌认知 - {{bucket_intent}}）**：
- 类别1 (5个): 品牌+型号（如"Roborock Qrevo Curv 2 Pro: Official"）
- 类别2 (5个): 品牌+品类（如"Roborock Robot Vacuum Sale"）
- 类别3 (5个): 品牌+场景（如"Roborock for Pet Owners"）
→ 确保15个标题都包含品牌词

**桶B（使用场景 - {{bucket_intent}}）**：
- 类别1 (5个): 场景+型号（如"Pet Hair: Qrevo Curv 2 Pro"）
- 类别2 (5个): 场景+品牌（如"Home Cleaning: Roborock"）
- 类别3 (5个): 纯场景描述（如"Pet Hair Solution"）
→ 确保至少10个标题包含场景词

**桶C（功能特性 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+功能（如"Qrevo Curv 2 Pro: 25000Pa"）
- 类别2 (5个): 品牌+功能（如"Roborock: Auto-Empty"）
- 类别3 (5个): 纯功能描述（如"25000Pa Suction Power"）
→ 确保至少10个标题包含功能词

**桶D（价格促销 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+价格（如"Qrevo Curv 2 Pro: -23% Off"）
- 类别2 (5个): 品牌+促销（如"Roborock Sale: Save Now"）
- 类别3 (5个): 纯价格优惠（如"Limited Time Discount"）
→ 确保至少10个标题包含价格/促销词

**桶S（综合 - {{bucket_intent}}）**：
- 类别1 (5个): 产品型号聚焦（如"Qrevo Curv 2 Pro: 25000 Pa"）
- 类别2 (5个): 品牌+品类聚焦（如"Roborock Robot Vacuum"）
- 类别3 (5个): 场景+功能聚焦（如"Pet Hair Cleaning Solution"）
→ 平衡品牌、功能、场景

**✅ 验证检查**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 检查桶主题关键词覆盖率是否达标

## 🎯 v4.21 单品聚焦要求 (已废弃 - 被v4.25替代)'
  ),
  change_notes = '整合v4.23-v4.25：5+5+5结构 + 店铺链接例外 + 桶主题适配（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.25';

-- 2) 如果 v4.25 不存在：才把当前 active 的 v4.22 升级为 v4.25
UPDATE prompt_versions
SET
  prompt_content = REPLACE(
    prompt_content,
    '## 🎯 v4.21 单品聚焦要求 (CRITICAL - 2025-12-25)

### ⚠️ 强制规则：所有创意元素必须100%聚焦单品',
    '## 🎯 v4.25 单个创意内部多样性 (CRITICAL - 2025-12-26)

### ⚠️ 适用范围：仅适用于单品链接（product link）

**如果是店铺链接（store link）**：
- 遵循 v4.16 店铺链接特殊规则（桶A/B/C/D/S）
- 不适用5+5+5结构
- 参考 {{store_creative_instructions}} 中的创意类型要求

**如果是单品链接（product link）**：
- 强制执行以下5+5+5结构，并根据当前桶主题调整

### ⚠️ 强制规则：15个Headlines必须分为3类，每类5个（适配桶主题）

**桶A（品牌认知 - {{bucket_intent}}）**：
- 类别1 (5个): 品牌+型号（如"Roborock Qrevo Curv 2 Pro: Official"）
- 类别2 (5个): 品牌+品类（如"Roborock Robot Vacuum Sale"）
- 类别3 (5个): 品牌+场景（如"Roborock for Pet Owners"）
→ 确保15个标题都包含品牌词

**桶B（使用场景 - {{bucket_intent}}）**：
- 类别1 (5个): 场景+型号（如"Pet Hair: Qrevo Curv 2 Pro"）
- 类别2 (5个): 场景+品牌（如"Home Cleaning: Roborock"）
- 类别3 (5个): 纯场景描述（如"Pet Hair Solution"）
→ 确保至少10个标题包含场景词

**桶C（功能特性 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+功能（如"Qrevo Curv 2 Pro: 25000Pa"）
- 类别2 (5个): 品牌+功能（如"Roborock: Auto-Empty"）
- 类别3 (5个): 纯功能描述（如"25000Pa Suction Power"）
→ 确保至少10个标题包含功能词

**桶D（价格促销 - {{bucket_intent}}）**：
- 类别1 (5个): 型号+价格（如"Qrevo Curv 2 Pro: -23% Off"）
- 类别2 (5个): 品牌+促销（如"Roborock Sale: Save Now"）
- 类别3 (5个): 纯价格优惠（如"Limited Time Discount"）
→ 确保至少10个标题包含价格/促销词

**桶S（综合 - {{bucket_intent}}）**：
- 类别1 (5个): 产品型号聚焦（如"Qrevo Curv 2 Pro: 25000 Pa"）
- 类别2 (5个): 品牌+品类聚焦（如"Roborock Robot Vacuum"）
- 类别3 (5个): 场景+功能聚焦（如"Pet Hair Cleaning Solution"）
→ 平衡品牌、功能、场景

**✅ 验证检查**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 检查桶主题关键词覆盖率是否达标

## 🎯 v4.21 单品聚焦要求 (已废弃 - 被v4.25替代)'
  ),
  version = 'v4.25',
  change_notes = '整合v4.23-v4.25：5+5+5结构 + 店铺链接例外 + 桶主题适配（桶A全品牌/桶B场景/桶C功能/桶D价格/桶S平衡）'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true AND version = 'v4.22'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.25'
  );

-- Step 2: 更新所有v4.22版本标记为v4.25
UPDATE prompt_versions
SET
  prompt_content = REPLACE(prompt_content, '🆕 v4.22:', '🆕 v4.25:'),
  name = '广告创意生成v4.25 - 5+5+5结构+桶主题适配版'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.25';

-- ====================================================================
-- SOURCE: pg-migrations/114_prompt_v4.26_clean.pg.sql
-- ====================================================================
-- Migration: 114_prompt_v4.26_clean.pg.sql
-- Description: v4.26 完整重写 - 整合所有功能，解决历史冲突
-- Date: 2025-12-26
-- PostgreSQL 版本

-- 1) 如果 v4.26 已存在：仅更新其内容（避免 UNIQUE(prompt_id, version) 冲突）
UPDATE prompt_versions
SET
  prompt_content = '-- ============================================
-- Google Ads 广告创意生成 v4.26 (2025-12-26)
-- 完整重写版 - 整合所有功能，解决历史冲突
-- ============================================

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## 输出格式
JSON格式：
{
  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符
  "descriptions": ["描述1", "描述2", ...],  // 5个，每个≤90字符
  "keywords": ["关键词1", "关键词2", ...],  // 10-15个
  "sitelinks": [  // 6个
    {"text": "链接文本", "url": "/", "description": "链接描述"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 所有标题 ≤30字符，所有描述 ≤90字符
3. 恰好15个标题，恰好5个描述，恰好6个Sitelinks
4. 所有创意元素必须与单品/店铺链接类型一致

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## 关键词使用规则
{{ai_keywords_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 5/5 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：5+5+5 (CRITICAL)

15个标题必须分为3类，每类恰好5个：

### 类别1 - 产品型号聚焦 (5个)
- 必须包含完整产品型号
- 示例："Qrevo Curv 2 Pro: 25000 Pa", "Gen 2: Sleep Tracking"
- 这5个标题帮助用户快速识别具体产品

### 类别2 - 品牌+品类聚焦 (5个)
- 包含品牌名 + 品类词，不提具体型号
- 示例："Roborock Robot Vacuum Sale", "Aspirateur Roborock Officiel"
- 这5个标题覆盖品牌认知用户

### 类别3 - 场景+功能聚焦 (5个)
- 聚焦使用场景、核心功能或用户痛点
- 可以不提品牌，强调通用价值
- 示例："Nettoyage Auto pour Animaux", "Aspiration 25000Pa"
- 这5个标题覆盖场景搜索用户

**验证规则**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 如果不符合，重新生成

## 描述结构：2+2+1 (CRITICAL)

5个描述必须分为3类：

### 类别1 - 产品型号聚焦 (2个)
- 包含产品型号 + 核心功能

### 类别2 - 品牌+品类聚焦 (2个)
- 包含品牌名 + 应用场景

### 类别3 - 功能痛点解决 (1个)
- 纯功能/痛点解决方案

**每个描述必须包含明确CTA**：
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours

## Sitelinks结构：2+2+2 (CRITICAL)

6个Sitelinks必须分为3类：

### 类别1 - 产品型号 (2个)
- 包含产品型号的链接

### 类别2 - 品牌+品类 (2个)
- 品牌+品类导向的链接

### 类别3 - 功能+场景 (2个)
- 功能/场景导向的链接

## 单品链接特殊规则

**如果是单品链接（product link）**：
- 所有创意元素必须100%聚焦单品
- 禁止提到"browse our collection"
- 禁止提到其他品类名称

## 店铺链接特殊规则

**如果是店铺链接（store link）**：
- 目标：驱动用户进店探索
- **允许**使用"Shop All"类通用链接
- **可以**包含单品型号（可选）
- 必须与店铺整体主题相关

## 桶类型适配 (CRITICAL)

根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌认知）
- 全部15个标题必须包含品牌词
- 强调官方、正品、信任

### 桶B（使用场景）
- 至少10个标题包含场景词（pet, home, family...）
- 强调使用场景和用户痛点

### 桶C（功能特性）
- 至少10个标题包含功能词（suction, power, heat...）
- 强调技术参数和独特功能

### 桶D（价格促销）
- 至少10个标题包含价格/促销词
- 强调折扣、限时、性价比

### 桶S（综合平衡）
- 平衡品牌、功能、场景
- 适合全面覆盖

## 本地化规则

### 货币符号
- US: USD ($)
- UK: GBP (£)
- EU: EUR (€)

### 紧急感本地化
- US/UK: "Limited Time", "Today Only"
- DE: "Nur heute", "Oferta limitada"
- JA: "今だけ", "期間制限"

## 质量检查清单

生成后检查：
- [ ] 15个标题恰好5+5+5分类
- [ ] 5个描述包含明确CTA
- [ ] 6个Sitelinks完整
- [ ] 所有元素与单品/店铺类型一致
- [ ] 关键词嵌入率达标
- [ ] 桶主题覆盖率达标

如果不满足任何关键要求，重新生成。',
  name = '广告创意生成v4.26 - 完整重写版',
  change_notes = 'v4.26 完整重写：5+5+5标题 + 2+2+1描述 + 2+2+2 Sitelinks + 桶类型适配'
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.26';

-- 2) 如果 v4.26 不存在：才把当前 active 的 v4.25 升级为 v4.26
UPDATE prompt_versions
SET
  prompt_content = '-- ============================================
-- Google Ads 广告创意生成 v4.26 (2025-12-26)
-- 完整重写版 - 整合所有功能，解决历史冲突
-- ============================================

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## 输出格式
JSON格式：
{
  \"headlines\": [\"标题1\", \"标题2\", ...],  // 15个，每个≤30字符
  \"descriptions\": [\"描述1\", \"描述2\", ...],  // 5个，每个≤90字符
  \"keywords\": [\"关键词1\", \"关键词2\", ...],  // 10-15个
  \"sitelinks\": [  // 6个
    {\"text\": \"链接文本\", \"url\": \"/\", \"description\": \"链接描述\"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 所有标题 ≤30字符，所有描述 ≤90字符
3. 恰好15个标题，恰好5个描述，恰好6个Sitelinks
4. 所有创意元素必须与单品/店铺链接类型一致

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## 关键词使用规则
{{ai_keywords_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 5/5 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：5+5+5 (CRITICAL)

15个标题必须分为3类，每类恰好5个：

### 类别1 - 产品型号聚焦 (5个)
- 必须包含完整产品型号
- 示例：\"Qrevo Curv 2 Pro: 25000 Pa\", \"Gen 2: Sleep Tracking\"
- 这5个标题帮助用户快速识别具体产品

### 类别2 - 品牌+品类聚焦 (5个)
- 包含品牌名 + 品类词，不提具体型号
- 示例：\"Roborock Robot Vacuum Sale\", \"Aspirateur Roborock Officiel\"
- 这5个标题覆盖品牌认知用户

### 类别3 - 场景+功能聚焦 (5个)
- 聚焦使用场景、核心功能或用户痛点
- 可以不提品牌，强调通用价值
- 示例：\"Nettoyage Auto pour Animaux\", \"Aspiration 25000Pa\"
- 这5个标题覆盖场景搜索用户

**验证规则**：
- 生成后统计每类数量，必须恰好5+5+5=15
- 如果不符合，重新生成

## 描述结构：2+2+1 (CRITICAL)

5个描述必须分为3类：

### 类别1 - 产品型号聚焦 (2个)
- 包含产品型号 + 核心功能

### 类别2 - 品牌+品类聚焦 (2个)
- 包含品牌名 + 应用场景

### 类别3 - 功能痛点解决 (1个)
- 纯功能/痛点解决方案

**每个描述必须包含明确CTA**：
- CTA示例：Shop Now, Buy Today, Order Now, Get Yours

## Sitelinks结构：2+2+2 (CRITICAL)

6个Sitelinks必须分为3类：

### 类别1 - 产品型号 (2个)
- 包含产品型号的链接

### 类别2 - 品牌+品类 (2个)
- 品牌+品类导向的链接

### 类别3 - 功能+场景 (2个)
- 功能/场景导向的链接

## 单品链接特殊规则

**如果是单品链接（product link）**：
- 所有创意元素必须100%聚焦单品
- 禁止提到\"browse our collection\"
- 禁止提到其他品类名称

## 店铺链接特殊规则

**如果是店铺链接（store link）**：
- 目标：驱动用户进店探索
- **允许**使用\"Shop All\"类通用链接
- **可以**包含单品型号（可选）
- 必须与店铺整体主题相关

## 桶类型适配 (CRITICAL)

根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌认知）
- 全部15个标题必须包含品牌词
- 强调官方、正品、信任

### 桶B（使用场景）
- 至少10个标题包含场景词（pet, home, family...）
- 强调使用场景和用户痛点

### 桶C（功能特性）
- 至少10个标题包含功能词（suction, power, heat...）
- 强调技术参数和独特功能

### 桶D（价格促销）
- 至少10个标题包含价格/促销词
- 强调折扣、限时、性价比

### 桶S（综合平衡）
- 平衡品牌、功能、场景
- 适合全面覆盖

## 本地化规则

### 货币符号
- US: USD ($)
- UK: GBP (£)
- EU: EUR (€)

### 紧急感本地化
- US/UK: \"Limited Time\", \"Today Only\"
- DE: \"Nur heute\", \"Oferta limitada\"
- JA: \"今だけ\", \"期間制限\"

## 质量检查清单

生成后检查：
- [ ] 15个标题恰好5+5+5分类
- [ ] 5个描述包含明确CTA
- [ ] 6个Sitelinks完整
- [ ] 所有元素与单品/店铺类型一致
- [ ] 关键词嵌入率达标
- [ ] 桶主题覆盖率达标

如果不满足任何关键要求，重新生成。',
  version = 'v4.26',
  name = '广告创意生成v4.26 - 完整重写版',
  change_notes = 'v4.26 完整重写：5+5+5标题 + 2+2+1描述 + 2+2+2 Sitelinks + 桶类型适配'
WHERE prompt_id = 'ad_creative_generation' AND is_active = true AND version = 'v4.25'
  AND NOT EXISTS (
    SELECT 1 FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.26'
  );

-- ====================================================================
-- SOURCE: pg-migrations/115_prompt_v4.30_final.pg.sql
-- ====================================================================
-- Migration: Prompt v4.30 - 明确Keywords数量+精简标记
-- Date: 2025-12-26
-- Description: Keywords统一为15个，减少CRITICAL标记，优化用词

-- 删除可能存在的 v4.30（幂等性）
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.30';

-- 停用旧版本
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- 插入新版本 v4.30
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  is_active,
  created_at
) VALUES (
  'ad_creative_generation',
  'v4.30',
  '广告创意生成',
  '广告创意生成v4.30 - 明确Keywords数量+精简标记',
  'Keywords统一为15个，减少CRITICAL标记，优化用词',
  'src/lib/ad-creative-generator.ts',
  'generateAdCreative',
  '-- ============================================
## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## ⚠️ 字符限制（CRITICAL - 必须严格遵守）

生成时必须控制长度，不得依赖后端截断：
- **Headlines**: 每个≤30字符（含空格、标点）
- **Descriptions**: 每个≤90字符（含空格、标点）
- **Callouts**: 每个≤25字符
- **Sitelink text**: 每个≤25字符
- **Sitelink description**: 每个≤35字符

**验证方法**：生成每个元素后立即检查字符数，超长则重写为更短版本。

## 输出格式
JSON格式：
{
  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符
  "descriptions": ["描述1", "描述2", "描述3", "描述4"],  // 4个，每个≤90字符
  "keywords": ["关键词1", "关键词2", ...],  // 15个
  "callouts": ["卖点1", "卖点2", "卖点3", "卖点4", "卖点5", "卖点6"],  // 6个，每个≤25字符
  "sitelinks": [  // 6个
    {"text": "≤25字符", "url": "/", "description": "≤35字符"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks
3. 所有创意元素必须与单品/店铺链接类型一致
4. 每个元素必须语义完整，不得因字符限制而截断句子

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## 关键词使用规则
{{ai_keywords_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：5+5+5 

15个标题必须分为3类，每类5个：

### 类别1 - 产品型号聚焦 (5个)
- 必须包含完整产品型号
- 第1个标题必须使用动态关键词插入：{KeyWord:品牌名}
- 示例（≤30字符）：
  * "{KeyWord:Roborock} Official" (26字符)
  * "Qrevo Curv 2 Pro: 25000 Pa" (27字符)
  * "Gen 2: Sleep Tracking" (23字符)

### 类别2 - 利益导向聚焦 (5个) ⭐
- 强调用户获得的利益和价值，而非产品特性
- 示例（≤30字符）：
  * "Gagnez 2h par Semaine" (22字符)
  * "Maison Propre Sans Effort" (26字符)
  * "Save 2 Hours Weekly" (19字符)
  * "Effortless Clean Home" (21字符)
  * "No More Pet Hair Mess" (21字符)

### 类别3 - 行动号召聚焦 (5个) ⭐
- 使用多样化结构，驱动点击
- 结构类型（每种至少1个）：
  * 疑问句："Need a Smarter Vacuum?" (24字符)
  * 紧迫感："Limited Time: Save 23%" (23字符)
  * 社交证明："5000+ Clients Satisfaits" (25字符)
  * 直接CTA："Shop Official Store" (19字符)
  * 独特卖点："Only 100°C Mop Cleaning" (24字符)

## 描述结构：2+1+1 (CRITICAL) ⭐

4个描述必须分为3类，每个≤90字符且语义完整：

### 类别1 - 产品型号+核心功能 (2个)
- 包含产品型号 + 2-3个核心功能 + CTA
- 示例（≤90字符）：
  * "Roborock Qrevo Curv 2 Pro: 25000Pa suction, 100°C mop. Save 23%. Shop now." (78字符)
  * "Gen 2 with sleep tracking & heart rate. Limited offer. Order today." (69字符)

### 类别2 - 利益驱动 (1个) ⭐
- 聚焦用户获得的利益和生活改善
- 示例（≤90字符）：
  * "Save 2 hours weekly with auto cleaning. Perfect for pet owners. Buy now." (75字符)

### 类别3 - 信任+紧迫感 (1个) ⭐
- 结合社交证明、保障和限时优惠
- 示例（≤90字符）：
  * "5000+ satisfied customers. 2-year warranty. Free shipping. Limited -23%. Order today." (87字符)

**每个描述必须包含明确CTA**：
- CTA示例：Shop now, Buy now, Order today, Get yours

## Callouts结构：2+2+2 

6个Callouts必须分为3类，每个≤25字符：

### 类别1 - 信任信号 (2个)
示例：
- "Official Store" (14字符)
- "2-Year Warranty" (15字符)

### 类别2 - 优惠促销 (2个)
示例：
- "Free Shipping" (13字符)
- "Limited Time -23%" (17字符)

### 类别3 - 产品特性 (2个)
示例：
- "25000Pa Suction" (15字符)
- "100°C Mop Cleaning" (18字符)

## Sitelinks结构：2+2+2 

6个Sitelinks，每个text≤25字符，description≤35字符：

### 类别1 - 产品型号 (2个)
示例：
- text: "Qrevo Curv 2 Pro" (16字符)
  description: "25000Pa suction, 100°C mop" (27字符)

### 类别2 - 品牌+品类 (2个)
示例：
- text: "Roborock Vacuums" (17字符)
  description: "Official store, free shipping" (31字符)

### 类别3 - 功能+场景 (2个)
示例：
- text: "Pet Hair Solution" (17字符)
  description: "Auto cleaning for pet owners" (29字符)

## 单品链接特殊规则

**如果是单品链接（product link）**：
- 所有创意元素必须100%聚焦单品
- 禁止提到"browse our collection"
- 禁止提到其他品类名称

## 店铺链接特殊规则

**如果是店铺链接（store link）**：
- 目标：驱动用户进店探索
- **允许**使用"Shop All"类通用链接
- **可以**包含单品型号（可选）
- 必须与店铺整体主题相关

## 桶类型适配 

根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌认知）
- 全部15个标题必须包含品牌词
- 强调官方、正品、信任

### 桶B（使用场景）
- 至少10个标题包含场景词（pet, home, family...）
- 强调使用场景和用户痛点

### 桶C（功能特性）
- 至少10个标题包含功能词（suction, power, heat...）
- 强调技术参数和独特功能

### 桶D（价格促销）
- 至少10个标题包含价格/促销词
- 强调折扣、限时、性价比

### 桶S（综合平衡）
- 平衡品牌、功能、场景
- 适合全面覆盖

## 本地化规则

### 货币符号
- US: USD ($)
- UK: GBP (£)
- EU: EUR (€)

### 紧急感本地化
- US/UK: "Limited Time", "Today Only"
- DE: "Nur heute", "Zeitlich begrenzt"
- FR: "Offre limitée", "Aujourd''hui seulement"
- JA: "今だけ", "期間限定"

## 质量检查清单

生成后检查：
- [ ] 所有headlines ≤30字符且语义完整
- [ ] 所有descriptions ≤90字符且语义完整
- [ ] 所有callouts ≤25字符（6个）
- [ ] 所有sitelink text ≤25字符
- [ ] 所有sitelink description ≤35字符
- [ ] 15个标题分为5+5+5
- [ ] 4个描述包含明确CTA
- [ ] 6个Callouts分为2+2+2
- [ ] 6个Sitelinks完整
- [ ] 15个关键词
- [ ] 关键词嵌入率达标
- [ ] 至少2个疑问句标题
- [ ] 至少2个利益导向标题

如果不满足任何关键要求，重新生成。',
  true,
  NOW()
);

-- ====================================================================
-- SOURCE: pg-migrations/116_prompt_v4.31_ad_strength_optimization.pg.sql
-- ====================================================================
-- Migration: 116_prompt_v4.31_ad_strength_optimization.pg.sql
-- Description: Ad Strength优化版 - 增加类型多样性、紧迫感、CTA要求
-- Date: 2025-12-26
-- Changes:
--   1. 标题结构从5+5+5改为2+4+4+2+3（5种类型，提升Type Distribution得分）
--   2. 新增问题型标题（2个，以?结尾）
--   3. 对比/紧迫型标题要求至少1个包含紧迫感关键词
--   4. 品牌名约束：最多出现3次（降低重复率）
--   5. 产品全名约束：最多出现2次
--   6. 所有描述必须以英文CTA结尾（Shop Now / Buy Now / Get Yours / Order Now）
--   7. 预期效果：Quality 7→13, Diversity 11→18, Overall 78-80→91-93

-- Step 1: 删除可能存在的 v4.31（幂等性）
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.31';

-- Step 2: 停用当前active版本
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation' AND is_active = true;

-- Step 3: 插入新版本 v4.31
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  is_active,
  created_by,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.31',
  '广告创意生成',
  '广告创意生成v4.31 - Ad Strength优化版',
  'Ad Strength优化版：增加类型多样性、紧迫感、CTA要求',
  'prompts/ad_creative_generation_v4.31.txt',
  'generateAdCreative',
  '-- ============================================
## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## ⚠️ 字符限制（CRITICAL - 必须严格遵守）

生成时必须控制长度，不得依赖后端截断：
- **Headlines**: 每个≤30字符（含空格、标点）
- **Descriptions**: 每个≤90字符（含空格、标点）
- **Callouts**: 每个≤25字符
- **Sitelink text**: 每个≤25字符
- **Sitelink description**: 每个≤35字符

**验证方法**：生成每个元素后立即检查字符数，超长则重写为更短版本。

## 输出格式
JSON格式：
{
  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符
  "descriptions": ["描述1", "描述2", "描述3", "描述4"],  // 4个，每个≤90字符
  "keywords": ["关键词1", "关键词2", ...],  // 15个
  "callouts": ["卖点1", "卖点2", "卖点3", "卖点4", "卖点5", "卖点6"],  // 6个，每个≤25字符
  "sitelinks": [  // 6个
    {"text": "≤25字符", "url": "/", "description": "≤35字符"}
  ]
}

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks
3. 所有创意元素必须与单品/店铺链接类型一致
4. 每个元素必须语义完整，不得因字符限制而截断句子

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}
{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## 关键词使用规则
{{ai_keywords_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量>1000的关键词
- 品牌词必须在至少2个标题中出现

## 标题结构：2+4+4+2+3 (Ad Strength优化版) ⭐

15个标题必须分为5类，确保类型多样性（Type Distribution得分）：

### 类别1 - 品牌型 (2个)
- 包含品牌名和产品名
- 第1个标题必须使用动态关键词插入：{KeyWord:品牌名}
- 示例（≤30字符）：
  * "{KeyWord:Roborock} Official" (26字符)
  * "Roborock Qrevo Curv 2 Pro" (25字符)

### 类别2 - 功能型 (4个)
- 突出技术参数和功能特性
- 必须包含具体数字或技术名称
- 示例（≤30字符）：
  * "25000 Pa Suction Power" (22字符)
  * "100°C Hot Water Mop Washing" (27字符)
  * "AdaptiLift Chassis Tech" (23字符)
  * "7-Week Hands-Free Cleaning" (26字符)

### 类别3 - 利益型 (4个)
- 强调用户获得的利益和价值
- 示例（≤30字符）：
  * "Maison Propre Sans Effort" (26字符)
  * "Gagnez du Temps Chaque Jour" (27字符)
  * "Idéal Pour Poils d''Animaux" (26字符)
  * "Un Sol Toujours Impeccable" (26字符)

### 类别4 - 问题型 (2个) ⭐ 新增
- 以问题引发用户共鸣
- 必须以问号结尾
- 示例（≤30字符）：
  * "Tired of Pet Hair?" (19字符)
  * "Want a Truly Clean Floor?" (25字符)
  * "Besoin d''un Sol Impeccable?" (28字符)

### 类别5 - 对比/紧迫型 (3个) ⭐ 优化
- 突出竞争优势或紧迫感
- **至少1个必须包含紧迫感关键词**（Limited / Today / Now / Exclusive / Ends Soon / Last Chance / Limité / Limitée / Aujourd''hui）
- 示例（≤30字符）：
  * "Why Choose Qrevo Curv 2 Pro?" (29字符)
  * "Best Robot Vacuum for Pets" (26字符)
  * "Limited Time: Save 23%" (23字符)

**品牌名约束（避免过度重复）**：
- 品牌名"{{brand}}"最多出现3次
- 产品全名"{{product_name}}"最多出现2次
- 其他标题使用产品名变体或聚焦功能/利益

## 描述结构：2+1+1 (Ad Strength优化版) ⭐

4个描述必须分为3类，每个≤90字符且语义完整：

### 类别1 - 产品型号+核心功能 (2个)
- 包含产品型号 + 2-3个核心功能 + **英文CTA**
- **每个描述必须以明确的英文CTA结尾**：Shop Now / Buy Now / Get Yours / Order Now / Learn More
- 示例（≤90字符）：
  * "Roborock Qrevo Curv 2 Pro: 25000Pa suction, 100°C mop. Save 23%. Shop Now!" (78字符)
  * "Découvrez le Roborock Qrevo Curv 2 Pro. Châssis AdaptiLift. -23%. Buy Now!" (77字符)

### 类别2 - 利益驱动 (1个) ⭐
- 聚焦用户获得的利益和生活改善 + **英文CTA**
- 示例（≤90字符）：
  * "Gagnez du temps chaque jour. Parfait pour les animaux et tapis. Get Yours!" (77字符)

### 类别3 - 信任+紧迫感 (1个) ⭐
- 结合社交证明、保障和限时优惠 + **英文CTA**
- 示例（≤90字符）：
  * "5000+ clients satisfaits. Garantie 2 ans. Offre -23% limitée. Order Now!" (76字符)

**CTA要求（CRITICAL）**：
- 每个描述必须以英文CTA结尾（Google Ads最佳实践）
- CTA选项：Shop Now / Buy Now / Get Yours / Order Now / Learn More / Start Now
- CTA前可以用句号或感叹号分隔

## Callouts结构：2+2+2

6个Callouts必须分为3类，每个≤25字符：

### 类别1 - 信任信号 (2个)
示例：
- "Official Store" (14字符)
- "2-Year Warranty" (15字符)

### 类别2 - 优惠促销 (2个)
示例：
- "Free Shipping" (13字符)
- "Limited Time -23%" (17字符)

### 类别3 - 产品特性 (2个)
示例：
- "25000Pa Suction" (15字符)
- "100°C Mop Cleaning" (18字符)

## Sitelinks结构：2+2+2

6个Sitelinks，每个text≤25字符，description≤35字符：

### 类别1 - 产品型号 (2个)
示例：
- text: "Qrevo Curv 2 Pro" (16字符)
  description: "25000Pa suction, 100°C mop" (27字符)

### 类别2 - 品牌+品类 (2个)
示例：
- text: "Roborock Vacuums" (17字符)
  description: "Official store, free shipping" (31字符)

### 类别3 - 功能+场景 (2个)
示例：
- text: "Pet Hair Solution" (17字符)
  description: "Auto cleaning for pet owners" (29字符)

## 单品链接特殊规则

**如果是单品链接（product link）**：
- 所有创意元素必须100%聚焦单品
- 禁止提到"browse our collection"
- 禁止提到其他品类名称

## 店铺链接特殊规则

**如果是店铺链接（store link）**：
- 目标：驱动用户进店探索
- **允许**使用"Shop All"类通用链接
- **可以**包含单品型号（可选）
- 必须与店铺整体主题相关

## 桶类型适配

根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌认知）
- 全部15个标题必须包含品牌词
- 强调官方、正品、信任

### 桶B（使用场景）
- 至少10个标题包含场景词（pet, home, family...）
- 强调使用场景和用户痛点

### 桶C（功能特性）
- 至少10个标题包含功能词（suction, power, heat...）
- 强调技术参数和独特功能

### 桶D（价格促销）
- 至少10个标题包含价格/促销词
- 强调折扣、限时、性价比

### 桶S（综合平衡）
- 平衡品牌、功能、场景
- 适合全面覆盖

## 本地化规则

### 货币符号
- US: USD ($)
- UK: GBP (£)
- EU: EUR (€)

### 紧急感本地化
- US/UK: "Limited Time", "Today Only"
- DE: "Nur heute", "Zeitlich begrenzt"
- FR: "Offre limitée", "Aujourd''hui seulement"
- JA: "今だけ", "期間限定"

## 质量检查清单（Ad Strength优化版）⭐

生成后检查：
- [ ] 所有headlines ≤30字符且语义完整
- [ ] 所有descriptions ≤90字符且语义完整
- [ ] 所有callouts ≤25字符（6个）
- [ ] 所有sitelink text ≤25字符
- [ ] 所有sitelink description ≤35字符
- [ ] 15个标题分为2+4+4+2+3（5种类型）
- [ ] 至少2个问题型标题（以?结尾）
- [ ] 至少1个紧迫感标题（包含Limited/Today/Now等）
- [ ] 品牌名最多出现3次
- [ ] 产品全名最多出现2次
- [ ] 4个描述全部包含英文CTA结尾
- [ ] 6个Callouts分为2+2+2
- [ ] 6个Sitelinks完整
- [ ] 15个关键词
- [ ] 关键词嵌入率达标

如果不满足任何关键要求，重新生成。',
  true,
  NULL,
  'Ad Strength优化版：
1. 标题结构从5+5+5改为2+4+4+2+3（5种类型）
2. 新增问题型标题（2个）
3. 对比/紧迫型标题要求至少1个包含紧迫感关键词
4. 品牌名约束：最多3次
5. 产品全名约束：最多2次
6. 所有描述必须以英文CTA结尾
7. 预期效果：Quality 7→13, Diversity 11→18, Overall 78-80→91-93'
);

-- Step 4: 验证插入
SELECT prompt_id, version, name, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY created_at DESC
LIMIT 3;

-- ====================================================================
-- SOURCE: pg-migrations/117_prompt_v4.32_brand_coverage_optimization.pg.sql
-- ====================================================================
-- Migration: 117_prompt_v4.32_brand_coverage_optimization.pg.sql
-- Description: 品牌词覆盖率优化 - 平衡品牌认知与多样性
-- Date: 2025-12-27
-- Changes:
--   1. 品牌词约束：从"最多3次"改为"3-4次"（平衡覆盖率与多样性）
--   2. 明确品牌词变体使用（Official, Store, The Brand）
--   3. 添加品牌词覆盖率检查（20-27%）
--   4. 添加产品名覆盖率检查（13%）
--   5. 修复质量检查清单与描述一致的冲突

-- Step 1: 删除可能存在的 v4.32（幂等性）
DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.32';

-- Step 2: 停用当前active版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- Step 3: 插入新版本 v4.32
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  is_active,
  created_by,
  change_notes
) VALUES (
  'ad_creative_generation',
  'v4.32',
  '广告创意生成',
  '广告创意生成v4.32 - 品牌词覆盖率优化',
  '品牌词覆盖率优化：平衡品牌认知与多样性',
  'prompts/ad_creative_generation_v4.32.txt',
  'generateAdCreative',
  E'-- ============================================\n## 任务\n为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。\n\n## ⚠️ 字符限制（CRITICAL - 必须严格遵守）\n\n生成时必须控制长度，不得依赖后端截断：\n- **Headlines**: 每个≤30字符（含空格、标点）\n- **Descriptions**: 每个≤90字符（含空格、标点）\n- **Callouts**: 每个≤25字符\n- **Sitelink text**: 每个≤25字符\n- **Sitelink description**: 每个≤35字符\n\n**验证方法**：生成每个元素后立即检查字符数，超长则重写为更短版本。\n\n## 输出格式\nJSON格式：\n{\n  "headlines": ["标题1", "标题2", ...],  // 15个，每个≤30字符\n  "descriptions": ["描述1", "描述2", "描述3", "描述4"],  // 4个，每个≤90字符\n  "keywords": ["关键词1", "关键词2", ...],  // 15个\n  "callouts": ["卖点1", "卖点2", "卖点3", "卖点4", "卖点5", "卖点6"],  // 6个，每个≤25字符\n  "sitelinks": [  // 6个\n    {"text": "≤25字符", "url": "/", "description": "≤35字符"}\n  ]\n}\n\n## 基本要求\n1. 所有内容必须使用目标语言：{{target_language}}\n2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks\n3. 所有创意元素必须与单品/店铺链接类型一致\n4. 每个元素必须语义完整，不得因字符限制而截断句子\n\n## 语言指令\n{{language_instruction}}\n\n## 产品/店铺信息\n{{link_type_section}}\n\nPRODUCT: {{product_description}}\nUSPs: {{unique_selling_points}}\nAUDIENCE: {{target_audience}}\nCOUNTRY: {{target_country}} | LANGUAGE: {{target_language}}\n\n{{enhanced_features_section}}\n{{localization_section}}\n{{brand_analysis_section}}\n{{extras_data}}\n{{promotion_section}}\n{{theme_section}}\n{{reference_performance_section}}\n{{extracted_elements_section}}\n\n## 关键词使用规则\n{{ai_keywords_section}}\n\n**关键词嵌入规则**：\n- 8/15 (53%+) 标题必须包含关键词\n- 4/4 (100%) 描述必须包含关键词\n- 优先使用搜索量>1000的关键词\n- 品牌词必须在至少2个标题中出现\n\n## 标题结构：2+4+4+2+3 (Ad Strength优化版) ⭐\n\n15个标题必须分为5类，确保类型多样性（Type Distribution得分）：\n\n### 类别1 - 品牌型 (2个)\n- 包含品牌名和产品名\n- 第1个标题必须使用动态关键词插入：{KeyWord:品牌名}\n- 示例（≤30字符）：\n  * "{KeyWord:Roborock} Official" (26字符)\n  * "Roborock Qrevo Curv 2 Pro" (25字符)\n\n### 类别2 - 功能型 (4个)\n- 突出技术参数和功能特性\n- 必须包含具体数字或技术名称\n- 示例（≤30字符）：\n  * "25000 Pa Suction Power" (22字符)\n  * "100°C Hot Water Mop Washing" (27字符)\n  * "AdaptiLift Chassis Tech" (23字符)\n  * "7-Week Hands-Free Cleaning" (26字符)\n\n### 类别3 - 利益型 (4个)\n- 强调用户获得的利益和价值\n- 示例（≤30字符）：\n  * "Maison Propre Sans Effort" (26字符)\n  * "Gagnez du Temps Chaque Jour" (27字符)\n  * "Idéal Pour Poils d''Animaux" (26字符)\n  * "Un Sol Toujours Impeccable" (26字符)\n\n### 类别4 - 问题型 (2个) ⭐ 新增\n- 以问题引发用户共鸣\n- 必须以问号结尾\n- 示例（≤30字符）：\n  * "Tired of Pet Hair?" (19字符)\n  * "Want a Truly Clean Floor?" (25字符)\n  * "Besoin d''un Sol Impeccable?" (28字符)\n\n### 类别5 - 对比/紧迫型 (3个) ⭐ 优化\n- 突出竞争优势或紧迫感\n- **至少1个必须包含紧迫感关键词**（Limited / Today / Now / Exclusive / Ends Soon / Last Chance / Limité / Limitée / Aujourd''hui）\n- 示例（≤30字符）：\n  * "Why Choose Qrevo Curv 2 Pro?" (29字符)\n  * "Best Robot Vacuum for Pets" (26字符)\n  * "Limited Time: Save 23%" (23字符)\n\n**品牌词覆盖率优化（平衡品牌认知与多样性）**：\n- 品牌词"{{brand}}"出现次数：**3-4次**（覆盖率20-27%）\n  - 至少3个标题包含品牌词（确保品牌认知）\n  - 最多4个标题包含品牌词（避免过度重复影响多样性）\n- 完整产品名"{{product_name}}"出现次数：**2次**（确保产品精准匹配）\n- 品牌词变体可混合使用："{KeyWord:{{brand}}} Official", "{{brand}} Store", "The {{brand}}"\n- 类别1的2个品牌型标题必须包含品牌词\n\n**品牌词覆盖率检查**：\n- ✅ 品牌词覆盖率 = 包含品牌词的标题数 / 15，范围20-27%（3-4个标题）\n- ✅ 产品名覆盖率 = 包含产品名的标题数 / 15，约为13%（2个标题）\n- ✅ 如果品牌词覆盖不足3个，AI必须补充品牌词标题\n- ✅ 如果品牌词覆盖超过4个，AI必须减少品牌词使用\n\n## 描述结构：2+1+1 (Ad Strength优化版) ⭐\n\n4个描述必须分为3类，每个≤90字符且语义完整：\n\n### 类别1 - 产品型号+核心功能 (2个)\n- 包含产品型号 + 2-3个核心功能 + **英文CTA**\n- **每个描述必须以明确的英文CTA结尾**：Shop Now / Buy Now / Get Yours / Order Now / Learn More\n- 示例（≤90字符）：\n  * "Roborock Qrevo Curv 2 Pro: 25000Pa suction, 100°C mop. Save 23%. Shop Now!" (78字符)\n  * "Découvrez le Roborock Qrevo Curv 2 Pro. Châssis AdaptiLift. -23%. Buy Now!" (77字符)\n\n### 类别2 - 利益驱动 (1个) ⭐\n- 聚焦用户获得的利益和生活改善 + **英文CTA**\n- 示例（≤90字符）：\n  * "Gagnez du temps chaque jour. Parfait pour les animaux et tapis. Get Yours!" (77字符)\n\n### 类别3 - 信任+紧迫感 (1个) ⭐\n- 结合社交证明、保障和限时优惠 + **英文CTA**\n- 示例（≤90字符）：\n  * "5000+ clients satisfaits. Garantie 2 ans. Offre -23% limitée. Order Now!" (76字符)\n\n**CTA要求（CRITICAL）**：\n- 每个描述必须以英文CTA结尾（Google Ads最佳实践）\n- CTA选项：Shop Now / Buy Now / Get Yours / Order Now / Learn More / Start Now\n- CTA前可以用句号或感叹号分隔\n\n## Callouts结构：2+2+2\n\n6个Callouts必须分为3类，每个≤25字符：\n\n### 类别1 - 信任信号 (2个)\n示例：\n- "Official Store" (14字符)\n- "2-Year Warranty" (15字符)\n\n### 类别2 - 优惠促销 (2个)\n示例：\n- "Free Shipping" (13字符)\n- "Limited Time -23%" (17字符)\n\n### 类别3 - 产品特性 (2个)\n示例：\n- "25000Pa Suction" (15字符)\n- "100°C Mop Cleaning" (18字符)\n\n## Sitelinks结构：2+2+2\n\n6个Sitelinks，每个text≤25字符，description≤35字符：\n\n### 类别1 - 产品型号 (2个)\n示例：\n- text: "Qrevo Curv 2 Pro" (16字符)\n  description: "25000Pa suction, 100°C mop" (27字符)\n\n### 类别2 - 品牌+品类 (2个)\n示例：\n- text: "Roborock Vacuums" (17字符)\n  description: "Official store, free shipping" (31字符)\n\n### 类别3 - 功能+场景 (2个)\n示例：\n- text: "Pet Hair Solution" (17字符)\n  description: "Auto cleaning for pet owners" (29字符)\n\n## 单品链接特殊规则\n\n**如果是单品链接（product link）**：\n- 所有创意元素必须100%聚焦单品\n- 禁止提到"browse our collection"\n- 禁止提到其他品类名称\n\n## 店铺链接特殊规则\n\n**如果是店铺链接（store link）**：\n- 目标：驱动用户进店探索\n- **允许**使用"Shop All"类通用链接\n- **可以**包含单品型号（可选）\n- 必须与店铺整体主题相关\n\n## 桶类型适配\n\n根据 {{bucket_type}} 调整创意角度：\n\n### 桶A（品牌认知）\n- 全部15个标题必须包含品牌词\n- 强调官方、正品、信任\n\n### 桶B（使用场景）\n- 至少10个标题包含场景词（pet, home, family...）\n- 强调使用场景和用户痛点\n\n### 桶C（功能特性）\n- 至少10个标题包含功能词（suction, power, heat...）\n- 强调技术参数和独特功能\n\n### 桶D（价格促销）\n- 至少10个标题包含价格/促销词\n- 强调折扣、限时、性价比\n\n### 桶S（综合平衡）\n- 平衡品牌、功能、场景\n- 适合全面覆盖\n\n## 本地化规则\n\n### 货币符号\n- US: USD ($)\n- UK: GBP (£)\n- EU: EUR (€)\n\n### 紧急感本地化\n- US/UK: "Limited Time", "Today Only"\n- DE: "Nur heute", "Zeitlich begrenzt"\n- FR: "Offre limitée", "Aujourd''hui seulement"\n- JA: "今だけ", "期間限定"\n\n## 质量检查清单（Ad Strength优化版）⭐\n\n生成后检查：\n- [ ] 所有headlines ≤30字符且语义完整\n- [ ] 所有descriptions ≤90字符且语义完整\n- [ ] 所有callouts ≤25字符（6个）\n- [ ] 所有sitelink text ≤25字符\n- [ ] 所有sitelink description ≤35字符\n- [ ] 15个标题分为2+4+4+2+3（5种类型）\n- [ ] 至少2个问题型标题（以?结尾）\n- [ ] 至少1个紧迫感标题（包含Limited/Today/Now等）\n- [ ] 品牌词覆盖率20-27%（3-4个标题包含品牌词）\n- [ ] 产品名覆盖率13%（2个标题包含完整产品名）\n- [ ] 类别1的2个品牌型标题必须包含品牌词\n- [ ] 4个描述全部包含英文CTA结尾\n- [ ] 6个Callouts分为2+2+2\n- [ ] 6个Sitelinks完整\n- [ ] 15个关键词\n- [ ] 关键词嵌入率达标\n\n如果不满足任何关键要求，重新生成。',
  TRUE,
  NULL,
  '品牌词覆盖率优化 v4.32：
1. 品牌词约束：从"最多3次"改为"3-4次"（平衡覆盖率与多样性）
2. 明确品牌词变体使用（Official, Store, The Brand）
3. 添加品牌词覆盖率检查（20-27%）
4. 添加产品名覆盖率检查（13%）
5. 修复质量检查清单与描述一致的冲突
6. 预期效果：品牌搜索转化率提升15-20%'
);

-- Step 4: 验证插入
SELECT prompt_id, version, name, is_active
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY created_at DESC
LIMIT 3;

-- ====================================================================
-- SOURCE: pg-migrations/118_click_farm_tasks.pg.sql
-- ====================================================================
-- Migration: 118_click_farm_tasks
-- Description: 创建补点击任务表（Click Farm Tasks），支持未来日期开始任务
-- PostgreSQL版本
-- Author: Claude
-- Date: 2024-12-28
--
-- ==============================================================================
-- SQLite vs PostgreSQL 语法差异对照：
-- ==============================================================================
-- | 特性          | SQLite                          | PostgreSQL                    |
-- |--------------|---------------------------------|-------------------------------|
-- | ID生成       | TEXT DEFAULT (lower(hex(...)))  | UUID PRIMARY KEY DEFAULT ...  |
-- | 布尔类型     | INTEGER (0/1)                   | BOOLEAN                       |
-- | 时间戳       | TEXT                            | TIMESTAMP                     |
-- | JSON存储     | TEXT                            | JSONB                         |
-- | 默认时间函数 | datetime('now')                 | NOW() / CURRENT_DATE          |
-- | 日期函数     | DATE('now')                     | CURRENT_DATE                  |
-- | 外键约束     | 行内定义                         | CONSTRAINT ... FOREIGN KEY    |
-- ==============================================================================

-- 补点击任务表
CREATE TABLE IF NOT EXISTS click_farm_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 任务配置
  daily_click_count INTEGER NOT NULL DEFAULT 216,
  start_time TEXT NOT NULL DEFAULT '06:00',  -- 存储为TEXT格式 HH:mm，因为支持'24:00'这样的特殊值
  end_time TEXT NOT NULL DEFAULT '24:00',    -- TEXT格式支持'24:00'特殊值（表示午夜）
  duration_days INTEGER NOT NULL DEFAULT 7,  -- -1表示无限期
  hourly_distribution JSONB NOT NULL,  -- 24个整数的JSON数组

  -- 🆕 计划开始日期（DATE类型，相对于任务时区的本地日期）
  -- 例如：timezone = "America/New_York"，scheduled_start_date = '2024-12-30'
  -- 表示任务在纽约时间 2024-12-30 的 start_time 时刻开始执行
  scheduled_start_date DATE DEFAULT CURRENT_DATE,

  -- 状态管理
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/running/paused/stopped/completed
  pause_reason TEXT,  -- no_proxy / manual / offer_deleted / null
  pause_message TEXT,
  paused_at TIMESTAMP,

  -- 实时统计
  progress INTEGER DEFAULT 0,  -- 完成百分比
  total_clicks INTEGER DEFAULT 0,
  success_clicks INTEGER DEFAULT 0,
  failed_clicks INTEGER DEFAULT 0,

  -- 历史数据（JSONB数组，任务删除后仍可用于累计统计）
  daily_history JSONB DEFAULT '[]'::jsonb,
  -- 🆕 每日历史记录示例（含hourly_breakdown用于追踪每小时的执行分布）
  -- [
  --   {
  --     "date": "2024-01-15",
  --     "target": 216,
  --     "actual": 210,
  --     "success": 205,
  --     "failed": 5,
  --     "hourly_breakdown": [
  --       {"target": 10, "actual": 10, "success": 10, "failed": 0},
  --       {"target": 15, "actual": 14, "success": 14, "failed": 0},
  --       ...  -- 24个小时
  --     ]
  --   }
  -- ]

  -- 时区配置
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  -- ⚠️ 时区说明：所有时间相关字段都相对于这个时区：
  -- - start_time/end_time: 该时区的本地时间
  -- - scheduled_start_date: 该时区的本地日期
  -- - hourly_distribution[i]: 该时区第i个小时的点击数
  -- - started_at: 当Cron在该时区达到scheduled_start_date时设置

  -- 软删除
  is_deleted BOOLEAN DEFAULT false,
  deleted_at TIMESTAMP,

  -- 时间戳
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- 外键约束
  CONSTRAINT fk_click_farm_offer
    FOREIGN KEY (offer_id)
    REFERENCES offers(id)
    ON DELETE CASCADE
);

-- 索引：用户+状态查询
CREATE INDEX IF NOT EXISTS idx_cft_user_status
  ON click_farm_tasks(user_id, status);

-- 索引：运行中任务的下次执行时间
CREATE INDEX IF NOT EXISTS idx_cft_next_run
  ON click_farm_tasks(next_run_at)
  WHERE status = 'running';

-- 索引：用户任务按创建时间排序
CREATE INDEX IF NOT EXISTS idx_cft_created
  ON click_farm_tasks(user_id, created_at DESC);

-- 索引：Offer关联查询
CREATE INDEX IF NOT EXISTS idx_cft_offer
  ON click_farm_tasks(offer_id);

-- 🆕 索引：计划开始日期+状态（优化Cron调度器查询）
CREATE INDEX IF NOT EXISTS idx_cft_scheduled_start
  ON click_farm_tasks(scheduled_start_date, status);

-- 🆕 索引：任务时区（用于时区相关的日期计算）
CREATE INDEX IF NOT EXISTS idx_cft_timezone
  ON click_farm_tasks(timezone);

-- 🆕 索引：JSONB字段索引（用于daily_history查询优化）
CREATE INDEX IF NOT EXISTS idx_cft_daily_history
  ON click_farm_tasks USING GIN (daily_history);

-- ====================================================================
-- SOURCE: pg-migrations/119_drop_ad_performance_table.pg.sql
-- ====================================================================
-- Migration: 119_drop_ad_performance_table.pg.sql
-- Description: 删除不再使用的 ad_performance 表（Ad级别细粒度数据不需要）
-- Author: AutoBB
-- Date: 2024-12-29

-- 注意：此迁移为不可逆操作，删除前请确保已备份数据

-- 1. 检查表是否存在
SELECT '检查 ad_performance 表是否存在...' AS status;

-- 2. 如果表存在，先删除外键约束和主键约束
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- 获取并删除所有外键约束
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'ad_performance'::regclass
        AND contype = 'f'
    LOOP
        EXECUTE 'ALTER TABLE ad_performance DROP CONSTRAINT ' || quote_ident(constraint_name);
        RAISE NOTICE '已删除外键约束: %', constraint_name;
    END LOOP;

    -- 删除主键约束（这会自动删除相关的主键索引）
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'ad_performance'::regclass
        AND contype = 'p'
    LOOP
        EXECUTE 'ALTER TABLE ad_performance DROP CONSTRAINT ' || quote_ident(constraint_name);
        RAISE NOTICE '已删除主键约束: %', constraint_name;
    END LOOP;

    -- 删除所有其他约束（如唯一约束）
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'ad_performance'::regclass
        AND contype IN ('u', 'c')
    LOOP
        EXECUTE 'ALTER TABLE ad_performance DROP CONSTRAINT ' || quote_ident(constraint_name);
        RAISE NOTICE '已删除约束: %', constraint_name;
    END LOOP;
END $$;

-- 3. 删除表
SELECT '删除 ad_performance 表...' AS status;

DROP TABLE IF EXISTS ad_performance CASCADE;

-- 4. 验证删除结果
SELECT '验证: ad_performance 表已删除' AS status;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ad_performance'
    ) THEN
        RAISE EXCEPTION '表删除失败！';
    ELSE
        RAISE NOTICE 'SUCCESS: ad_performance 表已成功删除';
    END IF;
END $$;

-- 5. 记录迁移完成
SELECT '迁移 119 完成: ad_performance 表已删除' AS status;

-- ====================================================================
-- SOURCE: pg-migrations/120_user_sessions.pg.sql
-- ====================================================================
-- ==========================================
-- Migration: 120_user_sessions (PostgreSQL)
-- Purpose: Track user login sessions for account sharing detection
-- ==========================================

-- Drop tables if exist (for clean re-creation)
DROP TABLE IF EXISTS account_sharing_alerts CASCADE;
DROP TABLE IF EXISTS trusted_devices CASCADE;
DROP TABLE IF EXISTS user_sessions CASCADE;

-- ==========================================
-- Table: user_sessions
-- ==========================================
CREATE TABLE user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  is_current INTEGER DEFAULT 1,
  is_suspicious INTEGER DEFAULT 0,
  suspicious_reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance (use CREATE INDEX IF NOT EXISTS for idempotency)
DO $$ BEGIN
  CREATE INDEX idx_user_sessions_user_id ON user_sessions(user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_device_fp ON user_sessions(device_fingerprint);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_is_suspicious ON user_sessions(is_suspicious);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_user_sessions_created_at ON user_sessions(created_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Foreign key
ALTER TABLE user_sessions ADD CONSTRAINT fk_user_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ==========================================
-- Table: account_sharing_alerts
-- ==========================================
CREATE TABLE account_sharing_alerts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  description TEXT NOT NULL,
  ip_addresses TEXT,
  device_fingerprints TEXT,
  metadata JSONB,
  is_resolved INTEGER DEFAULT 0,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by INTEGER,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes
DO $$ BEGIN
  CREATE INDEX idx_alerts_user_id ON account_sharing_alerts(user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_alerts_created_at ON account_sharing_alerts(created_at);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

DO $$ BEGIN
  CREATE INDEX idx_alerts_is_resolved ON account_sharing_alerts(is_resolved);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Foreign keys
ALTER TABLE account_sharing_alerts ADD CONSTRAINT fk_alerts_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE account_sharing_alerts ADD CONSTRAINT fk_alerts_resolved_by
  FOREIGN KEY (resolved_by) REFERENCES users(id);

-- ==========================================
-- Table: trusted_devices
-- ==========================================
CREATE TABLE trusted_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  device_fingerprint TEXT NOT NULL,
  device_name TEXT,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  is_active INTEGER DEFAULT 1
);

DO $$ BEGIN
  CREATE INDEX idx_trusted_devices_user ON trusted_devices(user_id);
EXCEPTION
  WHEN duplicate_table THEN null;
END $$;

-- Unique constraint
ALTER TABLE trusted_devices ADD CONSTRAINT uk_trusted_device
  UNIQUE (user_id, device_fingerprint);

-- Foreign key
ALTER TABLE trusted_devices ADD CONSTRAINT fk_trusted_devices_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ====================================================================
-- SOURCE: pg-migrations/121_auto_sync_batch_status.pg.sql
-- ====================================================================
-- Migration: 121_auto_sync_batch_status
-- Description: 自动同步 batch_tasks 状态与子任务状态
-- Created: 2025-12-29

-- ============================================================================
-- 1. 创建函数：更新 batch_tasks 统计信息
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_batch_task_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_batch_id UUID;
    v_completed_count INTEGER;
    v_failed_count INTEGER;
    v_running_count INTEGER;
    v_pending_count INTEGER;
    v_new_status TEXT;
BEGIN
    -- 获取 batch_id（支持 INSERT、UPDATE、DELETE）
    IF TG_OP = 'DELETE' THEN
        v_batch_id := OLD.batch_id;
    ELSE
        v_batch_id := NEW.batch_id;
    END IF;

    -- 如果没有 batch_id，跳过
    IF v_batch_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- 统计子任务状态
    SELECT
        COUNT(*) FILTER (WHERE status = 'completed'),
        COUNT(*) FILTER (WHERE status = 'failed'),
        COUNT(*) FILTER (WHERE status = 'running'),
        COUNT(*) FILTER (WHERE status = 'pending')
    INTO v_completed_count, v_failed_count, v_running_count, v_pending_count
    FROM offer_tasks
    WHERE batch_id = v_batch_id;

    -- 根据子任务状态决定 batch 状态
    IF v_running_count > 0 OR v_pending_count > 0 THEN
        -- 仍有任务在运行或等待
        v_new_status := 'running';
    ELSIF v_completed_count > 0 AND v_failed_count = 0 THEN
        -- 全部成功
        v_new_status := 'completed';
    ELSIF v_completed_count = 0 AND v_failed_count > 0 THEN
        -- 全部失败
        v_new_status := 'failed';
    ELSE
        -- 部分成功部分失败
        v_new_status := 'partial';
    END IF;

    -- 更新 batch_tasks
    UPDATE batch_tasks
    SET
        status = v_new_status,
        completed_count = v_completed_count,
        failed_count = v_failed_count,
        completed_at = CASE
            WHEN v_new_status IN ('completed', 'partial', 'failed') THEN NOW()
            ELSE completed_at
        END,
        updated_at = NOW()
    WHERE id = v_batch_id;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 2. 创建触发器：在 offer_tasks 变更时自动同步
-- ============================================================================
DROP TRIGGER IF EXISTS trigger_offer_tasks_sync_batch ON offer_tasks;

CREATE TRIGGER trigger_offer_tasks_sync_batch
AFTER INSERT OR UPDATE OF status ON offer_tasks
FOR EACH ROW
EXECUTE FUNCTION sync_batch_task_stats();

-- ============================================================================
-- 3. 创建函数：自动更新 cancelled_at 和 cancelled_by（当状态变为 cancelled 时）
-- 注意：PostgreSQL 的 offer_tasks 不支持 cancelled 状态，这里作为参考保留
-- ============================================================================

-- ============================================================================
-- 4. 验证触发器创建成功
-- ============================================================================
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trigger_offer_tasks_sync_batch'
    ) THEN
        RAISE NOTICE '✅ 触发器 trigger_offer_tasks_sync_batch 创建成功';
    ELSE
        RAISE EXCEPTION '❌ 触发器创建失败';
    END IF;
END $$;

-- ============================================================================
-- 5. 立即同步一次所有 running 状态的 batch（清理历史数据）
-- ============================================================================
DO $$
DECLARE
    v_batch_id UUID;
    v_completed_count INTEGER;
    v_failed_count INTEGER;
    v_running_count INTEGER;
    v_pending_count INTEGER;
    v_new_status TEXT;
    v_count INTEGER := 0;
BEGIN
    FOR v_batch_id IN
        SELECT id FROM batch_tasks WHERE status = 'running'
    LOOP
        SELECT
            COUNT(*) FILTER (WHERE status = 'completed'),
            COUNT(*) FILTER (WHERE status = 'failed'),
            COUNT(*) FILTER (WHERE status = 'running'),
            COUNT(*) FILTER (WHERE status = 'pending')
        INTO v_completed_count, v_failed_count, v_running_count, v_pending_count
        FROM offer_tasks
        WHERE batch_id = v_batch_id;

        IF v_running_count = 0 AND v_pending_count = 0 THEN
            IF v_completed_count > 0 AND v_failed_count = 0 THEN
                v_new_status := 'completed';
            ELSIF v_completed_count = 0 AND v_failed_count > 0 THEN
                v_new_status := 'failed';
            ELSE
                v_new_status := 'partial';
            END IF;

            UPDATE batch_tasks
            SET
                status = v_new_status,
                completed_count = v_completed_count,
                failed_count = v_failed_count,
                completed_at = NOW(),
                updated_at = NOW()
            WHERE id = v_batch_id;

            v_count := v_count + 1;
        END IF;
    END LOOP;

    RAISE NOTICE '🔄 已同步 % 个历史 batch 状态', v_count;
END $$;

COMMENT ON FUNCTION sync_batch_task_stats IS '自动同步 batch_tasks 状态与子任务状态';
COMMENT ON TRIGGER trigger_offer_tasks_sync_batch ON offer_tasks IS '在 offer_tasks 状态变更时自动更新 batch_tasks';

-- ====================================================================
-- SOURCE: pg-migrations/122_combined_migration.pg.sql
-- ====================================================================
-- ============================================
-- PostgreSQL 迁移编号：122
-- 标题：软删除机制修复
-- 日期：2025-12-29
-- 数据库：PostgreSQL
-- 描述：为campaigns表添加软删除支持
-- ============================================

-- ✅ 幂等性保证：使用 IF NOT EXISTS 和条件检查，确保可以安全重复执行

-- ==========================================
-- 软删除机制修复
-- ==========================================

-- 问题背景：
-- 1. Campaign删除使用了DELETE而非软删除，导致performance数据级联删除
-- 2. 统计查询不一致：部分过滤is_deleted，部分不过滤
-- 3. 已删除的campaigns无法体现在历史统计数据中

-- 修复内容：
-- 1. ✅ 添加 is_deleted 列到 campaigns 表（如果不存在）
-- 2. ✅ 代码层面：campaigns.ts deleteCampaign改为UPDATE软删除
-- 3. ✅ 代码层面：所有查询API统一处理is_deleted过滤
-- 4. 🔧 数据库层面：添加索引优化软删除查询性能
-- 5. 📊 数据验证：检查现有数据一致性

-- 1. 添加 is_deleted 列到 campaigns 表（PostgreSQL 幂等性处理）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE campaigns
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ Part 1: 已添加 campaigns.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  Part 1: campaigns.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 2. 添加 deleted_at 列到 campaigns 表（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE campaigns
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ Part 2: 已添加 campaigns.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  Part 2: campaigns.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 3. 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_campaigns_user_is_deleted
ON campaigns(user_id, is_deleted, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offers_user_is_deleted
ON offers(user_id, is_deleted);

-- 4. 数据验证和统计
DO $$
DECLARE
  null_count INTEGER;
  deleted_campaigns INTEGER;
  deleted_offers INTEGER;
  perf_count INTEGER;
BEGIN
  -- 检查NULL值
  SELECT COUNT(*) INTO null_count
  FROM campaigns
  WHERE is_deleted IS NULL;

  RAISE NOTICE 'Part 4: Data Validation - Campaigns without is_deleted field: %', null_count;

  -- 统计软删除数量
  SELECT COUNT(*) INTO deleted_campaigns
  FROM campaigns
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Part 4: Statistics - Soft-deleted campaigns: %', deleted_campaigns;

  SELECT COUNT(*) INTO deleted_offers
  FROM offers
  WHERE is_deleted = TRUE;

  RAISE NOTICE 'Part 4: Statistics - Soft-deleted offers: %', deleted_offers;

  -- 检查已删除campaigns的performance数据
  SELECT COUNT(DISTINCT cp.campaign_id) INTO perf_count
  FROM campaign_performance cp
  INNER JOIN campaigns c ON cp.campaign_id = c.id
  WHERE c.is_deleted = TRUE;

  RAISE NOTICE 'Part 4: Performance data for deleted campaigns: %', perf_count;
END $$;

-- 5. 修复NULL值（防御性修复）
UPDATE campaigns
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE offers
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

-- 6. 最终验证
DO $$
DECLARE
  deleted_campaigns INTEGER;
  deleted_offers INTEGER;
  total_performance INTEGER;
BEGIN
  SELECT COUNT(*) INTO deleted_campaigns FROM campaigns WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO deleted_offers FROM offers WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO total_performance FROM campaign_performance;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUCCESS: Migration 122 completed';
  RAISE NOTICE 'Deleted campaigns: %', deleted_campaigns;
  RAISE NOTICE 'Deleted offers: %', deleted_offers;
  RAISE NOTICE 'Total performance records: %', total_performance;
  RAISE NOTICE '========================================';
END $$;

-- ====================================================================
-- SOURCE: pg-migrations/123_add_soft_delete_to_core_tables.pg.sql
-- ====================================================================
-- ============================================
-- PostgreSQL 迁移编号：123
-- 标题：为核心表添加软删除支持
-- 日期：2025-12-29
-- 数据库：PostgreSQL
-- 描述：为 ad_creatives, google_ads_accounts, scraped_products 添加软删除
-- ============================================

-- ✅ 幂等性保证：使用 IF NOT EXISTS 和条件检查，确保可以安全重复执行

-- ==========================================
-- 1. ad_creatives - 广告创意软删除
-- ==========================================

-- 1.1 添加 is_deleted 列
-- 理由：防止创意performance数据丢失，保留创意效果分析历史
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE ad_creatives
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ 1.1: 已添加 ad_creatives.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  1.1: ad_creatives.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 1.2 添加 deleted_at 列（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE ad_creatives
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ 1.2: 已添加 ad_creatives.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  1.2: ad_creatives.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 1.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_ad_creatives_user_is_deleted
ON ad_creatives(user_id, is_deleted, created_at DESC);

-- ==========================================
-- 2. google_ads_accounts - Google Ads账户软删除
-- ==========================================

-- 2.1 添加 is_deleted 列
-- 理由：防止campaigns关联断裂，保留账户级别performance统计
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_accounts' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE google_ads_accounts
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ 2.1: 已添加 google_ads_accounts.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  2.1: google_ads_accounts.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 2.2 添加 deleted_at 列（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_accounts' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE google_ads_accounts
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ 2.2: 已添加 google_ads_accounts.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  2.2: google_ads_accounts.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 2.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_google_ads_accounts_user_is_deleted
ON google_ads_accounts(user_id, is_deleted);

-- ==========================================
-- 3. scraped_products - 抓取产品数据软删除
-- ==========================================

-- 3.1 添加 is_deleted 列
-- 理由：保留产品抓取历史，用于数据变化趋势分析
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'is_deleted'
  ) THEN
    ALTER TABLE scraped_products
    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

    RAISE NOTICE '✅ 3.1: 已添加 scraped_products.is_deleted 列';
  ELSE
    RAISE NOTICE '⏭️  3.1: scraped_products.is_deleted 列已存在，跳过';
  END IF;
END $$;

-- 3.2 添加 deleted_at 列（记录删除时间）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'deleted_at'
  ) THEN
    ALTER TABLE scraped_products
    ADD COLUMN deleted_at TIMESTAMP NULL;

    RAISE NOTICE '✅ 3.2: 已添加 scraped_products.deleted_at 列';
  ELSE
    RAISE NOTICE '⏭️  3.2: scraped_products.deleted_at 列已存在，跳过';
  END IF;
END $$;

-- 3.3 添加索引优化软删除查询
CREATE INDEX IF NOT EXISTS idx_scraped_products_is_deleted
ON scraped_products(is_deleted, created_at DESC);

-- ==========================================
-- 4. 数据验证
-- ==========================================

DO $$
DECLARE
  null_creatives INTEGER;
  null_accounts INTEGER;
  null_products INTEGER;
BEGIN
  -- 检查NULL值
  SELECT COUNT(*) INTO null_creatives
  FROM ad_creatives
  WHERE is_deleted IS NULL;

  SELECT COUNT(*) INTO null_accounts
  FROM google_ads_accounts
  WHERE is_deleted IS NULL;

  SELECT COUNT(*) INTO null_products
  FROM scraped_products
  WHERE is_deleted IS NULL;

  RAISE NOTICE 'Part 4: Data Validation - ad_creatives without is_deleted: %', null_creatives;
  RAISE NOTICE 'Part 4: Data Validation - google_ads_accounts without is_deleted: %', null_accounts;
  RAISE NOTICE 'Part 4: Data Validation - scraped_products without is_deleted: %', null_products;
END $$;

-- ==========================================
-- 5. 修复NULL值（防御性修复）
-- ==========================================

UPDATE ad_creatives
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE google_ads_accounts
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

UPDATE scraped_products
SET is_deleted = FALSE
WHERE is_deleted IS NULL;

-- ==========================================
-- 6. 最终验证
-- ==========================================

DO $$
DECLARE
  deleted_creatives INTEGER;
  deleted_accounts INTEGER;
  deleted_products INTEGER;
BEGIN
  SELECT COUNT(*) INTO deleted_creatives FROM ad_creatives WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO deleted_accounts FROM google_ads_accounts WHERE is_deleted = TRUE;
  SELECT COUNT(*) INTO deleted_products FROM scraped_products WHERE is_deleted = TRUE;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUCCESS: Migration 123 completed';
  RAISE NOTICE 'Deleted ad_creatives: %', deleted_creatives;
  RAISE NOTICE 'Deleted google_ads_accounts: %', deleted_accounts;
  RAISE NOTICE 'Deleted scraped_products: %', deleted_products;
  RAISE NOTICE '========================================';
END $$;

-- ====================================================================
-- SOURCE: pg-migrations/124_add_click_farm_referer_config.pg.sql
-- ====================================================================
-- Migration: 123_add_click_farm_referer_config.pg.sql
-- Description: 为click_farm_tasks表添加referer_config字段，支持防爬优化
-- Author: AutoBB
-- Date: 2025-12-30
-- Database: PostgreSQL
-- Priority: P1 - 功能必需

-- ==========================================
-- 背景
-- ==========================================
-- 新增补点击任务的Referer配置功能，用于：
-- 1. 防止反爬机制识别
-- 2. 模拟真实用户来源
-- 3. 支持多种Referer策略（留空/随机/固定）

-- ==========================================
-- Step 1: 添加referer_config字段
-- ==========================================

-- 检查字段是否已存在
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'click_farm_tasks'
    AND column_name = 'referer_config'
  ) THEN
    ALTER TABLE click_farm_tasks ADD COLUMN IF NOT EXISTS referer_config TEXT DEFAULT NULL;
    RAISE NOTICE '添加referer_config字段成功';
  ELSE
    RAISE NOTICE 'referer_config字段已存在，跳过添加';
  END IF;
END $$;

-- ==========================================
-- Step 2: 创建索引优化查询
-- ==========================================

-- 创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_click_farm_tasks_referer_config
ON click_farm_tasks(referer_config);

-- ==========================================
-- Step 3: 数据验证
-- ==========================================

DO $$
DECLARE
  total_tasks INTEGER;
  tasks_with_config INTEGER;
BEGIN
  -- 统计现有任务数量
  SELECT COUNT(*) INTO total_tasks FROM click_farm_tasks;
  RAISE NOTICE '总任务数: %', total_tasks;

  -- 统计有referer_config的任务数
  SELECT COUNT(*) INTO tasks_with_config
  FROM click_farm_tasks
  WHERE referer_config IS NOT NULL;
  RAISE NOTICE '已配置Referer的任务数: %', tasks_with_config;
END $$;

-- ==========================================
-- Step 4: 验证迁移结果
-- ==========================================

DO $$
DECLARE
  total_tasks INTEGER;
  tasks_with_config INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_tasks FROM click_farm_tasks;
  SELECT COUNT(*) INTO tasks_with_config
  FROM click_farm_tasks
  WHERE referer_config IS NOT NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUCCESS: Migration 123 completed';
  RAISE NOTICE '总任务数: %', total_tasks;
  RAISE NOTICE '已配置Referer的任务数: %', tasks_with_config;
  RAISE NOTICE '========================================';
END $$;

-- ====================================================================
-- SOURCE: pg-migrations/125_gemini_api_keys_and_provider_templates.pg.sql
-- ====================================================================
-- Migration: 125_gemini_api_keys_and_provider_templates.pg.sql
-- Description: 添加 gemini_relay_api_key 字段和补充全局模板记录
-- Date: 2025-12-30
-- 遵循 docs/BasicPrinciples/MustKnowV1.md 第31条：模板+实例双层架构
--
-- 包含：
-- 1. 添加 gemini_relay_api_key 列和全局模板
-- 2. 补充 gemini_provider 和 gemini_endpoint 全局模板

DO $$
DECLARE
  column_exists BOOLEAN;
BEGIN
  -- ============================================
  -- 第一部分：添加 gemini_relay_api_key 字段
  -- ============================================

  -- 1. 检查并添加字段
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'system_settings'
      AND column_name = 'gemini_relay_api_key'
  ) INTO column_exists;

  IF NOT column_exists THEN
    ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS gemini_relay_api_key TEXT DEFAULT NULL;
    RAISE NOTICE 'Added column gemini_relay_api_key';
  ELSE
    RAISE NOTICE 'Column gemini_relay_api_key already exists, skipping';
  END IF;

  -- 2. 添加字段注释
  COMMENT ON COLUMN system_settings.gemini_relay_api_key IS '第三方中转服务 API Key（用于 relay 服务商）';

  -- 3. 插入全局模板记录（user_id=NULL, value=NULL）
  -- PostgreSQL: INSERT ... WHERE NOT EXISTS 实现幂等插入，布尔值使用 false/true
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_relay_api_key', NULL, 'string', true, false, '第三方中转服务 API Key'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_relay_api_key'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_relay_api_key inserted or already exists';

  -- ============================================
  -- 第二部分：补充 gemini_provider 和 gemini_endpoint 全局模板
  -- ============================================

  -- 4. 插入 gemini_provider 全局模板
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_provider', NULL, 'string', false, false, 'Gemini API 服务商（official/relay/vertex）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_provider'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_provider inserted or already exists';

  -- 5. 插入 gemini_endpoint 全局模板
  INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
  SELECT NULL, 'ai', 'gemini_endpoint', NULL, 'string', false, false, 'Gemini API 端点（系统自动计算）'
  WHERE NOT EXISTS (
    SELECT 1 FROM system_settings
    WHERE user_id IS NULL
      AND category = 'ai'
      AND key = 'gemini_endpoint'
      AND value IS NULL
  );

  RAISE NOTICE 'Global template for gemini_endpoint inserted or already exists';
END $$;

-- ============================================
-- 第三部分：创建索引（加速查询）
-- ============================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'system_settings'
      AND indexname = 'idx_system_settings_gemini_relay_api_key'
  ) THEN
    CREATE INDEX idx_system_settings_gemini_relay_api_key
    ON system_settings(category, key) WHERE gemini_relay_api_key IS NOT NULL;
    RAISE NOTICE 'Created index idx_system_settings_gemini_relay_api_key';
  END IF;
END $$;

-- ============================================
-- 第四部分：验证迁移结果
-- ============================================

DO $$
DECLARE
  template_count INTEGER;
  user_config_count INTEGER;
BEGIN
  -- 检查 AI 分类的全局模板数量
  SELECT COUNT(*) INTO template_count
  FROM system_settings
  WHERE user_id IS NULL
    AND value IS NULL
    AND category = 'ai';

  -- 检查用户配置
  SELECT COUNT(*) INTO user_config_count
  FROM system_settings
  WHERE user_id IS NOT NULL
    AND category = 'ai'
    AND key = 'gemini_relay_api_key'
    AND value IS NOT NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'Migration 125 complete:';
  RAISE NOTICE '  - AI global templates: %', template_count;
  RAISE NOTICE '  - gemini_relay_api_key user configs: %', user_config_count;
  RAISE NOTICE '========================================';
END $$;

-- ====================================================================
-- SOURCE: pg-migrations/126_add_currency_to_campaign_performance.pg.sql
-- ====================================================================
/**
 * Migration 126: Add currency support to campaign_performance table (PostgreSQL)
 *
 * Purpose: Support multi-currency Google Ads accounts
 * - Add currency column to track original currency from Google Ads API
 * - Update historical data with correct currency from google_ads_accounts
 *
 * Background:
 * - Google Ads API returns cost_micros in account's native currency
 * - Different accounts may use USD, CNY, EUR, GBP, etc.
 * - Previously assumed all costs were in USD (incorrect)
 *
 * Date: 2025-12-30
 */

-- Step 1: Add currency column with default 'USD'
ALTER TABLE campaign_performance
ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD';

-- Step 2: Update historical data with correct currency from google_ads_accounts
-- This fixes data where we incorrectly assumed USD
UPDATE campaign_performance cp
SET currency = COALESCE(gaa.currency, 'USD')
FROM campaigns c
LEFT JOIN google_ads_accounts gaa ON c.google_ads_account_id = gaa.id
WHERE c.id = cp.campaign_id
  AND cp.currency = 'USD';  -- Only update records that still have default USD

-- Step 3: Create index for efficient currency-based queries
CREATE INDEX IF NOT EXISTS idx_campaign_performance_currency
ON campaign_performance(currency);

-- Step 4: Create compound index for common query patterns
CREATE INDEX IF NOT EXISTS idx_campaign_performance_user_currency_date
ON campaign_performance(user_id, currency, date);

-- Step 5: Add comment for documentation
COMMENT ON COLUMN campaign_performance.currency IS 'Currency code from Google Ads account (USD, CNY, EUR, GBP, etc.). Reflects the native currency of cost data.';

-- Verification query (comment out in production):
-- SELECT
--   currency,
--   COUNT(*) as record_count,
--   ROUND(SUM(cost)::numeric, 2) as total_cost,
--   MIN(date) as earliest_date,
--   MAX(date) as latest_date
-- FROM campaign_performance
-- GROUP BY currency
-- ORDER BY total_cost DESC;

-- ====================================================================
-- SOURCE: pg-migrations/127_fix_click_farm_tasks_foreign_key.pg.sql
-- ====================================================================
-- Migration: 125_fix_click_farm_tasks_foreign_key
-- Description: 修复 click_farm_tasks 表的外键约束问题
-- PostgreSQL版本
-- Date: 2024-12-30
--
-- 问题：click_farm_tasks 表定义了复合外键 (offer_id, user_id) REFERENCES offers(id, user_id)
-- 但 offers 表没有 (id, user_id) 的复合唯一索引，导致 "foreign key mismatch" 错误
--
-- 解决方案：删除现有的复合外键，创建只引用 offers(id) 的外键

-- Step 1: 删除现有的外键约束
DO $$
DECLARE
    fk_name TEXT;
BEGIN
    SELECT conname INTO fk_name
    FROM pg_constraint
    WHERE conrelid = 'click_farm_tasks'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[2, 3]::smallint[];  -- 🔧 修复：显式指定smallint[]类型

    IF fk_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE click_farm_tasks DROP CONSTRAINT ' || fk_name;
        RAISE NOTICE 'Dropped foreign key constraint: %', fk_name;
    ELSE
        RAISE NOTICE 'No matching foreign key constraint found';
    END IF;
END $$;

-- Step 2: 创建新的外键约束（只引用 offers.id）
DO $$
DECLARE
    cons_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'click_farm_tasks'::regclass
        AND contype = 'f'
        AND conkey = ARRAY[3]::smallint[]  -- 🔧 修复：显式指定smallint[]类型
        AND confrelid = 'offers'::regclass
    ) INTO cons_exists;

    IF NOT cons_exists THEN
        ALTER TABLE click_farm_tasks
        ADD CONSTRAINT fk_click_farm_tasks_offer_id
        FOREIGN KEY (offer_id)
        REFERENCES offers(id)
        ON DELETE CASCADE;
        RAISE NOTICE 'Created new foreign key constraint: fk_click_farm_tasks_offer_id';
    ELSE
        RAISE NOTICE 'Foreign key constraint already exists';
    END IF;
END $$;

-- 验证外键约束
SELECT
    conname AS constraint_name,
    conrelid::regclass AS table_name,
    a.attname AS column_name,
    confrelid::regclass AS referenced_table,
    pf.attname AS referenced_column
FROM pg_constraint
JOIN pg_attribute a ON a.attrelid = pg_constraint.conrelid AND a.attnum = ANY(pg_constraint.conkey)
JOIN pg_attribute pf ON pf.attrelid = pg_constraint.confrelid AND pf.attnum = ANY(pg_constraint.confkey)
WHERE pg_constraint.conrelid = 'click_farm_tasks'::regclass
AND pg_constraint.contype = 'f';

-- ====================================================================
-- SOURCE: pg-migrations/128_create_url_swap_tasks.pg.sql
-- ====================================================================
-- Migration: 128_create_url_swap_tasks
-- Description: 创建换链接任务表（URL Swap Task System）
-- PostgreSQL版本
-- Date: 2025-01-03
--
-- 换链接任务系统：自动监测和更新Google Ads广告链接
-- 当Offer的推广链接发生变化时，系统能够自动检测并更新广告系列的Final URL Suffix

-- Step 1: 创建换链接任务表
CREATE TABLE IF NOT EXISTS url_swap_tasks (
  -- === 基础信息 ===
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- === 任务配置 ===
  swap_interval_minutes INTEGER NOT NULL DEFAULT 5,  -- 换链间隔（分钟）：5, 10, 30, 60, 120, 240, 480, 1440
  enabled BOOLEAN DEFAULT TRUE,             -- 是否启用
  duration_days INTEGER NOT NULL DEFAULT 7, -- 持续天数：-1表示无限期

  -- === 换链方式（方式一/方式二） ===
  swap_mode TEXT NOT NULL DEFAULT 'auto', -- auto=自动解析推广链接；manual=用户配置suffix列表轮询
  manual_final_url_suffixes JSONB NOT NULL DEFAULT '[]'::jsonb, -- JSON数组，字符串不含?
  manual_suffix_cursor INTEGER NOT NULL DEFAULT 0, -- 下一次要使用的suffix索引

  -- === Google Ads关联 ===
  google_customer_id TEXT,
  google_campaign_id TEXT,

  -- === 当前生效的URL ===
  current_final_url TEXT,
  current_final_url_suffix TEXT,

  -- === 实时统计 ===
  progress INTEGER DEFAULT 0,               -- 完成百分比（0-100）
  total_swaps INTEGER DEFAULT 0,            -- 总执行次数
  success_swaps INTEGER DEFAULT 0,          -- 成功次数
  failed_swaps INTEGER DEFAULT 0,           -- 失败次数
  url_changed_count INTEGER DEFAULT 0,      -- URL实际变化次数

  -- === 历史数据（简化版） ===
  swap_history JSONB DEFAULT '[]'::jsonb,  -- JSON数组，记录每次换链结果

  -- === 状态管理 ===
  -- 状态：enabled(已启用)/disabled(已禁用)/error(错误)/completed(已完成)
  status TEXT NOT NULL DEFAULT 'enabled',
  error_message TEXT,
  error_at TIMESTAMP WITH TIME ZONE,

  -- === 调度时间（简单UTC时间） ===
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  next_swap_at TIMESTAMP WITH TIME ZONE,    -- 下次执行时间（UTC时间）

  -- === 软删除 ===
  is_deleted BOOLEAN DEFAULT FALSE,
  deleted_at TIMESTAMP WITH TIME ZONE,

  -- === 时间戳 ===
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- === 外键约束 ===
  CONSTRAINT fk_url_swap_offer
    FOREIGN KEY (offer_id)
    REFERENCES offers(id)
    ON DELETE CASCADE,

  -- === 唯一约束 ===
  CONSTRAINT uq_url_swap_offer UNIQUE (offer_id)
);

-- Step 2: 创建索引

-- 用户+状态查询（用户查看自己的任务列表）
CREATE INDEX IF NOT EXISTS idx_url_swap_user_status
  ON url_swap_tasks(user_id, status);

-- 调度查询（优化Cron调度器）
-- PostgreSQL partial index
CREATE INDEX IF NOT EXISTS idx_url_swap_scheduled
  ON url_swap_tasks(next_swap_at, started_at)
  WHERE status = 'enabled';

-- 用户任务按创建时间排序
CREATE INDEX IF NOT EXISTS idx_url_swap_created
  ON url_swap_tasks(user_id, created_at DESC);

-- Offer关联查询
CREATE INDEX IF NOT EXISTS idx_url_swap_offer
  ON url_swap_tasks(offer_id);

-- 统计查询：按状态分组
CREATE INDEX IF NOT EXISTS idx_url_swap_status
  ON url_swap_tasks(status);

-- JSONB索引（用于swap_history查询）
CREATE INDEX IF NOT EXISTS idx_url_swap_history_jsonb
  ON url_swap_tasks USING GIN (swap_history);

-- Step 3: 添加表注释
COMMENT ON TABLE url_swap_tasks IS '换链接任务表 - 自动监测和更新Google Ads广告链接';
COMMENT ON COLUMN url_swap_tasks.id IS '任务唯一标识（UUID）';
COMMENT ON COLUMN url_swap_tasks.user_id IS '用户ID（数据隔离）';
COMMENT ON COLUMN url_swap_tasks.offer_id IS '关联的Offer ID';
COMMENT ON COLUMN url_swap_tasks.swap_interval_minutes IS '换链间隔（分钟）';
COMMENT ON COLUMN url_swap_tasks.enabled IS '是否启用';
COMMENT ON COLUMN url_swap_tasks.duration_days IS '任务持续天数（-1表示无限期）';
COMMENT ON COLUMN url_swap_tasks.google_customer_id IS 'Google Ads Customer ID';
COMMENT ON COLUMN url_swap_tasks.google_campaign_id IS 'Google Ads Campaign ID';
COMMENT ON COLUMN url_swap_tasks.current_final_url IS '当前Final URL（不含查询参数）';
COMMENT ON COLUMN url_swap_tasks.current_final_url_suffix IS '当前Final URL Suffix（查询参数部分）';
COMMENT ON COLUMN url_swap_tasks.status IS '任务状态：enabled/disabled/error/completed';
COMMENT ON COLUMN url_swap_tasks.swap_history IS '换链历史记录（JSON数组）';
COMMENT ON COLUMN url_swap_tasks.next_swap_at IS '下次执行时间（UTC）';

-- Step 4: 创建更新updated_at的触发器
CREATE OR REPLACE FUNCTION update_url_swap_tasks_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_url_swap_tasks_updated ON url_swap_tasks;
CREATE TRIGGER trigger_url_swap_tasks_updated
  BEFORE UPDATE ON url_swap_tasks
  FOR EACH ROW
  EXECUTE FUNCTION update_url_swap_tasks_timestamp();

-- Step 5: 验证
DO $$
BEGIN
  RAISE NOTICE 'URL Swap Tasks表创建成功';
  RAISE NOTICE '索引创建完成';
  RAISE NOTICE '更新时间戳触发器创建完成';
END $$;

-- ====================================================================
-- SOURCE: pg-migrations/129_add_consecutive_failures.pg.sql
-- ====================================================================
-- Migration: 129_add_consecutive_failures
-- Description: 为url_swap_tasks表添加连续失败跟踪字段
-- PostgreSQL版本
-- Date: 2025-01-03

-- 添加连续失败次数字段
ALTER TABLE url_swap_tasks
ADD COLUMN consecutive_failures INTEGER DEFAULT 0;

-- 验证字段添加成功
SELECT 'consecutive_failures字段添加成功' AS result;

-- ====================================================================
-- SOURCE: pg-migrations/130_update_prompts_enhanced_data.pg.sql
-- ====================================================================
-- ============================================================
-- Migration: 130_update_prompts_enhanced_data.pg.sql
-- Description: 整合迁移 - 更新6个Prompts到v4.15/v4.16版本
--              新增独立站增强数据字段支持（reviews、faqs、specifications等）
--
-- 整合自以下迁移文件：
--   - 130_update_prompt_v4.16.pg.sql (product_analysis_single)
--   - 131_update_ad_creative_prompt_v4.33.pg.sql (ad_creative_generation)
--   - 132_update_brand_analysis_store_prompt_v4.16.pg.sql (brand_analysis_store)
--   - 133_update_ad_elements_descriptions_prompt_v4.15.pg.sql (ad_elements_descriptions)
--   - 134_update_ad_elements_headlines_prompt_v4.15.pg.sql (ad_elements_headlines)
--   - 135_update_store_highlights_synthesis_prompt_v4.15.pg.sql (store_highlights_synthesis)
--
-- Author: Claude Code
-- Date: 2026-01-04
-- Database: PostgreSQL
-- ============================================================

-- ============================================================
-- Part 1: product_analysis_single → v4.16
-- ============================================================

-- 幂等性保证：先删除v4.16版本（如果存在）
DELETE FROM prompt_versions
WHERE prompt_id = 'product_analysis_single'
AND version = 'v4.16';

-- 停用旧版本v4.15
UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'product_analysis_single'
AND version = 'v4.15';

-- 插入新版本v4.16
INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'product_analysis_single',
  'v4.16',
  '产品分析',
  '单品产品分析v4.16',
  '增强版单品产品分析Prompt，新增独立站增强数据字段支持',
  'src/lib/ai.ts',
  'analyzeProductPage',
  $PROMPT$You are a professional product analyst. Analyze the following product page data comprehensively.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== FULL PAGE DATA ===
{{pageData.text}}

=== 🎯 ENHANCED DATA (P1 Optimization) ===
**Technical Specifications**: {{technicalDetails}}
**Review Highlights**: {{reviewHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA (v4.16 New) ===
**User Reviews**: {{reviews}}
- Use reviews to identify real customer pain points and needs
- Extract authentic use cases and satisfaction indicators

**Frequently Asked Questions**: {{faqs}}
- Understand what customers care about most
- Use FAQs to address potential objections

**Product Specifications**: {{specifications}}
- Use for technical differentiation analysis

**Package Options**: {{packages}}
- Analyze pricing tiers and value propositions

**Social Proof**: {{socialProof}}
- Use metrics like "18,000+ Installations" for competitive positioning

**Core Features**: {{coreFeatures}}
- These are the main value propositions

**Secondary Features**: {{secondaryFeatures}}
- Use to round out the value proposition

=== ANALYSIS REQUIREMENTS ===
CRITICAL: Focus ONLY on the MAIN PRODUCT. IGNORE:
- "Customers also bought", "Frequently bought together", "Related products"

Analyze these dimensions:
1. **Product Core** - Name, USPs, core features, target use cases
2. **Technical Analysis** - Key specifications, dimensions, material quality
3. **Pricing Intelligence** - Current vs Original price, discount, value proposition
4. **Review Insights** - Sentiment, positives, concerns, real use cases
5. **Customer Intent Analysis** - Use FAQs to understand concerns
6. **Market Position** - Category ranking, badges, social proof

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.

=== OUTPUT FORMAT ===
Return COMPLETE JSON:
{
  "productDescription": "Detailed description emphasizing technical specs and reviews",
  "sellingPoints": ["USP 1", "USP 2", "USP 3", "USP 4"],
  "targetAudience": "Customer description based on use cases",
  "category": "Product category",
  "keywords": ["keyword1", "keyword2", ...],
  "pricing": {
    "current": "$.XX",
    "original": "$.XX or null",
    "discount": "XX% or null",
    "competitiveness": "Premium/Competitive/Budget"
  },
  "reviews": {
    "rating": 4.5,
    "count": 1234,
    "sentiment": "Positive/Mixed/Negative",
    "positives": ["Pro 1", "Pro 2"],
    "concerns": ["Con 1", "Con 2"],
    "useCases": ["Use case 1", "Use case 2"]
  },
  "competitiveEdges": {
    "badges": ["Amazon's Choice"],
    "socialProof": ["18,000+ Installations"]
  },
  "productHighlights": ["Key spec 1", "Key spec 2", "Key spec 3"]
}

=== IMPORTANT NOTES ===
- 🔥 Leverage User Reviews, FAQs, and Social Proof data for deeper insights
- 🔥 Prioritize customer-validated features over marketing claims$PROMPT$,
  'English',
  1,
  true,
  'v4.16: 新增独立站增强数据字段支持（reviews、faqs、specifications、packages、socialProof、coreFeatures、secondaryFeatures）'
);

-- ============================================================
-- Part 2: ad_creative_generation → v4.33
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
AND version = 'v4.33';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_creative_generation'
AND version = 'v4.32';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_creative_generation',
  'v4.33',
  '广告创意生成',
  '广告创意生成v4.33 - 独立站增强数据支持',
  '增强版广告创意生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-creative-generator.ts',
  'generateAdCreative',
  $PROMPT$You are a professional Google Ads copywriter. Generate high-converting Responsive Search Ads.

=== OUTPUT FORMAT ===
JSON with 15 headlines (≤30 chars), 4 descriptions (≤90 chars), 15 keywords, 6 callouts (≤25 chars), 6 sitelinks (text≤25, desc≤35).

=== INPUT DATA ===
PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.33新增）===
{{extras_data}}

=== HEADLINE STRUCTURE: 2+4+4+2+3 (15 total) ===

**Group 1 - Brand (2)**: Include brand and product name
- Use {KeyWord:brand} for first headline
- Example: "{KeyWord:Roborock} Official"

**Group 2 - Features (4)**: Highlight technical specs
- 🔥 Use TECH SPECS and CORE FEATURES
- Include numbers: "25000 Pa Suction"

**Group 3 - Benefits (4)**: User benefits
- 🔥 Use USER PRAISES and SOCIAL PROOF METRICS
- Example: "5000+ Happy Customers"

**Group 4 - Questions (2)**: Address pain points
- 🔥 Use CUSTOMER FAQs and REAL USER REVIEWS
- Must end with "?"

**Group 5 - Urgency (3)**: Competitive/urgent
- 🔥 Use SOCIAL PROOF METRICS
- Include "Limited Time" or metrics

=== DESCRIPTION STRUCTURE: 2+1+1 (4 total) ===

**Template 1 - Feature+Benefit+CTA**: Use {{coreFeatures}} and {{techSpecs}}
**Template 2 - Problem+Solution+Proof**: Address {{customerFaqs}}, use {{realUserReviews}}
**Template 3 - Offer+Urgency+Trust**: Use {{promotionInfo}} and {{socialProofMetrics}}
**Template 4 - USP+Differentiation**: Highlight unique advantages

Each description MUST end with: Shop Now / Buy Now / Get Yours / Order Now / Learn More

=== CALLOUTS (2+2+2) ===
**Trust Signals (2)**: 🔥 Use {{socialProofMetrics}} - "18,000+ Users"
**Promotions (2)**: "Free Shipping", "Limited Time -23%"
**Features (2)**: 🔥 Use {{techSpecs}} - "25000Pa Suction"

=== SITELINKS (2+2+2) ===
**Products (2)**: 🔥 Use {{packageOptions}} - "Qrevo Curv 2 Pro"
**Brand (2)**: "Roborock Vacuums"
**Use Cases (2)**: 🔥 Use {{customerFaqs}} - "Pet Hair Solution"

=== RULES ===
1. Headlines ≤30 chars, Descriptions ≤90 chars
2. 2 question headlines (end with "?")
3. 1 urgency headline (Limited/Today/Now)
4. Brand word coverage: 3-4/15 (20-27%)
5. All descriptions with English CTA
6. 🔥 Leverage all enhanced data from {{extras_data}}$PROMPT$,
  'English',
  1,
  true,
  'v4.33: 新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、PACKAGE OPTIONS、SOCIAL PROOF METRICS、CORE FEATURES）'
);

-- ============================================================
-- Part 3: brand_analysis_store → v4.16
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'brand_analysis_store'
AND version = 'v4.16';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'brand_analysis_store'
AND version = 'v4.15';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'brand_analysis_store',
  'v4.16',
  '品牌分析',
  '品牌店铺分析v4.16 - 独立站增强数据支持',
  '增强版品牌店铺分析Prompt，新增独立站增强数据字段支持',
  'src/lib/ai.ts',
  'analyzeBrandStore',
  $PROMPT$You are a professional brand analyst. Analyze the BRAND STORE PAGE data.

=== INPUT DATA ===
URL: {{pageData.url}}
Brand: {{pageData.brand}}
Title: {{pageData.title}}
Description: {{pageData.description}}

=== STORE PRODUCTS DATA ===
{{pageData.text}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.16 New）===
User Reviews: {{reviews}}
FAQs: {{faqs}}
Tech Specs: {{specifications}}
Social Proof: {{socialProof}}
Core Features: {{coreFeatures}}

⚠️ USE THIS DATA: If available, incorporate into your analysis.

=== ANALYSIS PRIORITIES ===
1. Hot Products Analysis - Use {{technicalDetails}} and {{coreFeatures}}
2. Brand Positioning - Validate with {{socialProof}} metrics
3. Target Audience - Use {{faqs}} to understand concerns
4. Value Proposition - Validate with {{reviews}}
5. Quality Indicators - Customer sentiment from {{reviews}} and {{socialProof}}

=== OUTPUT LANGUAGE ===
All output MUST be in {{langName}}.

=== OUTPUT FORMAT ===
Return COMPLETE JSON with brand analysis and keywords.$PROMPT$,
  'English',
  1,
  true,
  'v4.16: 新增独立站增强数据字段支持（REAL USER REVIEWS、FAQ、TECHNICAL SPECS、SOCIAL PROOF）'
);

-- ============================================================
-- Part 4: ad_elements_descriptions → v4.15
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'ad_elements_descriptions'
AND version = 'v4.15';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_elements_descriptions'
AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_descriptions',
  'v4.15',
  '广告创意生成',
  '广告描述生成v4.15 - 独立站增强数据支持',
  '增强版广告描述生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts',
  'generateDescriptions',
  $PROMPT$You are a professional Google Ads copywriter. Generate 4 ad descriptions (max 90 chars each).

=== PRODUCT INFO ===
Product: {{productName}}
Brand: {{brand}}
Price: {{price}}
Rating: {{rating}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
CUSTOMER FAQs: {{customerFaqs}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== TASK ===
Generate 4 descriptions using these templates:
1. FEATURE-BENEFIT-CTA - Use {{coreFeatures}} and {{techSpecs}}
2. PROBLEM-SOLUTION-PROOF - Address concerns from {{customerFaqs}}, use {{realUserReviews}}
3. OFFER-URGENCY-TRUST - Use {{promotionInfo}} and {{socialProofMetrics}}
4. USP-DIFFERENTIATION - Highlight unique advantages

=== OUTPUT FORMAT ===
Return JSON: { "descriptions": ["d1", "d2", "d3", "d4"], "dataUtilization": { "enhancedDataUsed": true } }$PROMPT$,
  'Chinese',
  1,
  true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、CUSTOMER FAQs、TECH SPECS、SOCIAL PROOF METRICS）'
);

-- ============================================================
-- Part 5: ad_elements_headlines → v4.15
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'ad_elements_headlines'
AND version = 'v4.15';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'ad_elements_headlines'
AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'ad_elements_headlines',
  'v4.15',
  '广告创意生成',
  '广告标题生成v4.15 - 独立站增强数据支持',
  '增强版广告标题生成Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts',
  'generateHeadlines',
  $PROMPT$You are a professional Google Ads copywriter. Generate 15 ad headlines (max 30 chars each).

=== PRODUCT INFO ===
Product: {{product.name}}
Brand: {{product.brand}}
Rating: {{product.rating}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
REAL USER REVIEWS: {{realUserReviews}}
TECH SPECS: {{techSpecs}}
SOCIAL PROOF METRICS: {{socialProofMetrics}}
CORE FEATURES: {{coreFeatures}}

=== TASK ===
Generate 15 headlines in these groups:
1. Brand + USP (3) - From {{product.uniqueSellingPoints}} and {{coreFeatures}}
2. Keyword + Audience (3) - Combine {{topKeywords}} with {{product.targetAudience}}
3. Feature + Number (3) - From {{product.productHighlights}} and {{techSpecs}}
4. Social Proof (3) - Use {{trustBadges}} and {{socialProofMetrics}}
5. Question + Pain Point (3) - From {{realUserReviews}}

=== OUTPUT FORMAT ===
Return JSON: { "headlines": ["h1", "h2", ...(15)], "dataUtilization": { "enhancedDataUsed": true } }$PROMPT$,
  'Chinese',
  1,
  true,
  'v4.15: 新增独立站增强数据字段支持（REAL USER REVIEWS、TECH SPECS、SOCIAL PROOF METRICS、CORE FEATURES）'
);

-- ============================================================
-- Part 6: store_highlights_synthesis → v4.15
-- ============================================================

DELETE FROM prompt_versions
WHERE prompt_id = 'store_highlights_synthesis'
AND version = 'v4.15';

UPDATE prompt_versions
SET is_active = false
WHERE prompt_id = 'store_highlights_synthesis'
AND version = 'v4.14';

INSERT INTO prompt_versions (
  prompt_id, version, category, name, description, file_path, function_name,
  prompt_content, language, created_by, is_active, change_notes
) VALUES (
  'store_highlights_synthesis',
  'v4.15',
  '广告创意生成',
  '店铺产品亮点整合v4.15 - 独立站增强数据支持',
  '增强版店铺亮点整合Prompt，新增独立站增强数据字段支持',
  'src/lib/ad-elements-extractor.ts',
  'synthesizeStoreHighlights',
  $PROMPT$You are a product marketing expert. Synthesize product highlights from {{productCount}} products into 5-8 store-level highlights.

=== INPUT: Product Highlights ===
{{productHighlights}}

=== 🔥 INDEPENDENT STORE ENHANCED DATA（v4.15 New）===
STORE CORE FEATURES: {{coreFeatures}}
STORE SOCIAL PROOF METRICS: {{socialProofMetrics}}
STORE REVIEWS: {{storeReviews}}

=== TASK ===
Synthesize into 5-8 store highlights that:
1. Identify common themes and technologies
2. Highlight unique innovations
3. Focus on customer benefits
4. Incorporate {{socialProofMetrics}} for credibility
5. Validate with {{storeReviews}}

=== OUTPUT FORMAT ===
Return JSON: { "storeHighlights": ["h1", "h2", ...], "dataUtilization": { "enhancedDataUsed": true } }

Output in {{langName}}.$PROMPT$,
  'English',
  1,
  true,
  'v4.15: 新增独立站增强数据字段支持（SOCIAL PROOF METRICS、CORE FEATURES、STORE REVIEWS）'
);

-- ============================================================
-- Verification Query
-- ============================================================
-- SELECT prompt_id, version, name, is_active, created_at
-- FROM prompt_versions
-- WHERE prompt_id IN (
--   'product_analysis_single', 'ad_creative_generation', 'brand_analysis_store',
--   'ad_elements_descriptions', 'ad_elements_headlines', 'store_highlights_synthesis'
-- )
-- AND is_active = true
-- ORDER BY prompt_id;

-- ====================================================================
-- SOURCE: pg-migrations/131_add_enhanced_extraction_fields.pg.sql
-- ====================================================================
-- Migration: 131_add_enhanced_extraction_fields
-- Description: 为offers表补齐增强提取相关字段（修复生产库schema漂移：offers.enhanced_keywords等列缺失）
-- PostgreSQL版本
-- Date: 2026-01-04

-- 说明：
-- 1) PostgreSQL 使用 ADD COLUMN IF NOT EXISTS 保持幂等，避免部分环境已存在列时报错
-- 2) 保持与现有offers表一致：时间字段使用TEXT（与created_at/updated_at/scraped_at/extracted_at一致）
-- 3) JSON数据以TEXT存储（与review_analysis/competitor_analysis等一致），由应用层序列化/反序列化

ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_keywords TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_product_info TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS extraction_quality_score INTEGER;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS extraction_enhanced_at TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_headlines TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS enhanced_descriptions TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS localization_adapt TEXT;
ALTER TABLE offers ADD COLUMN IF NOT EXISTS brand_analysis TEXT;

-- 索引（用于筛选与排序）
CREATE INDEX IF NOT EXISTS idx_offers_extraction_quality
ON offers(extraction_quality_score);

CREATE INDEX IF NOT EXISTS idx_offers_extraction_enhanced_at
ON offers(extraction_enhanced_at);

-- 验证字段添加成功
SELECT 'offers增强提取字段添加成功' AS result;


-- ====================================================================
-- SOURCE: pg-migrations/132_remove_risk_type_column.pg.sql
-- ====================================================================
-- Migration: Remove risk_type field from risk_alerts table (PostgreSQL)
-- Date: 2026-01-06
-- Description: risk_type 和 alert_type 是重复字段，删除 risk_type 简化数据结构

DO $$
BEGIN
    -- 检查 risk_type 是否存在
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'risk_alerts' AND column_name = 'risk_type') THEN
        -- 删除外键约束（如果有）
        ALTER TABLE risk_alerts DROP CONSTRAINT IF EXISTS risk_alerts_risk_type_fkey;

        -- 删除 risk_type 字段
        ALTER TABLE risk_alerts DROP COLUMN risk_type;

        RAISE NOTICE 'risk_type column removed from risk_alerts table';
    ELSE
        RAISE NOTICE 'risk_type column does not exist, skipping';
    END IF;
END $$;

-- 清理可能存在的孤立索引
DROP INDEX IF EXISTS idx_risk_alerts_risk_type;

-- ====================================================================
-- SOURCE: pg-migrations/133_add_data_sync_global_templates.pg.sql
-- ====================================================================
-- Migration: 133_add_data_sync_global_templates.pg.sql
-- Date: 2026-01-07
-- Description: 添加 data_sync_enabled 和 data_sync_interval_hours 的全局模板记录
-- Note: PostgreSQL 版本，使用 INSERT ... WHERE NOT EXISTS 实现幂等插入

-- 添加 data_sync_enabled 全局模板
INSERT INTO system_settings (category, key, user_id, value, description, is_sensitive, data_type)
SELECT 'system', 'data_sync_enabled', NULL, NULL, '启用自动数据同步', false, 'boolean'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'system' AND key = 'data_sync_enabled' AND user_id IS NULL
);

-- 添加 data_sync_interval_hours 全局模板
INSERT INTO system_settings (category, key, user_id, value, description, is_sensitive, data_type)
SELECT 'system', 'data_sync_interval_hours', NULL, NULL, '数据同步间隔（小时）', false, 'number'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'system' AND key = 'data_sync_interval_hours' AND user_id IS NULL
);

-- ====================================================================
-- SOURCE: pg-migrations/134_fix_url_swap_offer_unique_soft_delete.pg.sql
-- ====================================================================
-- Migration: 134_fix_url_swap_offer_unique_soft_delete
-- Description: 修复url_swap_tasks的offer_id唯一约束与软删除/完成态冲突
-- PostgreSQL版本
--
-- 背景：
-- - 现有 uq_url_swap_offer UNIQUE(offer_id) 会导致：任务软删除后仍无法为同一Offer重新创建任务
-- - 同时也会导致：任务状态变为 completed 后，hasUrlSwapTask 允许创建但数据库仍会因唯一约束报错
--
-- 目标：
-- - 仅对“未删除且未完成”的任务保持 offer_id 唯一性
-- - 允许已删除/已完成任务存在历史记录，同时可重新创建新任务

-- 1) 删除旧的唯一约束（会同时删除底层唯一索引）
ALTER TABLE url_swap_tasks DROP CONSTRAINT IF EXISTS uq_url_swap_offer;

-- 2) 兜底：如果还有同名唯一索引，显式删除（不同环境可能出现）
DROP INDEX IF EXISTS uq_url_swap_offer;

-- 3) 创建部分唯一索引：仅约束未删除且未完成的记录
CREATE UNIQUE INDEX IF NOT EXISTS uq_url_swap_offer_active
  ON url_swap_tasks (offer_id)
  WHERE is_deleted = FALSE AND status <> 'completed';


-- ====================================================================
-- SOURCE: pg-migrations/135_add_google_ads_test_credentials.pg.sql
-- ====================================================================
-- Migration: 135_add_google_ads_test_credentials.pg.sql
-- Date: 2026-01-08
-- Description: 添加 google_ads_test_credentials 表 + Google Ads 测试OAuth配置模板（system_settings）
-- Note: PostgreSQL 版本，使用 INSERT ... WHERE NOT EXISTS 实现幂等插入

-- 1) 测试OAuth凭证表（与 google_ads_credentials 隔离，避免影响现有OAuth用户授权）
CREATE TABLE IF NOT EXISTS google_ads_test_credentials (
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

-- 2) system_settings 全局模板：Google Ads “测试权限MCC诊断”专用配置项
INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
SELECT NULL, 'google_ads', 'test_login_customer_id', NULL, 'string', false, false, '【测试】Login Customer ID (MCC账户ID)'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads' AND key = 'test_login_customer_id' AND user_id IS NULL AND value IS NULL
);

INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
SELECT NULL, 'google_ads', 'test_client_id', NULL, 'string', true, false, '【测试】OAuth Client ID（仅用于测试诊断，不影响现有OAuth）'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads' AND key = 'test_client_id' AND user_id IS NULL AND value IS NULL
);

INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
SELECT NULL, 'google_ads', 'test_client_secret', NULL, 'string', true, false, '【测试】OAuth Client Secret（仅用于测试诊断，不影响现有OAuth）'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads' AND key = 'test_client_secret' AND user_id IS NULL AND value IS NULL
);

INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, is_required, description)
SELECT NULL, 'google_ads', 'test_developer_token', NULL, 'string', true, false, '【测试】Developer Token（测试权限/Test access，用于验证MCC调用限制）'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'google_ads' AND key = 'test_developer_token' AND user_id IS NULL AND value IS NULL
);


-- ====================================================================
-- SOURCE: pg-migrations/136_add_google_ads_accounts_identity_verification.pg.sql
-- ====================================================================
-- Migration: 136_add_google_ads_accounts_identity_verification.pg.sql
-- Date: 2026-01-08
-- Description: 为 google_ads_accounts 增加广告主身份验证（Identity Verification）字段

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_program_status TEXT;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_start_deadline_time TEXT;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_completion_deadline_time TEXT;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_overdue BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE google_ads_accounts
ADD COLUMN identity_verification_checked_at TEXT;


-- ====================================================================
-- SOURCE: pg-migrations/137_add_offer_tasks_brand_name.pg.sql
-- ====================================================================
-- 新增：Offer创建/提取任务可选品牌名输入
-- 用途：独立站场景下，使用用户填写的品牌名进行Google搜索补充信息
ALTER TABLE offer_tasks ADD COLUMN IF NOT EXISTS brand_name TEXT;

-- ====================================================================
-- SOURCE: pg-migrations/138_add_campaign_published_at.pg.sql
-- ====================================================================
-- Add published_at to campaigns to track successful publish time (used by Campaigns "投放日期")
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS published_at TEXT;

-- Backfill: for already-published campaigns, use created_at as best-effort publish time
UPDATE campaigns
SET published_at = created_at
WHERE published_at IS NULL
  AND google_campaign_id IS NOT NULL
  AND google_campaign_id != ''
  AND creation_status = 'synced';


-- ====================================================================
-- SOURCE: pg-migrations/139_ad_creative_generation_v4.34.pg.sql
-- ====================================================================
-- Migration: 139_ad_creative_generation_v4.34.pg.sql
-- Description: ad_creative_generation v4.34 - KISS-3类型 + 证据约束 + Headline#2主关键词
-- Date: 2026-01-14
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 幂等写入新版本（若已存在则更新内容）
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
) VALUES (
  'ad_creative_generation',
  'v4.34',
  '广告创意生成',
  '广告创意生成v4.34 - KISS 3类型+证据约束',
  '收敛为3个用户可见创意类型（A/B/D），强化证据约束，新增Headline#2主关键词且不含品牌',
  'prompts/ad_creative_generation_v4.34.txt',
  'buildAdCreativePrompt',
  $$-- ============================================
-- Google Ads 广告创意生成 v4.34
-- KISS-3类型：A(品牌导向/brand_intent) + B(商品型号导向/model_intent) + D(品牌+商品导向/product_intent)
-- 强制证据约束 + Headline#2 主关键词规则
-- ============================================

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## ⚠️ 字符限制（CRITICAL - 必须严格遵守）
生成时必须控制长度，不得依赖后端截断：
- Headlines：每个≤30字符（含空格、标点）
- Descriptions：每个≤90字符（含空格、标点）
- Callouts：每个≤25字符
- Sitelink text：每个≤25字符
- Sitelink description：每个≤35字符

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks
3. 所有创意元素必须与单品/店铺链接类型一致
4. 每个元素必须语义完整，不得因字符限制而截断句子

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}

{{verified_facts_section}}

{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## ✅ Evidence-Only Claims（CRITICAL）
你必须严格遵守以下规则，避免虚假陈述：
- 只能使用“VERIFIED FACTS”中出现过的数字、折扣、限时、保障/支持承诺、覆盖范围、速度/时长等可验证信息
- 如果VERIFIED FACTS中没有对应信息：不得编造，不得“默认有”，改用不含数字/不含承诺的表述
- 不得写“24/7”“X分钟开通”“覆盖X国”“X%折扣”“退款保证”“终身”等，除非VERIFIED FACTS明确提供

## 关键词使用规则
{{ai_keywords_section}}
{{keyword_bucket_section}}
{{bucket_info_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量更高的关键词
- 品牌词必须至少出现在2个标题中

## 标题规则（15个，≤30字符）

### Headline #1（MANDATORY）
- 必须是：{KeyWord:{{brand}}} Official（如超长则允许仅 {KeyWord:{{brand}}}）
- 仅Headline #1允许使用 {KeyWord:...}（其他标题禁止使用DKI格式）

### Headline #2（MANDATORY）
- 必须自然包含主关键词：{{primary_keyword}}
- 必须不包含品牌词（避免与Headline #1重复）
- 不得使用DKI格式

### 标题类型分布（保持多样性）
使用以下指导生成剩余标题，避免重复表达：
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

**问题型标题（必需）**：
- 至少2个标题为问题句（以?结尾），用于刺痛/共鸣（但不得编造事实）

## 描述规则（4个，≤90字符）
要求：每条描述都必须包含关键词，并以“目标语言的CTA”结尾（不得混语言）。

### 描述结构（必须覆盖）
{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**Pain → Solution（必需）**：
- 至少1条描述必须按：痛点短句 → 解决方案 →（若有）证据点 → CTA
- 证据点只能来自 VERIFIED FACTS / PROMOTION / EXTRACTED 元素

## Callouts（6个，≤25字符）
{{callout_guidance}}

## 桶类型适配（KISS-3类型）
根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌导向 / brand_intent）
- 所有广告语与关键词都必须同时关联品牌与商品/品类
- 兼顾精准度与覆盖度，保持当前关键词匹配策略

### 桶B（商品型号导向 / model_intent）
- 单品链接：围绕当前商品型号/系列；店铺链接：围绕已验证热门商品型号/系列
- 所有广告语必须紧扣已验证型号/系列，禁止退化为泛品牌/泛场景文案
- 关键词覆盖品牌 + 型号/系列 + 品类长尾词，并统一使用完全匹配

### 桶D（品牌+商品导向 / product_intent）
- 所有广告语与关键词都必须同时关联品牌与商品/品类
- 以覆盖为目标，覆盖全量高质量关键词，保持当前关键词匹配策略

## 输出（JSON only）
{{output_format_section}}$$,
  'Chinese',
  1,
  TRUE,
  $$v4.34:
1) 仅3个用户可见创意类型（A/B/D），C->B、S->D
2) 强制证据约束（VERIFIED FACTS），禁止编造数字/承诺
3) Headline #1 固定DKI品牌；Headline #2 必须用主关键词且不含品牌
4) 描述CTA要求：使用目标语言（不混语言）$$,
  NOW()
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  change_notes = EXCLUDED.change_notes,
  is_active = EXCLUDED.is_active;

-- 3) 激活新版本
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.34';

-- ====================================================================
-- SOURCE: pg-migrations/140_ad_creative_generation_v4.35.pg.sql
-- ====================================================================
-- Migration: 140_ad_creative_generation_v4.35.pg.sql
-- Description: ad_creative_generation v4.35 - Headline #2 使用DKI高购买意图关键词
-- Date: 2026-01-15
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'ad_creative_generation' AND is_active = TRUE;

-- 2) 幂等写入新版本（若已存在则更新内容）
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
) VALUES (
  'ad_creative_generation',
  'v4.35',
  '广告创意生成',
  '广告创意生成v4.35 - Headline#2 DKI主关键词',
  'Headline #2 强制使用高购买意图主关键词的DKI格式（与Headline #1品牌DKI并存），其余标题禁止DKI；保留证据约束与KISS-3类型',
  'prompts/ad_creative_generation_v4.35.txt',
  'buildAdCreativePrompt',
  $$-- ============================================
-- Google Ads 广告创意生成 v4.35
-- KISS-3类型：A(品牌导向/brand_intent) + B(商品型号导向/model_intent) + D(品牌+商品导向/product_intent)
-- 强制证据约束 + Headline#2 主关键词DKI（高购买意图）
-- ============================================

## 任务
为 Google Ads 生成高质量的广告创意（Responsive Search Ads）。

## ⚠️ 字符限制（CRITICAL - 必须严格遵守）
生成时必须控制长度，不得依赖后端截断：
- Headlines：每个≤30字符（含空格、标点）
- Descriptions：每个≤90字符（含空格、标点）
- Callouts：每个≤25字符
- Sitelink text：每个≤25字符
- Sitelink description：每个≤35字符

## 基本要求
1. 所有内容必须使用目标语言：{{target_language}}
2. 固定数量：15个标题，4个描述，15个关键词，6个Callouts，6个Sitelinks
3. 所有创意元素必须与单品/店铺链接类型一致
4. 每个元素必须语义完整，不得因字符限制而截断句子

## 语言指令
{{language_instruction}}

## 产品/店铺信息
{{link_type_section}}

PRODUCT: {{product_description}}
USPs: {{unique_selling_points}}
AUDIENCE: {{target_audience}}
COUNTRY: {{target_country}} | LANGUAGE: {{target_language}}

{{enhanced_features_section}}
{{localization_section}}
{{brand_analysis_section}}
{{extras_data}}

{{verified_facts_section}}

{{promotion_section}}
{{theme_section}}
{{reference_performance_section}}
{{extracted_elements_section}}

## ✅ Evidence-Only Claims（CRITICAL）
你必须严格遵守以下规则，避免虚假陈述：
- 只能使用“VERIFIED FACTS”中出现过的数字、折扣、限时、保障/支持承诺、覆盖范围、速度/时长等可验证信息
- 如果VERIFIED FACTS中没有对应信息：不得编造，不得“默认有”，改用不含数字/不含承诺的表述
- 不得写“24/7”“X分钟开通”“覆盖X国”“X%折扣”“退款保证”“终身”等，除非VERIFIED FACTS明确提供

## 关键词使用规则
{{ai_keywords_section}}
{{keyword_bucket_section}}
{{bucket_info_section}}

**关键词嵌入规则**：
- 8/15 (53%+) 标题必须包含关键词
- 4/4 (100%) 描述必须包含关键词
- 优先使用搜索量更高的关键词
- 品牌词必须至少出现在2个标题中

## 标题规则（15个，≤30字符）

### Headline #1（MANDATORY）
- 必须是：{KeyWord:{{brand}}} Official（如超长则允许仅 {KeyWord:{{brand}}}）
- 只允许使用品牌词作为默认文本（避免无关替换）

### Headline #2（MANDATORY）
- 必须是高购买意图主关键词的DKI：{KeyWord:{{primary_keyword}}}
- {{primary_keyword}} 必须不包含品牌词（避免与Headline #1重复）
- {{primary_keyword}} 必须是购买意图更强的“核心词/交易词”（如 price / deal / buy / discount 等方向），但不得编造证据

### DKI使用限制（CRITICAL）
- 仅Headline #1 和 Headline #2 允许使用 {KeyWord:...}
- 其他标题禁止使用DKI格式

### 标题类型分布（保持多样性）
使用以下指导生成剩余标题，避免重复表达：
{{headline_brand_guidance}}
{{headline_feature_guidance}}
{{headline_promo_guidance}}
{{headline_cta_guidance}}
{{headline_urgency_guidance}}

**问题型标题（必需）**：
- 至少2个标题为问题句（以?结尾），用于刺痛/共鸣（但不得编造事实）

## 描述规则（4个，≤90字符）
要求：每条描述都必须包含关键词，并以“目标语言的CTA”结尾（不得混语言）。

### 描述结构（必须覆盖）
{{description_1_guidance}}
{{description_2_guidance}}
{{description_3_guidance}}
{{description_4_guidance}}

**Pain → Solution（必需）**：
- 至少1条描述必须按：痛点短句 → 解决方案 →（若有）证据点 → CTA
- 证据点只能来自 VERIFIED FACTS / PROMOTION / EXTRACTED 元素

## Callouts（6个，≤25字符）
{{callout_guidance}}

## 桶类型适配（KISS-3类型）
根据 {{bucket_type}} 调整创意角度：

### 桶A（品牌导向 / brand_intent）
- 所有广告语与关键词都必须同时关联品牌与商品/品类
- 兼顾精准度与覆盖度，保持当前关键词匹配策略

### 桶B（商品型号导向 / model_intent）
- 单品链接：围绕当前商品型号/系列；店铺链接：围绕已验证热门商品型号/系列
- 所有广告语必须紧扣已验证型号/系列，禁止退化为泛品牌/泛场景文案
- Headline #2 的 DKI 默认文本必须锚定已验证型号/系列且不含品牌
- 关键词覆盖品牌 + 型号/系列 + 品类长尾词，并统一使用完全匹配

### 桶D（品牌+商品导向 / product_intent）
- 所有广告语与关键词都必须同时关联品牌与商品/品类
- 以覆盖为目标，覆盖全量高质量关键词，保持当前关键词匹配策略

## 输出（JSON only）
{{output_format_section}}$$,
  'Chinese',
  1,
  TRUE,
  'v4.35:
1) Headline #2 强制使用主关键词DKI（高购买意图），与Headline #1品牌DKI并存
2) DKI使用限制：仅允许在Headline #1/#2，其余标题禁止DKI
3) 继续保留KISS-3类型（A/B/D）与Evidence-Only Claims约束',
  NOW()
)
ON CONFLICT (prompt_id, version) DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  change_notes = EXCLUDED.change_notes,
  is_active = EXCLUDED.is_active;

-- 3) 激活新版本
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.35';


-- ====================================================================
-- Mark included migrations as applied
-- ====================================================================
INSERT INTO migration_history (migration_name) VALUES
  ('064_consolidated_schema_changes.pg.sql'),
  ('065_consolidated_prompt_ad_creative.pg.sql'),
  ('066_consolidated_prompt_analysis.pg.sql'),
  ('067_fix_prompt_missing_variables.pg.sql'),
  ('068_sync_prompt_versions.pg.sql'),
  ('069_deprecate_keywords_generation_prompt.pg.sql'),
  ('070_keyword_pools_and_prompts.pg.sql'),
  ('071_rename_product_to_brand_oriented.pg.sql'),
  ('072_add_synthetic_bucket.pg.sql'),
  ('073_update_review_analysis_prompt_v3.3.pg.sql'),
  ('074_launch_scores_creative_link.pg.sql'),
  ('075_fix_global_keywords_schema.pg.sql'),
  ('076_update_all_prompts_v4.14.pg.sql'),
  ('077_enhance_audit_system.pg.sql'),
  ('078_fix_boolean_columns.pg.sql'),
  ('079_update_gemini_model_config.pg.sql'),
  ('080_launch_score_v4.15_prompt_activation.pg.sql'),
  ('081_launch_score_v4.16_matchtype_scoring.pg.sql'),
  ('082_add_negative_keyword_matchtype.pg.sql'),
  ('083_update_queue_config_campaign_publish.pg.sql'),
  ('084_add_system_settings_unique_constraint.pg.sql'),
  ('085_add_missing_proxy_urls_template.pg.sql'),
  ('086_fix_system_settings_unique_constraint.pg.sql'),
  ('087_restore_global_templates.pg.sql'),
  ('088_add_bucket_d_to_keyword_pools.pg.sql'),
  ('089_add_bucket_d_to_ad_creatives.pg.sql'),
  ('090_update_keyword_intent_clustering_v4.15.pg.sql'),
  ('091_092_093_update_prompts_v4.15.pg.sql'),
  ('092_sync_competition_data_to_global_keywords.pg.sql'),
  ('094_add_batch_cancellation.pg.sql'),
  ('095_create_google_ads_service_accounts.pg.sql'),
  ('096_update_ad_creative_generation_v4.15.pg.sql'),
  ('097_ad_creative_types_optimization.pg.sql'),
  ('098_add_store_keyword_buckets.pg.sql'),
  ('099_keyword_clustering_v4.16.pg.sql'),
  ('100_keyword_clustering_v4.17.pg.sql'),
  ('101_ad_creative_generation_v4.17_final.pg.sql'),
  ('102_fix_generated_buckets_inconsistency.pg.sql'),
  ('103_keyword_clustering_v4.18_enhanced.pg.sql'),
  ('104_fix_timestamp_columns.pg.sql'),
  ('105_strict_json_format_constraint.pg.sql'),
  ('106_sitelinks_count_6.pg.sql'),
  ('107_single_product_focus_prompt_v4.18.pg.sql'),
  ('108_fix_google_ads_account_id_on_delete.pg.sql'),
  ('108_product_model_emphasis_v4.19.pg.sql'),
  ('109_create_offer_blacklist.pg.sql'),
  ('110_bucket_type_differentiation_v4.20.pg.sql'),
  ('111_prompt_v4.21_store_link_sitelink_optional.pg.sql'),
  ('112_prompt_v4.22_reduce_product_model_emphasis.pg.sql'),
  ('113_prompt_v4.25_headline_diversity_and_bucket_adaptation.pg.sql'),
  ('114_prompt_v4.26_clean.pg.sql'),
  ('115_prompt_v4.30_final.pg.sql'),
  ('116_prompt_v4.31_ad_strength_optimization.pg.sql'),
  ('117_prompt_v4.32_brand_coverage_optimization.pg.sql'),
  ('118_click_farm_tasks.pg.sql'),
  ('119_drop_ad_performance_table.pg.sql'),
  ('120_user_sessions.pg.sql'),
  ('121_auto_sync_batch_status.pg.sql'),
  ('122_combined_migration.pg.sql'),
  ('123_add_soft_delete_to_core_tables.pg.sql'),
  ('124_add_click_farm_referer_config.pg.sql'),
  ('125_gemini_api_keys_and_provider_templates.pg.sql'),
  ('126_add_currency_to_campaign_performance.pg.sql'),
  ('127_fix_click_farm_tasks_foreign_key.pg.sql'),
  ('128_create_url_swap_tasks.pg.sql'),
  ('129_add_consecutive_failures.pg.sql'),
  ('130_update_prompts_enhanced_data.pg.sql'),
  ('131_add_enhanced_extraction_fields.pg.sql'),
  ('132_remove_risk_type_column.pg.sql'),
  ('133_add_data_sync_global_templates.pg.sql'),
  ('134_fix_url_swap_offer_unique_soft_delete.pg.sql'),
  ('135_add_google_ads_test_credentials.pg.sql'),
  ('136_add_google_ads_accounts_identity_verification.pg.sql'),
  ('137_add_offer_tasks_brand_name.pg.sql'),
  ('138_add_campaign_published_at.pg.sql'),
  ('139_ad_creative_generation_v4.34.pg.sql'),
  ('140_ad_creative_generation_v4.35.pg.sql')
ON CONFLICT (migration_name) DO NOTHING;

-- ==========================================
-- Reset sequences after seed data
-- ==========================================
SELECT setval('prompt_versions_id_seq', (SELECT COALESCE(MAX(id), 1) FROM prompt_versions));

-- ====================================================================
-- Consolidated forward-compat: 165_add_openclaw_skills_templates.pg.sql
-- ====================================================================
INSERT INTO system_settings (
  category,
  key,
  user_id,
  value,
  default_value,
  description,
  is_sensitive,
  is_required,
  data_type
)
SELECT
  'openclaw',
  'openclaw_skills_entries_json',
  NULL,
  NULL,
  NULL,
  'OpenClaw skills.entries 覆盖配置 JSON（启用/禁用技能或注入技能配置）',
  false,
  false,
  'json'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_skills_entries_json' AND user_id IS NULL
);

INSERT INTO system_settings (
  category,
  key,
  user_id,
  value,
  default_value,
  description,
  is_sensitive,
  is_required,
  data_type
)
SELECT
  'openclaw',
  'openclaw_skills_allow_bundled_json',
  NULL,
  NULL,
  NULL,
  'OpenClaw skills.allowBundled 白名单 JSON 数组（控制可用内置技能）',
  false,
  false,
  'json'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw' AND key = 'openclaw_skills_allow_bundled_json' AND user_id IS NULL
);

INSERT INTO migration_history (migration_name)
SELECT '165_add_openclaw_skills_templates.pg.sql'
WHERE NOT EXISTS (
  SELECT 1
  FROM migration_history
  WHERE migration_name = '165_add_openclaw_skills_templates.pg.sql'
);
