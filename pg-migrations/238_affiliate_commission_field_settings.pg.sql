-- Migration: 238_affiliate_commission_field_settings.pg.sql
-- Date: 2026-05-09
-- Description: PartnerBoost / YeahPromos 佣金字段配置模板

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
  'affiliate_sync',
  'partnerboost_commission_mode',
  NULL,
  NULL,
  'auto',
  'PartnerBoost 佣金口径：auto（兼容历史）、estimated（优先预估）、settled（优先实结/已付类字段）',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'partnerboost_commission_mode' AND user_id IS NULL
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
  'affiliate_sync',
  'yeahpromos_commission_field',
  NULL,
  NULL,
  'sale_comm',
  'YeahPromos 订单 JSON 中作为佣金金额的字段名（默认 sale_comm）',
  false,
  false,
  'string'
WHERE NOT EXISTS (
  SELECT 1 FROM system_settings
  WHERE category = 'affiliate_sync' AND key = 'yeahpromos_commission_field' AND user_id IS NULL
);
