-- Migration: 010_add_pricing_fields.sql
-- Purpose: 添加产品价格和佣金比例字段（需求28）
-- Date: 2025-11-18

-- 添加产品价格字段（可选）
-- 示例：$699.00, ¥5999.00
ALTER TABLE offers ADD COLUMN product_price TEXT;

-- 添加佣金比例字段（可选）
-- 示例：6.75%, 8.5%
ALTER TABLE offers ADD COLUMN commission_payout TEXT;

-- 注释说明
-- product_price: 产品价格，用于计算建议最大CPC
-- commission_payout: 佣金比例，用于计算建议最大CPC
-- 建议最大CPC公式：max_cpc = product_price * commission_payout / 50
-- 示例：$699.00 * 6.75% / 50 = $0.94

-- 回填说明：这两个字段为可选字段，现有数据可以为NULL
