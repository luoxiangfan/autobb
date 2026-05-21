-- Migration 247: persist ad creative generation mode (fast / balanced / original) (PostgreSQL)
ALTER TABLE ad_creatives ADD COLUMN IF NOT EXISTS generation_mode TEXT DEFAULT 'original';

COMMENT ON COLUMN ad_creatives.generation_mode IS '广告创意生成模式：fast | balanced | original';

ALTER TABLE creative_tasks ADD COLUMN IF NOT EXISTS generation_mode TEXT DEFAULT 'original';

COMMENT ON COLUMN creative_tasks.generation_mode IS '广告创意异步入队时的生成模式：fast | balanced | original';
