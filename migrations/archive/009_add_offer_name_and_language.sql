-- ========================================
-- Migration 009: 添加offer_name和target_language字段
-- ========================================
-- 目的：实现需求1和需求5的自动生成字段
-- 原则：KISS - 只添加必需字段，保留现有所有字段
-- ========================================

-- 步骤1: 添加offer_name字段（Offer唯一标识）
-- 格式：品牌名称_推广国家_序号（如：Reolink_US_01）
ALTER TABLE offers ADD COLUMN offer_name TEXT;

-- 步骤2: 添加target_language字段（推广语言）
-- 根据target_country自动映射（如：US→English, DE→German）
ALTER TABLE offers ADD COLUMN target_language TEXT;

-- 步骤3: 为现有数据生成临时的offer_name
-- 注意：这里生成的是临时值，真实值应该由应用层的generateOfferName()函数生成
UPDATE offers
SET offer_name = brand || '_' || target_country || '_01'
WHERE offer_name IS NULL;

-- 步骤4: 为现有数据设置target_language
-- 根据target_country映射推广语言
UPDATE offers
SET target_language = CASE target_country
  -- 英语国家
  WHEN 'US' THEN 'English'
  WHEN 'GB' THEN 'English'
  WHEN 'CA' THEN 'English'
  WHEN 'AU' THEN 'English'
  WHEN 'NZ' THEN 'English'
  WHEN 'IE' THEN 'English'
  WHEN 'SG' THEN 'English'
  WHEN 'PH' THEN 'English'
  WHEN 'ZA' THEN 'English'

  -- 欧洲语言
  WHEN 'DE' THEN 'German'
  WHEN 'AT' THEN 'German'
  WHEN 'CH' THEN 'German'
  WHEN 'FR' THEN 'French'
  WHEN 'BE' THEN 'French'
  WHEN 'ES' THEN 'Spanish'
  WHEN 'MX' THEN 'Spanish'
  WHEN 'AR' THEN 'Spanish'
  WHEN 'CL' THEN 'Spanish'
  WHEN 'CO' THEN 'Spanish'
  WHEN 'IT' THEN 'Italian'
  WHEN 'PT' THEN 'Portuguese'
  WHEN 'BR' THEN 'Portuguese'
  WHEN 'NL' THEN 'Dutch'
  WHEN 'PL' THEN 'Polish'
  WHEN 'SE' THEN 'Swedish'
  WHEN 'NO' THEN 'Norwegian'
  WHEN 'DK' THEN 'Danish'
  WHEN 'FI' THEN 'Finnish'
  WHEN 'GR' THEN 'Greek'
  WHEN 'CZ' THEN 'Czech'
  WHEN 'HU' THEN 'Hungarian'
  WHEN 'RO' THEN 'Romanian'

  -- 亚洲语言
  WHEN 'JP' THEN 'Japanese'
  WHEN 'CN' THEN 'Chinese'
  WHEN 'TW' THEN 'Chinese'
  WHEN 'HK' THEN 'Chinese'
  WHEN 'KR' THEN 'Korean'
  WHEN 'TH' THEN 'Thai'
  WHEN 'VN' THEN 'Vietnamese'
  WHEN 'IN' THEN 'Hindi'
  WHEN 'ID' THEN 'Indonesian'
  WHEN 'MY' THEN 'Malay'

  -- 中东语言
  WHEN 'SA' THEN 'Arabic'
  WHEN 'AE' THEN 'Arabic'
  WHEN 'EG' THEN 'Arabic'
  WHEN 'IL' THEN 'Hebrew'
  WHEN 'TR' THEN 'Turkish'

  -- 默认英语
  ELSE 'English'
END
WHERE target_language IS NULL;

-- 步骤5: 设置字段为NOT NULL（在填充数据后）
-- 注意：SQLite不支持直接ALTER COLUMN为NOT NULL，需要重建表
-- 为了简化（KISS原则），我们先不设置NOT NULL约束
-- 在应用层确保这些字段始终有值

-- 步骤6: 创建索引以提升查询性能
CREATE INDEX IF NOT EXISTS idx_offers_offer_name ON offers(offer_name);
CREATE INDEX IF NOT EXISTS idx_offers_user_brand_country ON offers(user_id, brand, target_country);

-- ========================================
-- 迁移完成说明
-- ========================================
-- 1. 新增字段: offer_name, target_language
-- 2. 现有数据已填充临时值
-- 3. 后续新创建的Offer将由应用层API自动生成正确的值
-- 4. 保留了所有现有字段（brand_description, unique_selling_points等）
-- ========================================
