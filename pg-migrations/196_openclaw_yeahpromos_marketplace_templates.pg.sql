-- Migration: 196_openclaw_yeahpromos_marketplace_templates.pg.sql
-- Date: 2026-02-27
-- Description: 新增 YP marketplace 模板配置（PostgreSQL）

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
  'yeahpromos_marketplace_templates_json',
  NULL,
  '[{"scope":"amazon.com","marketplace":"amazon.com","country":"US","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.com&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.co.uk","marketplace":"amazon.co.uk","country":"GB","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.co.uk&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.ca","marketplace":"amazon.ca","country":"CA","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.ca&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.de","marketplace":"amazon.de","country":"DE","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.de&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.fr","marketplace":"amazon.fr","country":"FR","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.fr&sort=5&min_price=0&max_price=501&page=2"}]',
  '[{"scope":"amazon.com","marketplace":"amazon.com","country":"US","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.com&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.co.uk","marketplace":"amazon.co.uk","country":"GB","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.co.uk&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.ca","marketplace":"amazon.ca","country":"CA","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.ca&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.de","marketplace":"amazon.de","country":"DE","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.de&sort=5&min_price=0&max_price=501&page=2"},{"scope":"amazon.fr","marketplace":"amazon.fr","country":"FR","url":"https://yeahpromos.com/index/offer/products?is_delete=0&site_id=11767&join_status=2&market_place=amazon.fr&sort=5&min_price=0&max_price=501&page=2"}]',
  'YP 商品列表模板（按 marketplace 串行抓取，仅 page 参数可变）',
  false,
  false,
  'text'
WHERE NOT EXISTS (
  SELECT 1
  FROM system_settings
  WHERE category = 'openclaw'
    AND key = 'yeahpromos_marketplace_templates_json'
    AND user_id IS NULL
);
