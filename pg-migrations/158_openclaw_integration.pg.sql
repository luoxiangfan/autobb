-- Migration: 158_openclaw_integration.pg.sql
-- Description: OpenClaw integration tables + default settings
-- Date: 2026-02-05
-- Database: PostgreSQL

-- ---------------------------------------------------------------------
-- 1) OpenClaw tokens (per-user, revocable)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  token_encrypted TEXT NOT NULL,
  scopes JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_tokens_user ON openclaw_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_tokens_status ON openclaw_tokens(status);
CREATE INDEX IF NOT EXISTS idx_openclaw_tokens_created ON openclaw_tokens(created_at);

-- ---------------------------------------------------------------------
-- 2) OpenClaw user bindings (channel sender mapping)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_user_bindings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  tenant_key TEXT,
  open_id TEXT NOT NULL,
  union_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(channel, open_id)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_bindings_user ON openclaw_user_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_bindings_channel ON openclaw_user_bindings(channel, status);

-- ---------------------------------------------------------------------
-- 3) OpenClaw action logs (audit per user)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_action_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel TEXT,
  sender_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  request_body TEXT,
  response_body TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_actions_user ON openclaw_action_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_openclaw_actions_status ON openclaw_action_logs(status);

-- ---------------------------------------------------------------------
-- 4) OpenClaw daily reports cache
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_daily_reports (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  payload_json TEXT,
  sent_status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_reports_user ON openclaw_daily_reports(user_id, report_date);

-- ---------------------------------------------------------------------
-- 5) OpenClaw ASIN inputs (user uploads / Feishu attachments)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_asin_inputs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  filename TEXT,
  file_type TEXT,
  file_size INTEGER,
  checksum TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_items INTEGER DEFAULT 0,
  parsed_items INTEGER DEFAULT 0,
  error_message TEXT,
  metadata_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_asin_inputs_user ON openclaw_asin_inputs(user_id, created_at);

