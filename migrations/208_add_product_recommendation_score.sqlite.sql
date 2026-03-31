-- Migration: 208_add_product_recommendation_score.sqlite.sql
-- Date: 2026-03-15
-- Description: 添加商品推荐指数系统 - 完整实现（SQLite版本）
-- 包含：推荐指数字段、AI分析字段、索引、prompt注册

-- ============================================
-- Part 1: 添加推荐指数相关字段
-- ============================================

-- 添加推荐指数字段（1.0-5.0星级）
ALTER TABLE affiliate_products ADD COLUMN recommendation_score REAL;

-- 添加推荐理由字段（JSON数组，存储3条推荐理由）
ALTER TABLE affiliate_products ADD COLUMN recommendation_reasons TEXT;

-- 添加季节性评分字段（0-100分）
ALTER TABLE affiliate_products ADD COLUMN seasonality_score REAL;

-- 添加季节性AI分析结果字段（JSON格式）
ALTER TABLE affiliate_products ADD COLUMN seasonality_analysis TEXT;

-- 添加商品综合AI分析结果字段（JSON格式）
-- 包含：category, targetAudience, pricePositioning, useScenario, productFeatures
ALTER TABLE affiliate_products ADD COLUMN product_analysis TEXT;

-- 添加评分计算时间戳
ALTER TABLE affiliate_products ADD COLUMN score_calculated_at TEXT;

-- ============================================
-- Part 2: 创建索引优化查询性能
-- ============================================

-- 索引1: 按用户ID和推荐分数排序（用于商品列表排序）
CREATE INDEX IF NOT EXISTS idx_affiliate_products_recommendation_score
  ON affiliate_products(user_id, recommendation_score DESC);

-- 索引2: 按用户ID和计算时间查询（用于查询未计算评分的商品）
CREATE INDEX IF NOT EXISTS idx_affiliate_products_score_calculated
  ON affiliate_products(user_id, score_calculated_at);

-- ============================================
-- Part 3: 注册AI分析Prompt
-- ============================================

-- 注册季节性分析prompt
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  created_at
) VALUES (
  'product_seasonality_analysis',
  'v1.0',
  '商品分析',
  '商品季节性分析v1.0',
  '分析商品标题,识别季节性和节日相关性,用于推荐指数计算',
  'prompts/product_seasonality_analysis_v1.0.txt',
  'analyzeSeasonality',
  '分析以下商品标题,判断其季节性和节日相关性:

商品标题: {{product_name}}
当前月份: {{current_month}}月

请识别:
1. 季节性: 春季/夏季/秋季/冬季/全年通用
2. 节日相关: 圣诞节/情人节/万圣节/感恩节/黑色星期五/网络星期一/母亲节/父亲节/复活节/新年/其他
3. 是否处于促销旺季
4. 距离下一个旺季还有几个月

返回JSON格式:
{
  "seasonality": "winter" | "summer" | "spring" | "fall" | "all-year",
  "holidays": ["christmas", "new-year"],
  "isPeakSeason": true | false,
  "monthsUntilPeak": 0-12,
  "reasoning": "简短说明(中文)"
}

注意:
- seasonality必须是以下之一: winter, summer, spring, fall, all-year
- holidays是数组,可以包含多个节日,如果无节日相关则为空数组[]
- isPeakSeason表示当前是否处于该商品的促销旺季
- monthsUntilPeak表示距离下一个旺季还有几个月(0表示当前就是旺季)
- reasoning用中文简短说明判断依据

只返回JSON,不要其他文字。',
  'Chinese',
  1,
  datetime('now')
);

-- 注册商品综合分析prompt
INSERT INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  is_active,
  created_at
) VALUES (
  'product_comprehensive_analysis',
  'v1.0',
  '商品分析',
  '商品综合分析v1.0',
  '分析商品的类别、目标受众、价格定位、使用场景和商品特点，用于推荐指数计算和推荐理由生成',
  'prompts/product_comprehensive_analysis_v1.0.txt',
  'analyzeProductComprehensive',
  '分析以下商品的详细信息，提供全面的商品特征分析：

商品标题: {{product_name}}
商品品牌: {{brand}}
价格: {{price}}

请分析以下维度：

1. **商品类别** (category)
   - 从以下类别中选择最合适的一个：
   - electronics（电子产品）, clothing（服装）, home（家居）, sports（运动）, beauty（美妆）, toys（玩具）, books（图书）, food（食品）, automotive（汽车用品）, health（健康）, other（其他）

2. **目标受众** (targetAudience)
   - 可以选择多个：male（男性）, female（女性）, kids（儿童）, elderly（老人）, unisex（通用）

3. **价格定位感知** (pricePositioning)
   - 基于商品名称和品牌的感知，不是实际价格
   - 选择一个：luxury（奢侈品）, premium（高端）, mid-range（中端）, budget（经济型）

4. **使用场景** (useScenario)
   - 可以选择多个：indoor（室内）, outdoor（户外）, sports（运动）, office（办公）, travel（旅行）, daily（日常）, party（聚会）, professional（专业）

5. **商品特点** (productFeatures)
   - 可以选择多个：portable（便携）, durable（耐用）, fashionable（时尚）, practical（实用）, innovative（创新）, eco-friendly（环保）, smart（智能）, luxury（奢华）

6. **分析理由** (reasoning)
   - 用中文简短说明你的分析依据（1-2句话）

返回JSON格式：
{
  "category": "electronics",
  "targetAudience": ["male", "unisex"],
  "pricePositioning": "premium",
  "useScenario": ["daily", "office"],
  "productFeatures": ["portable", "innovative", "smart"],
  "reasoning": "这是一款高端电子产品，适合日常和办公使用，具有便携和创新特点"
}',
  'Chinese',
  1,
  datetime('now')
);

-- ============================================
-- 字段说明
-- ============================================
-- recommendation_score: 推荐指数（1.0-5.0星级）
-- recommendation_reasons: 推荐理由（JSON数组，3条理由）
-- seasonality_score: 季节性评分（0-100分）
-- seasonality_analysis: 季节性AI分析结果（JSON格式）
--   - seasonality: 季节性（winter/summer/spring/fall/all-year）
--   - holidays: 相关节日列表
--   - isPeakSeason: 是否当前旺季
--   - monthsUntilPeak: 距离下一个旺季的月数
--   - score: 季节性评分
--   - reasoning: AI分析理由
--   - analyzedAt: 分析时间
-- product_analysis: 商品综合AI分析结果（JSON格式）
--   - category: 商品类别（electronics/clothing/home等）
--   - targetAudience: 目标受众（male/female/kids/elderly/unisex）
--   - pricePositioning: 价格定位（luxury/premium/mid-range/budget）
--   - useScenario: 使用场景（indoor/outdoor/sports/office等）
--   - productFeatures: 商品特点（portable/durable/fashionable等）
--   - reasoning: AI分析理由
--   - analyzedAt: 分析时间
-- score_calculated_at: 评分计算时间戳
