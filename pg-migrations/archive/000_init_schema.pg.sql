-- ==========================================
-- PostgreSQL Schema Initialization
-- Version: 1.0.0
-- Generated: 2025-12-03
-- Tables: 38
-- ==========================================

-- users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  display_name TEXT,
  google_id TEXT UNIQUE,
  profile_picture TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  package_type TEXT NOT NULL DEFAULT 'trial',
  package_expires_at TIMESTAMP,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP,
  last_failed_login TIMESTAMP,
  last_login_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- google_ads_accounts
CREATE TABLE IF NOT EXISTS google_ads_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  customer_id TEXT NOT NULL,
  account_name TEXT,
  currency TEXT NOT NULL DEFAULT 'CNY',
  timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
  is_manager_account BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  parent_mcc_id TEXT,
  test_account BOOLEAN NOT NULL DEFAULT FALSE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, customer_id)
);

-- offers
CREATE TABLE IF NOT EXISTS offers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  brand TEXT NOT NULL,
  product_name TEXT,
  category TEXT,
  target_country TEXT NOT NULL,
  target_language TEXT,
  offer_name TEXT,  -- 用户级别唯一，通过 UNIQUE(user_id, offer_name) 约束实现
  affiliate_link TEXT,
  brand_description TEXT,
  unique_selling_points TEXT,
  product_highlights TEXT,
  target_audience TEXT,
  final_url TEXT,
  final_url_suffix TEXT,
  product_price TEXT,
  commission_payout TEXT,
  scrape_status TEXT NOT NULL DEFAULT 'pending',
  scrape_error TEXT,
  scraped_at TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  industry_code TEXT,
  review_analysis TEXT,
  competitor_analysis TEXT,
  visual_analysis TEXT,
  extracted_keywords TEXT,
  extracted_headlines TEXT,
  extracted_descriptions TEXT,
  extraction_metadata TEXT,
  extracted_at TIMESTAMP,
  enhanced_keywords TEXT,
  enhanced_product_info TEXT,
  enhanced_review_analysis TEXT,
  extraction_quality_score INTEGER,
  extraction_enhanced_at TIMESTAMP,
  enhanced_headlines TEXT,
  enhanced_descriptions TEXT,
  localization_adapt TEXT,
  brand_analysis TEXT,
  pricing TEXT,
  promotions TEXT,
  scraped_data TEXT,
  product_currency TEXT DEFAULT 'USD',
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, offer_name)  -- 用户级别唯一，不同用户可以有相同的 offer_name
);
CREATE INDEX IF NOT EXISTS idx_offers_user_id ON offers(user_id);
CREATE INDEX IF NOT EXISTS idx_offers_offer_name ON offers(offer_name);
CREATE INDEX IF NOT EXISTS idx_offers_is_deleted ON offers(is_deleted);
CREATE INDEX IF NOT EXISTS idx_offers_deleted_at ON offers(deleted_at);

