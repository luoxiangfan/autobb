-- Migration: 238_affiliate_commission_field_settings.sql
-- Date: 2026-05-09
-- Description: PartnerBoost / YeahPromos 佣金字段口径配置模板

INSERT OR IGNORE INTO system_settings (
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
VALUES
  (
    'affiliate_sync',
    'partnerboost_commission_mode',
    NULL,
    NULL,
    'auto',
    'PartnerBoost 佣金口径：auto（兼容历史）、estimated（优先预估）、settled（优先实结/已付类字段）',
    0,
    0,
    'string'
  ),
  (
    'affiliate_sync',
    'yeahpromos_commission_field',
    NULL,
    NULL,
    'sale_comm',
    'YeahPromos 订单 JSON 中作为佣金金额的字段名（默认 sale_comm；可改为 commission 等）',
    0,
    0,
    'string'
  );