-- ---------------------------------------------------------------------
-- 6) OpenClaw ASIN items (normalized candidate list)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_asin_items (
  id SERIAL PRIMARY KEY,
  input_id INTEGER REFERENCES openclaw_asin_inputs(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asin TEXT,
  country_code TEXT,
  price TEXT,
  brand TEXT,
  title TEXT,
  affiliate_link TEXT,
  product_url TEXT,
  priority INTEGER DEFAULT 0,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  offer_id INTEGER,
  error_message TEXT,
  data_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_asin_items_user ON openclaw_asin_items(user_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_openclaw_asin_items_input ON openclaw_asin_items(input_id);

-- ---------------------------------------------------------------------
-- 7) OpenClaw strategy runs (self-evolving pipeline)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_strategy_runs (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'auto',
  status TEXT NOT NULL DEFAULT 'pending',
  run_date DATE,
  config_json JSONB,
  stats_json JSONB,
  error_message TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_runs_user ON openclaw_strategy_runs(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_runs_status ON openclaw_strategy_runs(status);

-- ---------------------------------------------------------------------
-- 8) OpenClaw strategy actions (audit + decisions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_strategy_actions (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES openclaw_strategy_runs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  request_json JSONB,
  response_json JSONB,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_actions_run ON openclaw_strategy_actions(run_id);
CREATE INDEX IF NOT EXISTS idx_openclaw_strategy_actions_user ON openclaw_strategy_actions(user_id, created_at);

-- ---------------------------------------------------------------------
-- 9) OpenClaw knowledge base (daily insights)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_knowledge_base (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  report_date DATE NOT NULL,
  summary_json JSONB,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, report_date)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_knowledge_base_user ON openclaw_knowledge_base(user_id, report_date);

-- ---------------------------------------------------------------------
-- 10) OpenClaw Feishu docs tracking
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS openclaw_feishu_docs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bitable_app_token TEXT,
  bitable_table_id TEXT,
  folder_token TEXT,
  last_doc_token TEXT,
  last_doc_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_openclaw_feishu_docs_user ON openclaw_feishu_docs(user_id);

-- ---------------------------------------------------------------------
-- 11) Default OpenClaw settings templates (global)
-- ---------------------------------------------------------------------
INSERT INTO system_settings (user_id, category, key, data_type, is_sensitive, is_required, default_value, description)
VALUES
  (NULL, 'openclaw', 'gateway_token', 'string', true, false, NULL, 'OpenClaw Gateway Auth Token（自动生成/可覆盖）'),
  (NULL, 'openclaw', 'gateway_port', 'number', false, false, '18789', 'OpenClaw Gateway 端口'),
  (NULL, 'openclaw', 'gateway_bind', 'string', false, false, 'loopback', 'OpenClaw Gateway 绑定地址（loopback/tailnet/auto）'),

  (NULL, 'openclaw', 'yeahpromos_token', 'string', true, false, NULL, 'YeahPromos API Token'),
  (NULL, 'openclaw', 'yeahpromos_site_id', 'string', false, false, NULL, 'YeahPromos Site ID'),
  (NULL, 'openclaw', 'yeahpromos_start_date', 'string', false, false, NULL, 'YeahPromos Start Date (YYYY-MM-DD)'),
  (NULL, 'openclaw', 'yeahpromos_end_date', 'string', false, false, NULL, 'YeahPromos End Date (YYYY-MM-DD)'),
  (NULL, 'openclaw', 'yeahpromos_is_amazon', 'boolean', false, false, '0', 'YeahPromos is_amazon (1/0)'),
  (NULL, 'openclaw', 'yeahpromos_page', 'number', false, false, '1', 'YeahPromos page'),
  (NULL, 'openclaw', 'yeahpromos_limit', 'number', false, false, '1000', 'YeahPromos limit'),

  (NULL, 'openclaw', 'ai_models_json', 'text', true, false, NULL, 'OpenClaw models.providers JSON配置（包含API Key）'),

  (NULL, 'openclaw', 'feishu_app_id', 'string', false, false, NULL, 'Feishu App ID (cli_xxx)'),
  (NULL, 'openclaw', 'feishu_app_secret', 'string', true, false, NULL, 'Feishu App Secret'),
  (NULL, 'openclaw', 'feishu_domain', 'string', false, false, 'feishu', 'Feishu API Domain (feishu/lark/https://...)'),
  (NULL, 'openclaw', 'feishu_bot_name', 'string', false, false, NULL, 'Feishu Bot Name'),
  (NULL, 'openclaw', 'feishu_dm_policy', 'string', false, false, 'pairing', 'Feishu DM Policy (pairing/allowlist/open/disabled)'),
  (NULL, 'openclaw', 'feishu_group_policy', 'string', false, false, 'allowlist', 'Feishu Group Policy (open/disabled/allowlist)'),
  (NULL, 'openclaw', 'feishu_allow_from', 'json', false, false, NULL, 'Feishu DM Allowlist (JSON array of open_id/union_id)'),
  (NULL, 'openclaw', 'feishu_group_allow_from', 'json', false, false, NULL, 'Feishu Group Allowlist (JSON array of open_id/union_id)'),
  (NULL, 'openclaw', 'feishu_require_mention', 'boolean', false, false, 'true', 'Feishu group require mention'),
  (NULL, 'openclaw', 'feishu_history_limit', 'number', false, false, '20', 'Feishu group history limit'),
  (NULL, 'openclaw', 'feishu_dm_history_limit', 'number', false, false, '20', 'Feishu DM history limit'),
  (NULL, 'openclaw', 'feishu_streaming', 'boolean', false, false, 'true', 'Feishu streaming card mode'),
  (NULL, 'openclaw', 'feishu_block_streaming', 'boolean', false, false, 'false', 'Disable block streaming'),
  (NULL, 'openclaw', 'feishu_text_chunk_limit', 'number', false, false, '2000', 'Feishu outbound text chunk size'),
  (NULL, 'openclaw', 'feishu_chunk_mode', 'string', false, false, 'length', 'Feishu chunk mode (length/newline)'),
  (NULL, 'openclaw', 'feishu_config_writes', 'boolean', false, false, 'true', 'Allow channel-initiated config writes'),
  (NULL, 'openclaw', 'feishu_target', 'string', false, false, NULL, 'Feishu report push target (open_id/union_id/chat_id)'),
  (NULL, 'openclaw', 'feishu_doc_folder_token', 'string', false, false, NULL, 'Feishu Doc folder token (per user)'),
  (NULL, 'openclaw', 'feishu_doc_title_prefix', 'string', false, false, 'OpenClaw 每日报表', 'Feishu Doc title prefix'),
  (NULL, 'openclaw', 'feishu_bitable_app_token', 'string', false, false, NULL, 'Feishu Bitable app_token'),
  (NULL, 'openclaw', 'feishu_bitable_table_id', 'string', false, false, NULL, 'Feishu Bitable table_id (auto-created if empty)'),
  (NULL, 'openclaw', 'feishu_bitable_table_name', 'string', false, false, 'OpenClaw Daily Report', 'Feishu Bitable table name'),

  (NULL, 'openclaw', 'partnerboost_base_url', 'string', false, false, 'https://app.partnerboost.com', 'PartnerBoost API Base URL'),
  (NULL, 'openclaw', 'partnerboost_token', 'string', true, false, NULL, 'PartnerBoost API Token'),
  (NULL, 'openclaw', 'partnerboost_products_page_size', 'number', false, false, '20', 'PartnerBoost Products page_size'),
  (NULL, 'openclaw', 'partnerboost_products_page', 'number', false, false, '1', 'PartnerBoost Products page'),
  (NULL, 'openclaw', 'partnerboost_products_default_filter', 'number', false, false, '0', 'PartnerBoost Products default_filter'),
  (NULL, 'openclaw', 'partnerboost_products_country_code', 'string', false, false, NULL, 'PartnerBoost Products country_code'),
  (NULL, 'openclaw', 'partnerboost_products_brand_id', 'string', false, false, NULL, 'PartnerBoost Products brand_id'),
  (NULL, 'openclaw', 'partnerboost_products_sort', 'string', false, false, NULL, 'PartnerBoost Products sort'),
  (NULL, 'openclaw', 'partnerboost_products_asins', 'string', false, false, NULL, 'PartnerBoost Products asins'),
  (NULL, 'openclaw', 'partnerboost_products_relationship', 'number', false, false, '1', 'PartnerBoost Products relationship'),
  (NULL, 'openclaw', 'partnerboost_products_is_original_currency', 'number', false, false, '0', 'PartnerBoost Products is_original_currency'),
  (NULL, 'openclaw', 'partnerboost_products_has_promo_code', 'number', false, false, '0', 'PartnerBoost Products has_promo_code'),
  (NULL, 'openclaw', 'partnerboost_products_has_acc', 'number', false, false, '0', 'PartnerBoost Products has_acc'),
  (NULL, 'openclaw', 'partnerboost_products_filter_sexual_wellness', 'number', false, false, '0', 'PartnerBoost Products filter_sexual_wellness'),
  (NULL, 'openclaw', 'partnerboost_link_product_ids', 'string', false, false, NULL, 'PartnerBoost Products Link product_ids'),
  (NULL, 'openclaw', 'partnerboost_link_asins', 'string', false, false, NULL, 'PartnerBoost Link by ASIN asins'),
  (NULL, 'openclaw', 'partnerboost_link_country_code', 'string', false, false, NULL, 'PartnerBoost Link country_code'),
  (NULL, 'openclaw', 'partnerboost_link_uid', 'string', false, false, NULL, 'PartnerBoost Link uid'),
  (NULL, 'openclaw', 'partnerboost_link_return_partnerboost_link', 'number', false, false, '0', 'PartnerBoost Link return_partnerboost_link'),
  (NULL, 'openclaw', 'partnerboost_brands_bids', 'string', false, false, NULL, 'PartnerBoost Joined Brands bids'),
  (NULL, 'openclaw', 'partnerboost_brands_page_size', 'number', false, false, '20', 'PartnerBoost Joined Brands page_size'),
  (NULL, 'openclaw', 'partnerboost_brands_page', 'number', false, false, '1', 'PartnerBoost Joined Brands page'),
  (NULL, 'openclaw', 'partnerboost_storefront_bids', 'string', false, false, NULL, 'PartnerBoost Storefront bids'),
  (NULL, 'openclaw', 'partnerboost_storefront_uid', 'string', false, false, NULL, 'PartnerBoost Storefront uid'),
  (NULL, 'openclaw', 'partnerboost_link_status_link_ids', 'string', false, false, NULL, 'PartnerBoost Link Status link_ids'),
  (NULL, 'openclaw', 'partnerboost_report_page_size', 'number', false, false, '100', 'PartnerBoost Report page_size'),
  (NULL, 'openclaw', 'partnerboost_report_page', 'number', false, false, '1', 'PartnerBoost Report page'),
  (NULL, 'openclaw', 'partnerboost_report_start_date', 'string', false, false, NULL, 'PartnerBoost Report start_date (YYYYMMDD)'),
  (NULL, 'openclaw', 'partnerboost_report_end_date', 'string', false, false, NULL, 'PartnerBoost Report end_date (YYYYMMDD)'),
  (NULL, 'openclaw', 'partnerboost_report_marketplace', 'string', false, false, NULL, 'PartnerBoost Report marketplace'),
  (NULL, 'openclaw', 'partnerboost_report_asins', 'string', false, false, NULL, 'PartnerBoost Report asins'),
  (NULL, 'openclaw', 'partnerboost_report_ad_group_ids', 'string', false, false, NULL, 'PartnerBoost Report adGroupIds'),
  (NULL, 'openclaw', 'partnerboost_report_order_ids', 'string', false, false, NULL, 'PartnerBoost Report order_ids'),
  (NULL, 'openclaw', 'partnerboost_associates_page_size', 'number', false, false, '200', 'PartnerBoost Associates page_size'),
  (NULL, 'openclaw', 'partnerboost_associates_page', 'number', false, false, '1', 'PartnerBoost Associates page'),
  (NULL, 'openclaw', 'partnerboost_associates_filter_sexual_wellness', 'number', false, false, '0', 'PartnerBoost Associates filter_sexual_wellness'),
  (NULL, 'openclaw', 'partnerboost_associates_region', 'string', false, false, 'us', 'PartnerBoost Associates region'),

  (NULL, 'openclaw', 'feishu_app_secret_file', 'string', false, false, NULL, 'Feishu App Secret file path'),
  (NULL, 'openclaw', 'feishu_markdown_tables', 'string', false, false, NULL, 'Feishu markdown tables mode (off/bullets/code)'),
  (NULL, 'openclaw', 'feishu_media_max_mb', 'number', false, false, NULL, 'Feishu media max MB'),
  (NULL, 'openclaw', 'feishu_response_prefix', 'string', false, false, NULL, 'Feishu response prefix'),
  (NULL, 'openclaw', 'feishu_groups_json', 'json', false, false, NULL, 'Feishu group overrides JSON (groups.<chat_id>)'),
  (NULL, 'openclaw', 'feishu_accounts_json', 'json', true, false, NULL, 'Feishu accounts JSON (may include secrets)'),

  (NULL, 'openclaw', 'openclaw_agent_defaults_json', 'json', true, false, NULL, 'OpenClaw agents.defaults JSON'),
  (NULL, 'openclaw', 'openclaw_agent_list_json', 'json', true, false, NULL, 'OpenClaw agents.list JSON'),
  (NULL, 'openclaw', 'openclaw_session_json', 'json', false, false, NULL, 'OpenClaw session JSON'),
  (NULL, 'openclaw', 'openclaw_messages_json', 'json', false, false, NULL, 'OpenClaw messages JSON'),
  (NULL, 'openclaw', 'openclaw_commands_json', 'json', false, false, NULL, 'OpenClaw commands JSON'),
  (NULL, 'openclaw', 'openclaw_approvals_exec_json', 'json', false, false, NULL, 'OpenClaw approvals.exec JSON'),
  (NULL, 'openclaw', 'openclaw_models_mode', 'string', false, false, NULL, 'OpenClaw models mode (merge/replace)'),
  (NULL, 'openclaw', 'openclaw_models_bedrock_discovery_json', 'json', false, false, NULL, 'OpenClaw models.bedrockDiscovery JSON'),
  (NULL, 'openclaw', 'openclaw_logging_redact_patterns_json', 'json', false, false, NULL, 'OpenClaw logging.redactPatterns JSON array'),
  (NULL, 'openclaw', 'openclaw_diagnostics_otel_json', 'json', false, false, NULL, 'OpenClaw diagnostics.otel JSON'),

  (NULL, 'openclaw', 'openclaw_strategy_enabled', 'boolean', false, false, 'false', 'Enable OpenClaw self-evolving strategy'),
  (NULL, 'openclaw', 'openclaw_strategy_cron', 'string', false, false, '0 9 * * *', 'OpenClaw strategy cron (Asia/Shanghai)'),
  (NULL, 'openclaw', 'openclaw_strategy_max_offers_per_run', 'number', false, false, '3', 'Max offers per strategy run'),
  (NULL, 'openclaw', 'openclaw_strategy_default_budget', 'number', false, false, '20', 'Default daily budget per campaign'),
  (NULL, 'openclaw', 'openclaw_strategy_max_cpc', 'number', false, false, '1.2', 'Default max CPC bid'),
  (NULL, 'openclaw', 'openclaw_strategy_min_cpc', 'number', false, false, '0.1', 'Minimum CPC bid'),
  (NULL, 'openclaw', 'openclaw_strategy_daily_budget_cap', 'number', false, false, '1000', 'Daily budget cap (currency per account)'),
  (NULL, 'openclaw', 'openclaw_strategy_daily_spend_cap', 'number', false, false, '100', 'Daily spend cap (currency per account)'),
  (NULL, 'openclaw', 'openclaw_strategy_target_roas', 'number', false, false, '1', 'Target ROAS'),
  (NULL, 'openclaw', 'openclaw_strategy_ads_account_ids', 'json', false, false, NULL, 'Allowed Google Ads account IDs (JSON array)'),
  (NULL, 'openclaw', 'openclaw_strategy_enable_auto_publish', 'boolean', false, false, 'true', 'Auto publish campaigns'),
  (NULL, 'openclaw', 'openclaw_strategy_enable_auto_pause', 'boolean', false, false, 'true', 'Auto pause conflicting campaigns'),
  (NULL, 'openclaw', 'openclaw_strategy_enable_auto_adjust_cpc', 'boolean', false, false, 'true', 'Auto adjust CPC based on ROAS'),
  (NULL, 'openclaw', 'openclaw_strategy_allow_affiliate_fetch', 'boolean', false, false, 'true', 'Allow affiliate platform discovery'),
  (NULL, 'openclaw', 'openclaw_strategy_dry_run', 'boolean', false, false, 'false', 'Dry-run mode without publishing')
ON CONFLICT DO NOTHING;
