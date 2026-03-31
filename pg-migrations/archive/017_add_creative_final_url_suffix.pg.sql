-- Migration: 017_add_creative_final_url_suffix
-- Description: 添加final_url_suffix字段到creatives表
-- Date: 2024-11-22

-- 添加final_url_suffix字段

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'creatives' AND column_name = 'final_url_suffix') THEN
    ALTER TABLE creatives ADD COLUMN final_url_suffix TEXT;
    RAISE NOTICE '✅ 添加 final_url_suffix 字段到 creatives';
  ELSE
    RAISE NOTICE '⏭️  final_url_suffix 字段已存在于 creatives';
  END IF;
END $$;


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('017_add_creative_final_url_suffix.pg')
ON CONFLICT (migration_name) DO NOTHING;
