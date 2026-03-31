-- =====================================================
-- Migration: 098_add_store_keyword_buckets.pg.sql
-- Description: 为店铺链接添加关键词分桶字段，支持5种店铺创意类型
-- Date: 2025-12-24
-- Database: PostgreSQL
-- =====================================================

-- ============================================================
-- PART 1: 添加店铺关键词分桶字段
-- ============================================================

-- 店铺链接的5种创意类型对应不同的关键词策略：
-- A (Brand-Trust): 品牌信任导向 - 80%品牌词 + 10%场景词 + 10%品类词
-- B (Scene-Solution): 场景解决导向 - 20%品牌词 + 60%场景词 + 20%品类词
-- C (Collection-Highlight): 精选推荐导向 - 40%品牌词 + 20%场景词 + 30%品类词 + 10%信任词
-- D (Trust-Signals): 信任信号导向 - 30%品牌词 + 10%场景词 + 20%品类词 + 40%信任词
-- S (Store-Overview): 店铺全景导向 - 50%品牌词 + 30%场景词 + 20%品类词

-- Step 1.1: 检查字段是否已存在（防重复执行）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'offer_keyword_pools' AND column_name = 'store_bucket_a_keywords'
    ) THEN
        -- 添加店铺分桶关键词字段
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_a_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_b_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_c_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_d_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_s_keywords JSONB NOT NULL DEFAULT '[]'::jsonb;

        -- 添加店铺分桶意图描述
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_a_intent TEXT DEFAULT '品牌信任导向';
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_b_intent TEXT DEFAULT '场景解决导向';
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_c_intent TEXT DEFAULT '精选推荐导向';
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_d_intent TEXT DEFAULT '信任信号导向';
        ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_s_intent TEXT DEFAULT '店铺全景导向';

        -- 添加店铺链接类型标识
        ALTER TABLE offer_keyword_pools ADD COLUMN link_type TEXT DEFAULT 'product';

        RAISE NOTICE '店铺关键词分桶字段已添加';
    ELSE
        RAISE NOTICE '店铺关键词分桶字段已存在，跳过添加';
    END IF;
END $$;

-- Step 1.2: 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_offer_keyword_pools_link_type ON offer_keyword_pools(link_type);

-- ============================================================
-- PART 2: 验证迁移结果
-- ============================================================

-- 验证字段添加成功
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'offer_keyword_pools' AND column_name LIKE 'store_%'
ORDER BY column_name;

-- 查看结构
SELECT id, offer_id, link_type,
       jsonb_array_length(store_bucket_a_keywords) > 0 as has_store_a,
       jsonb_array_length(store_bucket_b_keywords) > 0 as has_store_b,
       jsonb_array_length(store_bucket_c_keywords) > 0 as has_store_c,
       jsonb_array_length(store_bucket_d_keywords) > 0 as has_store_d,
       jsonb_array_length(store_bucket_s_keywords) > 0 as has_store_s
FROM offer_keyword_pools
LIMIT 5;

-- ✅ Migration complete!
-- 新增字段：
-- 1. store_bucket_a_keywords ~ store_bucket_s_keywords: 店铺5种创意类型的关键词
-- 2. store_bucket_a_intent ~ store_bucket_s_intent: 店铺5种创意类型的意图描述
-- 3. link_type: 标识关键词池适用的链接类型（product/store）
-- 4. idx_offer_keyword_pools_link_type: 链接类型索引