-- ad_creatives
CREATE TABLE IF NOT EXISTS ad_creatives (
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
  score REAL,
  score_breakdown TEXT,
  score_explanation TEXT,
  ad_strength TEXT DEFAULT 'UNKNOWN',
  generation_round INTEGER DEFAULT 1,
  theme TEXT,
  ai_model TEXT,
  is_selected BOOLEAN DEFAULT FALSE,
  ab_test_variant_id INTEGER,
  google_campaign_id TEXT,
  industry_code TEXT,
  orientation TEXT,
  brand TEXT,
  url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_offer_id ON ad_creatives(offer_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_user_id ON ad_creatives(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_is_selected ON ad_creatives(is_selected);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_ab_test_variant ON ad_creatives(ab_test_variant_id);

-- campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  campaign_id TEXT UNIQUE,
  campaign_name TEXT NOT NULL,
  budget_amount REAL NOT NULL,
  budget_type TEXT NOT NULL DEFAULT 'DAILY',
  target_cpa REAL,
  max_cpc REAL,
  status TEXT NOT NULL DEFAULT 'PAUSED',
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT,
  last_sync_at TIMESTAMP,
  ad_creative_id INTEGER,
  google_campaign_id TEXT,
  google_ad_group_id TEXT,
  google_ad_id TEXT,
  campaign_config TEXT,
  pause_old_campaigns BOOLEAN,
  is_test_variant BOOLEAN DEFAULT FALSE,
  ab_test_id INTEGER,
  traffic_allocation REAL DEFAULT 1 CHECK(traffic_allocation >= 0 AND traffic_allocation <= 1),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_campaigns_user_id ON campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_offer_id ON campaigns(offer_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_is_test_variant ON campaigns(is_test_variant);
CREATE INDEX IF NOT EXISTS idx_campaigns_ab_test_id ON campaigns(ab_test_id);

-- ad_groups
CREATE TABLE IF NOT EXISTS ad_groups (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  ad_group_id TEXT UNIQUE,
  ad_group_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PAUSED',
  cpc_bid_micros BIGINT,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ad_groups_user_id ON ad_groups(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_groups_campaign_id ON ad_groups(campaign_id);

-- keywords
CREATE TABLE IF NOT EXISTS keywords (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  ad_group_id INTEGER NOT NULL,
  keyword_id TEXT UNIQUE,
  keyword_text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'BROAD',
  status TEXT NOT NULL DEFAULT 'PAUSED',
  cpc_bid_micros BIGINT,
  final_url TEXT,
  is_negative BOOLEAN NOT NULL DEFAULT FALSE,
  quality_score INTEGER,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  generation_source TEXT,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_group_id) REFERENCES ad_groups(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_keywords_user_id ON keywords(user_id);
CREATE INDEX IF NOT EXISTS idx_keywords_ad_group_id ON keywords(ad_group_id);
CREATE INDEX IF NOT EXISTS idx_keywords_status ON keywords(status);

-- global_keywords
CREATE TABLE IF NOT EXISTS global_keywords (
  id SERIAL PRIMARY KEY,
  keyword_text TEXT NOT NULL UNIQUE,
  category TEXT,
  search_volume BIGINT,
  competition_level TEXT,
  avg_cpc_micros BIGINT,
  language TEXT DEFAULT 'en',
  country TEXT DEFAULT 'US',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- launch_scores
CREATE TABLE IF NOT EXISTS launch_scores (
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
  calculated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- weekly_recommendations
CREATE TABLE IF NOT EXISTS weekly_recommendations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  recommendation_type TEXT NOT NULL,
  recommendation_data TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  status TEXT NOT NULL DEFAULT 'pending',
  applied_at TIMESTAMP,
  week_start_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
);

-- optimization_recommendations
CREATE TABLE IF NOT EXISTS optimization_recommendations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  recommendation_id TEXT NOT NULL UNIQUE,
  recommendation_type TEXT NOT NULL,
  impact TEXT,
  recommendation_data TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  applied_at TIMESTAMP,
  dismissed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
);

-- optimization_tasks
CREATE TABLE IF NOT EXISTS optimization_tasks (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  task_type TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'MEDIUM',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  related_entity_type TEXT,
  related_entity_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- campaign_performance
CREATE TABLE IF NOT EXISTS campaign_performance (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  ctr REAL,
  cpc REAL,
  cpa REAL,
  conversion_rate REAL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  UNIQUE(campaign_id, date)
);
CREATE INDEX IF NOT EXISTS idx_performance_campaign_date ON campaign_performance(campaign_id, date);
CREATE INDEX IF NOT EXISTS idx_performance_user_date ON campaign_performance(user_id, date);

-- ad_performance
CREATE TABLE IF NOT EXISTS ad_performance (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  google_campaign_id TEXT NOT NULL,
  google_ad_group_id TEXT,
  google_ad_id TEXT,
  date DATE NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions REAL DEFAULT 0,
  cost_micros BIGINT DEFAULT 0,
  ctr REAL,
  cpc_micros BIGINT,
  conversion_rate REAL,
  raw_data TEXT,
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(google_campaign_id, google_ad_id, date)
);

-- search_term_reports
CREATE TABLE IF NOT EXISTS search_term_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  campaign_id INTEGER NOT NULL,
  search_term TEXT NOT NULL,
  match_type TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  conversions REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);

-- rate_limits
CREATE TABLE IF NOT EXISTS rate_limits (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  api_name TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMP NOT NULL,
  window_end TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- system_settings
CREATE TABLE IF NOT EXISTS system_settings (
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
  last_validated_at TIMESTAMP,
  default_value TEXT,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- cpc_adjustment_history
CREATE TABLE IF NOT EXISTS cpc_adjustment_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  adjustment_type TEXT NOT NULL,
  adjustment_value REAL NOT NULL,
  affected_campaign_count INTEGER NOT NULL,
  campaign_ids TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- risk_alerts
CREATE TABLE IF NOT EXISTS risk_alerts (
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
  resolved_at TIMESTAMP,
  resolved_by INTEGER,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  alert_type TEXT,
  resource_type TEXT,
  resource_id INTEGER,
  details TEXT,
  acknowledged_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolved_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_status ON risk_alerts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_alert_type ON risk_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_risk_alerts_resource ON risk_alerts(resource_type, resource_id);

-- link_check_history
CREATE TABLE IF NOT EXISTS link_check_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  is_accessible BOOLEAN NOT NULL,
  http_status_code INTEGER,
  response_time_ms INTEGER,
  brand_found BOOLEAN,
  content_valid BOOLEAN,
  validation_message TEXT,
  proxy_used TEXT,
  target_country TEXT,
  error_message TEXT,
  checked_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_link_check_offer ON link_check_history(offer_id);

-- creative_versions
CREATE TABLE IF NOT EXISTS creative_versions (
  id SERIAL PRIMARY KEY,
  creative_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  headlines TEXT NOT NULL,
  descriptions TEXT NOT NULL,
  final_url TEXT NOT NULL,
  path_1 TEXT,
  path_2 TEXT,
  quality_score INTEGER,
  quality_details TEXT,
  budget_amount REAL,
  clicks INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  created_by TEXT NOT NULL,
  creation_method TEXT NOT NULL,
  change_summary TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_creative_versions_creative_id ON creative_versions(creative_id);
CREATE INDEX IF NOT EXISTS idx_creative_versions_version ON creative_versions(creative_id, version_number);

-- sync_logs
CREATE TABLE IF NOT EXISTS sync_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  google_ads_account_id INTEGER NOT NULL,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL,
  record_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (google_ads_account_id) REFERENCES google_ads_accounts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON sync_logs(user_id, started_at);

-- creative_learning_patterns
CREATE TABLE IF NOT EXISTS creative_learning_patterns (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  success_features TEXT NOT NULL,
  total_creatives_analyzed INTEGER NOT NULL DEFAULT 0,
  avg_ctr REAL,
  avg_conversion_rate REAL,
  min_ctr_threshold REAL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_creative_learning_user_id ON creative_learning_patterns(user_id);

-- scraped_products
CREATE TABLE IF NOT EXISTS scraped_products (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  product_title TEXT NOT NULL,
  product_url TEXT,
  price REAL,
  rating REAL,
  review_count INTEGER,
  hot_score REAL,
  badges TEXT,
  is_prime BOOLEAN,
  is_promotion BOOLEAN,
  scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- backup_logs
CREATE TABLE IF NOT EXISTS backup_logs (
  id SERIAL PRIMARY KEY,
  backup_type TEXT NOT NULL,
  status TEXT NOT NULL,
  backup_filename TEXT,
  backup_path TEXT,
  file_size_bytes BIGINT,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(status);

-- ab_tests
CREATE TABLE IF NOT EXISTS ab_tests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  test_name TEXT NOT NULL,
  test_description TEXT,
  test_type TEXT NOT NULL CHECK(test_type IN ('headline', 'description', 'keyword', 'callout', 'sitelink', 'full_creative')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
  start_date TIMESTAMP,
  end_date TIMESTAMP,
  winner_variant_id INTEGER,
  statistical_confidence REAL,
  min_sample_size INTEGER DEFAULT 100,
  confidence_level REAL DEFAULT 0.95,
  is_auto_test BOOLEAN DEFAULT TRUE,
  test_mode TEXT DEFAULT 'manual' CHECK(test_mode IN ('launch_multi_variant', 'optimization_challenge', 'manual')),
  parent_campaign_id INTEGER,
  test_dimension TEXT DEFAULT 'creative' CHECK(test_dimension IN ('creative', 'strategy')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ab_tests_user_id ON ab_tests(user_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_offer_id ON ab_tests(offer_id);
CREATE INDEX IF NOT EXISTS idx_ab_tests_status ON ab_tests(status);
CREATE INDEX IF NOT EXISTS idx_ab_tests_dates ON ab_tests(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_ab_tests_parent_campaign ON ab_tests(parent_campaign_id);

-- ab_test_variants
CREATE TABLE IF NOT EXISTS ab_test_variants (
  id SERIAL PRIMARY KEY,
  ab_test_id INTEGER NOT NULL,
  variant_name TEXT NOT NULL,
  variant_label TEXT,
  ad_creative_id INTEGER NOT NULL,
  traffic_allocation REAL NOT NULL DEFAULT 0.5 CHECK(traffic_allocation >= 0 AND traffic_allocation <= 1),
  is_control BOOLEAN NOT NULL DEFAULT FALSE,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  ctr REAL,
  conversion_rate REAL,
  cpa REAL,
  confidence_interval_lower REAL,
  confidence_interval_upper REAL,
  p_value REAL,
  last_updated_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ab_test_id) REFERENCES ab_tests(id) ON DELETE CASCADE,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,
  UNIQUE(ab_test_id, variant_name)
);
CREATE INDEX IF NOT EXISTS idx_ab_test_variants_test_id ON ab_test_variants(ab_test_id);
CREATE INDEX IF NOT EXISTS idx_ab_test_variants_creative_id ON ab_test_variants(ad_creative_id);

-- google_ads_credentials
CREATE TABLE IF NOT EXISTS google_ads_credentials (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  client_id TEXT,
  client_secret TEXT,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  developer_token TEXT,
  login_customer_id TEXT NOT NULL,
  access_token_expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE,
  last_verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- google_ads_api_usage
CREATE TABLE IF NOT EXISTS google_ads_api_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  operation_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  customer_id TEXT,
  request_count INTEGER DEFAULT 1,
  response_time_ms INTEGER,
  is_success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  date DATE NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_google_ads_api_usage_date ON google_ads_api_usage(date, user_id);
CREATE INDEX IF NOT EXISTS idx_google_ads_api_usage_user_date ON google_ads_api_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_google_ads_api_usage_created_at ON google_ads_api_usage(created_at);

-- ad_strength_history
CREATE TABLE IF NOT EXISTS ad_strength_history (
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
  avg_headline_length REAL,
  avg_description_length REAL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  evaluated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  performance_updated_at TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_user ON ad_strength_history(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_offer ON ad_strength_history(offer_id);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_rating ON ad_strength_history(rating);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_campaign ON ad_strength_history(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_evaluated_at ON ad_strength_history(evaluated_at);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_rating_score ON ad_strength_history(rating, overall_score);
CREATE INDEX IF NOT EXISTS idx_ad_strength_history_user_rating ON ad_strength_history(user_id, rating);

-- industry_benchmarks
CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id SERIAL PRIMARY KEY,
  industry_l1 TEXT NOT NULL,
  industry_l2 TEXT NOT NULL,
  industry_code TEXT NOT NULL UNIQUE,
  avg_ctr REAL NOT NULL,
  avg_cpc REAL NOT NULL,
  avg_conversion_rate REAL NOT NULL,
  data_source TEXT DEFAULT 'Google Ads Industry Benchmarks 2024',
  last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_code ON industry_benchmarks(industry_code);
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_l1 ON industry_benchmarks(industry_l1);

-- ad_creative_performance
CREATE TABLE IF NOT EXISTS ad_creative_performance (
  id SERIAL PRIMARY KEY,
  ad_creative_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  ctr REAL DEFAULT 0,
  cost REAL DEFAULT 0,
  cpc REAL DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  conversion_rate REAL DEFAULT 0,
  conversion_value REAL DEFAULT 0,
  industry_code TEXT,
  bonus_score INTEGER DEFAULT 0,
  bonus_breakdown TEXT,
  min_clicks_reached BOOLEAN DEFAULT FALSE,
  sync_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  UNIQUE(ad_creative_id, sync_date)
);
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_creative ON ad_creative_performance(ad_creative_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_offer ON ad_creative_performance(offer_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_user ON ad_creative_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_date ON ad_creative_performance(sync_date);

-- conversion_feedback
CREATE TABLE IF NOT EXISTS conversion_feedback (
  id SERIAL PRIMARY KEY,
  ad_creative_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  conversions INTEGER NOT NULL,
  conversion_value REAL DEFAULT 0,
  feedback_note TEXT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_conversion_feedback_creative ON conversion_feedback(ad_creative_id);
CREATE INDEX IF NOT EXISTS idx_conversion_feedback_user ON conversion_feedback(user_id);

-- score_analysis_history
CREATE TABLE IF NOT EXISTS score_analysis_history (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  industry_code TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  correlation_clicks REAL,
  correlation_ctr REAL,
  correlation_cpc REAL,
  correlation_conversions REAL,
  overall_correlation REAL,
  insights TEXT,
  recommendations TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_score_analysis_user ON score_analysis_history(user_id);
CREATE INDEX IF NOT EXISTS idx_score_analysis_industry ON score_analysis_history(industry_code);

-- ai_token_usage
CREATE TABLE IF NOT EXISTS ai_token_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  operation_type TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  api_type TEXT NOT NULL DEFAULT 'gemini',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  date DATE NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_user_date ON ai_token_usage(user_id, date);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_date ON ai_token_usage(date);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_model ON ai_token_usage(model);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_created_at ON ai_token_usage(created_at);

-- prompt_versions
CREATE TABLE IF NOT EXISTS prompt_versions (
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT FALSE,
  change_notes TEXT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(prompt_id, version)
);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_prompt_id ON prompt_versions(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_active ON prompt_versions(is_active);
CREATE INDEX IF NOT EXISTS idx_prompt_versions_created_at ON prompt_versions(created_at);

-- prompt_usage_stats
CREATE TABLE IF NOT EXISTS prompt_usage_stats (
  id SERIAL PRIMARY KEY,
  prompt_id TEXT NOT NULL,
  version TEXT NOT NULL,
  usage_date DATE NOT NULL,
  call_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost REAL DEFAULT 0,
  avg_quality_score REAL,
  UNIQUE(prompt_id, version, usage_date)
);
CREATE INDEX IF NOT EXISTS idx_prompt_usage_stats_date ON prompt_usage_stats(usage_date);
CREATE INDEX IF NOT EXISTS idx_prompt_usage_stats_prompt ON prompt_usage_stats(prompt_id, version);

-- migration_history
CREATE TABLE IF NOT EXISTS migration_history (
  id SERIAL PRIMARY KEY,
  migration_name TEXT NOT NULL UNIQUE,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================
-- Default System Settings
-- ==========================================

INSERT INTO system_settings (user_id, category, config_key, data_type, is_sensitive, is_required, default_value, description)
VALUES
  (NULL, 'google_ads', 'client_id', 'string', TRUE, TRUE, NULL, 'Google Ads API Client ID'),
  (NULL, 'google_ads', 'client_secret', 'string', TRUE, TRUE, NULL, 'Google Ads API Client Secret'),
  (NULL, 'google_ads', 'developer_token', 'string', TRUE, TRUE, NULL, 'Google Ads Developer Token'),
  (NULL, 'ai', 'gemini_api_key', 'string', TRUE, FALSE, NULL, 'Gemini API密钥（直接API模式）'),
  (NULL, 'ai', 'gemini_model', 'string', FALSE, TRUE, 'gemini-2.5-pro', 'Gemini模型版本'),
  (NULL, 'ai', 'use_vertex_ai', 'boolean', FALSE, FALSE, 'false', '是否使用Vertex AI（优先于直接API）'),
  (NULL, 'ai', 'gcp_project_id', 'string', TRUE, FALSE, NULL, 'GCP项目ID（Vertex AI）'),
  (NULL, 'ai', 'gcp_location', 'string', FALSE, FALSE, 'us-central1', 'GCP区域（Vertex AI）'),
  (NULL, 'ai', 'gcp_service_account_json', 'text', TRUE, FALSE, NULL, 'GCP Service Account JSON（Vertex AI）'),
  (NULL, 'proxy', 'urls', 'json', FALSE, FALSE, NULL, '代理URL配置列表（JSON格式），支持多个国家的代理URL'),
  (NULL, 'system', 'currency', 'string', FALSE, TRUE, 'CNY', '默认货币'),
  (NULL, 'system', 'language', 'string', FALSE, TRUE, 'zh-CN', '系统语言'),
  (NULL, 'system', 'sync_interval_hours', 'number', FALSE, TRUE, '6', '数据同步间隔(小时)'),
  (NULL, 'system', 'link_check_enabled', 'boolean', FALSE, TRUE, 'true', '是否启用链接检查'),
  (NULL, 'system', 'link_check_time', 'string', FALSE, TRUE, '02:00', '链接检查时间')
ON CONFLICT DO NOTHING;

-- ==========================================
-- Initialization Complete
-- ==========================================