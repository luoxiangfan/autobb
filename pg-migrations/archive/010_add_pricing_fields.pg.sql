-- Migration: 010_add_pricing_fields.sql
-- Purpose: 添加产品价格和佣金比例字段（需求28）
-- Date: 2025-11-18

-- 添加产品价格字段（可选）
-- 示例：$699.00, ¥5999.00

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'product_price') THEN
    ALTER TABLE offers ADD COLUMN product_price TEXT;
    RAISE NOTICE '✅ 添加 product_price 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  product_price 字段已存在于 offers';
  END IF;
END $$;

-- 添加佣金比例字段（可选）
-- 示例：6.75%, 8.5%

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'commission_payout') THEN
    ALTER TABLE offers ADD COLUMN commission_payout TEXT;
    RAISE NOTICE '✅ 添加 commission_payout 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  commission_payout 字段已存在于 offers';
  END IF;
END $$;

-- 注释说明
-- product_price: 产品价格，用于计算建议最大CPC
-- commission_payout: 佣金比例，用于计算建议最大CPC
-- 建议最大CPC公式：max_cpc = product_price * commission_payout / 50
-- 示例：$699.00 * 6.75% / 50 = $0.94

-- 回填说明：这两个字段为可选字段，现有数据可以为NULL


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('010_add_pricing_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;
