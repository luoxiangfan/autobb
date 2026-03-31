-- Migration: 添加visual_analysis字段到offers表
-- Date: 2025-11-20
-- Description: P1高级优化 - 存储视觉元素智能分析结果

-- 添加visual_analysis字段（TEXT类型存储JSON）

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'visual_analysis') THEN
    ALTER TABLE offers ADD COLUMN visual_analysis TEXT;
    RAISE NOTICE '✅ 添加 visual_analysis 字段到 offers';
  ELSE
    RAISE NOTICE '⏭️  visual_analysis 字段已存在于 offers';
  END IF;
END $$;

-- 说明：visual_analysis字段存储ImageIntelligence的JSON格式数据
-- 包含：图片列表、质量评估、呈现方式、使用场景、视觉亮点
--
-- 字段结构示例：
-- {
--   "images": [
--     {
--       "url": "https://m.media-amazon.com/images/I/71ABC123._AC_SL1500_.jpg",
--       "type": "product",
--       "alt": "Product main image",
--       "isHighQuality": true
--     }
--   ],
--   "imageQuality": {
--     "totalImages": 8,
--     "highQualityImages": 6,
--     "highQualityRatio": 0.75,
--     "hasLifestyleImages": true,
--     "hasInfographics": true,
--     "hasSizeComparison": false,
--     "hasDetailShots": true
--   },
--   "presentationStyle": {
--     "hasWhiteBackground": true,
--     "hasAngleViews": true,
--     "hasDetailShots": true,
--     "hasPackageContents": true,
--     "hasUsageDemo": true,
--     "hasScaleReference": false
--   },
--   "identifiedScenarios": [
--     {
--       "scenario": "outdoor backyard security",
--       "confidence": 0.92,
--       "imageUrl": "https://...",
--       "description": "摄像头安装在室外墙壁上监控后院，突出显示运动检测区域",
--       "adCopyIdea": "全天候守护您的后院安全"
--     }
--   ],
--   "visualHighlights": [
--     {
--       "highlight": "sleek modern design",
--       "evidence": "https://...",
--       "adCopyIdea": "时尚设计 融入您的家居风格",
--       "priority": "high"
--     }
--   ],
--   "analyzedAt": "2025-11-20T12:00:00Z",
--   "analysisMethod": "hybrid"
-- }


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('015_add_visual_analysis_field.pg')
ON CONFLICT (migration_name) DO NOTHING;
