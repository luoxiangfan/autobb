-- Migration: 212_affiliate_products_user_id_id_desc.pg.sql
-- Date: 2026-03-17
-- Description: 为 affiliate_products 默认列表排序补充用户维度倒序索引（PostgreSQL）

CREATE INDEX IF NOT EXISTS idx_affiliate_products_user_id_id_desc
  ON affiliate_products(user_id, id DESC);
