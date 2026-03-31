-- 072: 添加综合创意桶类型 'S' (Synthetic)
-- 用于第4个综合广告创意，包含所有品牌词+高搜索量非品牌词

-- 1. 删除现有的CHECK约束
ALTER TABLE ad_creatives DROP CONSTRAINT IF EXISTS ad_creatives_keyword_bucket_check;

-- 2. 添加新的CHECK约束，支持 'A', 'B', 'C', 'S'
ALTER TABLE ad_creatives ADD CONSTRAINT ad_creatives_keyword_bucket_check
  CHECK (keyword_bucket = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'S'::text]));

-- 3. 添加注释说明
COMMENT ON COLUMN ad_creatives.keyword_bucket IS '关键词桶类型: A=品牌导向, B=场景导向, C=功能导向, S=综合(Synthetic)';
