-- Migration 247: persist ad creative generation mode (fast / balanced / original)
-- ad_creatives: 落库每条创意的生成模式
ALTER TABLE ad_creatives ADD COLUMN generation_mode TEXT DEFAULT 'original';

-- creative_tasks: 异步入队任务记录所用模式，便于排查与对账
ALTER TABLE creative_tasks ADD COLUMN generation_mode TEXT DEFAULT 'original';
