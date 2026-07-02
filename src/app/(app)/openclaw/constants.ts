export const HIGH_RISK_COMMAND_LOOKBACK_DAYS = 7
export const HIGH_RISK_COMMAND_PAGE_LIMIT = 10
export const REPORT_TREND_RANGE_OPTIONS = [
  { days: 7, label: '过去7天（含今天）' },
  { days: 14, label: '过去14天（含今天）' },
  { days: 30, label: '过去30天（含今天）' },
] as const
export const DEFAULT_REPORT_TREND_RANGE_DAYS = 30

export const AI_MINIMAL_PLACEHOLDER = `{
  "providers": {
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "YOUR_API_KEY",
      "api": "openai-responses",
      "models": [
        { "id": "gpt-5-mini", "name": "GPT-5 Mini" }
      ]
    }
  }
}`

export const STRATEGY_CRON_OPTIONS: Array<{ id: string; label: string; cron: string }> = [
  { id: 'daily_morning', label: '每天 09:00（推荐）', cron: '0 9 * * *' },
  { id: 'weekday_morning', label: '工作日 09:00', cron: '0 9 * * 1-5' },
  { id: 'every_6_hours', label: '每 6 小时', cron: '0 */6 * * *' },
  { id: 'hourly', label: '每小时', cron: '0 * * * *' },
  { id: 'custom', label: '自定义（保留历史值）', cron: '' },
]

export const AI_GLOBAL_KEYS = [
  'ai_models_json',
  'openclaw_models_mode',
  'openclaw_models_bedrock_discovery_json',
] as const

export const AI_GLOBAL_KEY_SET = new Set<string>([...AI_GLOBAL_KEYS])

export const AI_GLOBAL_EDIT_KEYS = [
  'ai_models_json',
] as const

export const FEISHU_CHAT_MINIMAL_USER_KEYS = [
  'feishu_app_id',
  'feishu_app_secret',
  'feishu_target',
  'feishu_accounts_json',
] as const

export const FEISHU_CHAT_COMMUNICATION_USER_KEYS = [
  'feishu_domain',
  'feishu_bot_name',
  'feishu_auth_mode',
  'feishu_require_tenant_key',
  'feishu_strict_auto_bind',
] as const

export const FEISHU_BASIC_EXAMPLE_VALUES: Record<string, string> = {
  feishu_app_id: 'cli_xxx',
  feishu_app_secret: 'app_secret_xxx',
  feishu_target: 'ou_xxx',
  feishu_domain: 'feishu',
  feishu_auth_mode: 'strict',
  feishu_require_tenant_key: 'true',
  feishu_strict_auto_bind: 'true' }

export const PARTNERBOOST_USER_KEYS = [
  'partnerboost_base_url',
  'partnerboost_products_country_code',
  'partnerboost_products_link_batch_size',
  'partnerboost_asin_link_batch_size',
  'partnerboost_request_delay_ms',
  'partnerboost_rate_limit_max_retries',
  'partnerboost_rate_limit_base_delay_ms',
  'partnerboost_rate_limit_max_delay_ms',
  'partnerboost_link_country_code',
  'partnerboost_link_uid',
] as const

export const STRATEGY_MINIMAL_USER_KEYS = [
  'openclaw_strategy_enabled',
  'openclaw_strategy_cron',
] as const

export const FEISHU_CHAT_USER_KEYS = [...FEISHU_CHAT_MINIMAL_USER_KEYS, ...FEISHU_CHAT_COMMUNICATION_USER_KEYS] as const

export const USER_KEYS = new Set([
  ...AI_GLOBAL_KEYS,
  ...PARTNERBOOST_USER_KEYS,
  'partnerboost_products_page_size',
  'partnerboost_products_page',
  'partnerboost_products_default_filter',
  'partnerboost_products_brand_id',
  'partnerboost_products_sort',
  'partnerboost_products_asins',
  'partnerboost_products_relationship',
  'partnerboost_products_is_original_currency',
  'partnerboost_products_has_promo_code',
  'partnerboost_products_has_acc',
  'partnerboost_products_filter_sexual_wellness',
  'partnerboost_link_return_partnerboost_link',
  ...FEISHU_CHAT_USER_KEYS,
  ...STRATEGY_MINIMAL_USER_KEYS,
])

export const USER_DEFAULT_VALUES: Record<string, string> = {
  feishu_domain: 'feishu',
  feishu_auth_mode: 'strict',
  feishu_require_tenant_key: 'true',
  feishu_strict_auto_bind: 'true',
  partnerboost_base_url: 'https://app.partnerboost.com',
  openclaw_strategy_enabled: 'false',
  openclaw_strategy_cron: '0 9 * * *' }

export const OPENCLAW_TIMEZONE = 'Asia/Shanghai'
