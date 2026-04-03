-- Migration: 224_affiliate_products_list_filter_indexes.pg.sql
-- Date: 2026-04-02
-- Description: 为 /api/products 的国家与落地页类型筛选补充 Postgres 索引，避免列表查询触发 statement timeout

CREATE INDEX IF NOT EXISTS idx_affiliate_products_allowed_countries_jsonb
  ON affiliate_products
  USING GIN ((COALESCE(NULLIF(BTRIM(allowed_countries_json), ''), '[]')::jsonb));

-- NOTE:
-- 旧版本把超长 CASE 分类表达式直接写入表达式索引，
-- 在 PostgreSQL 上会触发系统目录元组限制：row is too big (max 8160)。
-- 这里改成稳定可执行的复合索引，优先保障启动迁移成功，
-- 并覆盖列表接口最核心的 user_id 作用域 + id 倒序分页路径。
CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_landing_type_id_desc
  ON affiliate_products (user_id, id DESC);
