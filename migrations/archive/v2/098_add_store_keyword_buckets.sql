-- =====================================================
-- Migration: 098_add_store_keyword_buckets
-- Description: 为店铺链接添加关键词分桶字段，支持5种店铺创意类型
-- Date: 2025-12-24
-- Database: SQLite
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

-- 获取现有字段列表
CREATE TABLE IF NOT EXISTS _temp_existing_cols AS
SELECT name FROM pragma_table_info('offer_keyword_pools');

-- 检查并添加店铺分桶关键词字段（幂等性）
INSERT INTO _temp_existing_cols VALUES ('store_bucket_a_keywords')
ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_existing_cols;

-- 添加店铺分桶关键词字段（带 IF NOT EXISTS 检查的替代方案）
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_a_keywords TEXT DEFAULT '[]';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_b_keywords TEXT DEFAULT '[]';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_c_keywords TEXT DEFAULT '[]';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_d_keywords TEXT DEFAULT '[]';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_s_keywords TEXT DEFAULT '[]';

-- 添加店铺分桶意图描述
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_a_intent TEXT DEFAULT '品牌信任导向';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_b_intent TEXT DEFAULT '场景解决导向';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_c_intent TEXT DEFAULT '精选推荐导向';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_d_intent TEXT DEFAULT '信任信号导向';
ALTER TABLE offer_keyword_pools ADD COLUMN store_bucket_s_intent TEXT DEFAULT '店铺全景导向';

-- 添加店铺链接类型标识
ALTER TABLE offer_keyword_pools ADD COLUMN link_type TEXT DEFAULT 'product';

-- ============================================================
-- PART 2: 验证迁移结果
-- ============================================================

-- 验证字段添加成功
SELECT name, type FROM pragma_table_info('offer_keyword_pools') WHERE name LIKE 'store_%';

-- ✅ Migration complete!
-- 新增字段：
-- 1. store_bucket_a_keywords ~ store_bucket_s_keywords: 店铺5种创意类型的关键词
-- 2. store_bucket_a_intent ~ store_bucket_s_intent: 店铺5种创意类型的意图描述
-- 3. link_type: 标识关键词池适用的链接类型（product/store）
