-- 068: 添加 ad_strength_data 字段存储完整的 Ad Strength 评估数据
-- 解决问题：刷新页面后 7 维度评分变为 5 维度

-- 添加新字段存储完整的 adStrength JSON 对象
ALTER TABLE ad_creatives ADD COLUMN ad_strength_data TEXT DEFAULT NULL;

-- 说明：
-- ad_strength_data 存储完整的 Ad Strength 评估结果 JSON，包含：
-- {
--   "rating": "EXCELLENT" | "GOOD" | "AVERAGE" | "POOR",
--   "score": 85,
--   "isExcellent": true,
--   "dimensions": {
--     "diversity": { "score": 18, "weight": 0.18, "details": {...} },
--     "relevance": { "score": 18, "weight": 0.18, "details": {...} },
--     "completeness": { "score": 14, "weight": 0.14, "details": {...} },
--     "quality": { "score": 14, "weight": 0.14, "details": {...} },
--     "compliance": { "score": 8, "weight": 0.08, "details": {...} },
--     "brandSearchVolume": { "score": 18, "weight": 0.18, "details": {...} },
--     "competitivePositioning": { "score": 10, "weight": 0.10, "details": {...} }
--   },
--   "suggestions": [...]
-- }
