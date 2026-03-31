-- Migration: 016_add_offer_final_url_fields
-- Description: 添加final_url和final_url_suffix字段到offers表
-- 用于存储解析后的最终落地页URL（去除参数）和URL后缀（查询参数）
-- Date: 2024-11-22

-- 添加final_url字段：存储解析后的最终URL（不含查询参数）
-- 例如：https://amazon.com/stores/page/ABC

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'final_url') THEN
    ALTER TABLE offers ADD COLUMN final_url TEXT;
    RAISE NOTICE '✅ 添加 final_url 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  final_url 字段已存在于 offers';
  END IF;
END $$;

-- 添加final_url_suffix字段：存储查询参数（不含?）
-- 例如：maas=XXX&aa_campaignid=YYY&utm_source=google

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'final_url_suffix') THEN
    ALTER TABLE offers ADD COLUMN final_url_suffix TEXT;
    RAISE NOTICE '✅ 添加 final_url_suffix 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  final_url_suffix 字段已存在于 offers';
  END IF;
END $$;

-- 添加索引以支持按final_url查询
CREATE INDEX IF NOT EXISTS idx_offers_final_url ON offers(final_url);


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('016_add_offer_final_url_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;
