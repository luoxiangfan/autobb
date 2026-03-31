-- Migration: 183_affiliate_products_id_bigint.pg.sql
-- Date: 2026-02-20
-- Description: 将 affiliate_products.id 与 affiliate_product_offer_links.product_id 升级为 BIGINT

ALTER TABLE IF EXISTS affiliate_product_offer_links
  DROP CONSTRAINT IF EXISTS affiliate_product_offer_links_product_id_fkey;

ALTER TABLE IF EXISTS affiliate_products
  ALTER COLUMN id TYPE BIGINT;

ALTER TABLE IF EXISTS affiliate_products
  ALTER COLUMN id SET DEFAULT nextval('affiliate_products_id_seq'::regclass);

ALTER SEQUENCE IF EXISTS affiliate_products_id_seq AS BIGINT;

ALTER TABLE IF EXISTS affiliate_product_offer_links
  ALTER COLUMN product_id TYPE BIGINT;

ALTER TABLE IF EXISTS affiliate_product_offer_links
  ADD CONSTRAINT affiliate_product_offer_links_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES affiliate_products(id)
  ON DELETE CASCADE;
