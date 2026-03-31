-- Migration: Create bonus score system tables
-- Date: 2025-11-23
-- Description: 创建广告效果加分机制所需的数据库表

-- 1. 行业基准数据表（二级分类，30个细分行业）
CREATE TABLE IF NOT EXISTS industry_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    industry_l1 TEXT NOT NULL,           -- 一级行业（如：E-commerce, Travel）
    industry_l2 TEXT NOT NULL,           -- 二级行业（如：Fashion & Apparel, Luggage）
    industry_code TEXT NOT NULL UNIQUE,  -- 行业代码（如：ecom_fashion, travel_luggage）
    avg_ctr REAL NOT NULL,               -- 平均点击率 (%)
    avg_cpc REAL NOT NULL,               -- 平均单次点击成本 ($)
    avg_conversion_rate REAL NOT NULL,   -- 平均转化率 (%)
    data_source TEXT DEFAULT 'Google Ads Industry Benchmarks 2024',
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_code ON industry_benchmarks(industry_code);
CREATE INDEX IF NOT EXISTS idx_industry_benchmarks_l1 ON industry_benchmarks(industry_l1);

-- 2. 广告创意效果数据表
CREATE TABLE IF NOT EXISTS ad_creative_performance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_creative_id INTEGER NOT NULL,
    offer_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,

    -- Google Ads 效果数据
    impressions INTEGER DEFAULT 0,        -- 展示次数
    clicks INTEGER DEFAULT 0,             -- 点击次数
    ctr REAL DEFAULT 0,                   -- 点击率 (%)
    cost REAL DEFAULT 0,                  -- 总花费 ($)
    cpc REAL DEFAULT 0,                   -- 单次点击成本 ($)

    -- 转化数据（用户手动反馈）
    conversions INTEGER DEFAULT 0,        -- 转化次数
    conversion_rate REAL DEFAULT 0,       -- 转化率 (%)
    conversion_value REAL DEFAULT 0,      -- 转化价值 ($)

    -- 加分计算
    industry_code TEXT,                   -- 关联的行业代码
    bonus_score INTEGER DEFAULT 0,        -- 加分（0-20）
    bonus_breakdown TEXT,                 -- 加分明细 JSON
    min_clicks_reached BOOLEAN DEFAULT FALSE, -- 是否达到最低100点击

    -- 时间戳
    sync_date DATE NOT NULL,              -- 数据同步日期
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE,
    FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_creative ON ad_creative_performance(ad_creative_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_offer ON ad_creative_performance(offer_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_user ON ad_creative_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_creative_performance_date ON ad_creative_performance(sync_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_creative_performance_unique ON ad_creative_performance(ad_creative_id, sync_date);

-- 3. 用户转化反馈表
CREATE TABLE IF NOT EXISTS conversion_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_creative_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,

    -- 转化数据
    conversions INTEGER NOT NULL,         -- 转化次数
    conversion_value REAL DEFAULT 0,      -- 转化价值 ($)
    feedback_note TEXT,                   -- 备注

    -- 反馈时间范围
    period_start DATE NOT NULL,           -- 统计开始日期
    period_end DATE NOT NULL,             -- 统计结束日期

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (ad_creative_id) REFERENCES ad_creatives(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_conversion_feedback_creative ON conversion_feedback(ad_creative_id);
CREATE INDEX IF NOT EXISTS idx_conversion_feedback_user ON conversion_feedback(user_id);

-- 4. 评分分析历史表（用于样本驱动的优化分析）
CREATE TABLE IF NOT EXISTS score_analysis_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    industry_code TEXT NOT NULL,

    -- 分析样本信息
    sample_count INTEGER NOT NULL,        -- 分析的创意数量
    trigger_type TEXT NOT NULL,           -- 触发类型: 'sample_threshold', 'manual', 'scheduled'

    -- 相关性分析结果
    correlation_clicks REAL,              -- 点击数与评分相关性
    correlation_ctr REAL,                 -- CTR与评分相关性
    correlation_cpc REAL,                 -- CPC与评分相关性
    correlation_conversions REAL,         -- 转化与评分相关性
    overall_correlation REAL,             -- 综合相关性

    -- 优化建议
    insights TEXT,                        -- 分析洞察 JSON
    recommendations TEXT,                 -- 优化建议 JSON

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_score_analysis_user ON score_analysis_history(user_id);
CREATE INDEX IF NOT EXISTS idx_score_analysis_industry ON score_analysis_history(industry_code);

-- 5. 插入行业基准数据（30个二级分类）
INSERT OR IGNORE INTO industry_benchmarks (industry_l1, industry_l2, industry_code, avg_ctr, avg_cpc, avg_conversion_rate) VALUES
-- E-commerce 电商（6个子类）
('E-commerce', 'Fashion & Apparel', 'ecom_fashion', 2.41, 0.45, 2.77),
('E-commerce', 'Electronics & Gadgets', 'ecom_electronics', 2.04, 0.68, 1.91),
('E-commerce', 'Home & Garden', 'ecom_home', 2.53, 0.52, 2.23),
('E-commerce', 'Health & Beauty', 'ecom_beauty', 2.78, 0.41, 3.19),
('E-commerce', 'Sports & Outdoors', 'ecom_sports', 2.35, 0.58, 2.01),
('E-commerce', 'Food & Beverage', 'ecom_food', 2.67, 0.38, 2.85),

-- Travel 旅游（4个子类）
('Travel', 'Luggage & Travel Gear', 'travel_luggage', 3.18, 0.95, 2.47),
('Travel', 'Hotels & Accommodation', 'travel_hotels', 4.68, 1.22, 2.57),
('Travel', 'Flights & Transportation', 'travel_flights', 4.29, 0.84, 2.14),
('Travel', 'Tours & Activities', 'travel_tours', 3.87, 0.76, 3.01),

-- Technology 科技（4个子类）
('Technology', 'Software & SaaS', 'tech_saas', 2.41, 3.50, 3.04),
('Technology', 'Consumer Electronics', 'tech_consumer', 2.18, 0.72, 1.84),
('Technology', 'B2B Tech Services', 'tech_b2b', 2.09, 4.21, 2.58),
('Technology', 'Mobile Apps', 'tech_apps', 3.24, 0.52, 4.12),

-- Finance 金融（4个子类）
('Finance', 'Banking & Credit', 'finance_banking', 2.91, 3.77, 4.19),
('Finance', 'Insurance', 'finance_insurance', 2.13, 4.52, 1.87),
('Finance', 'Investment & Trading', 'finance_investment', 1.92, 5.14, 2.23),
('Finance', 'Cryptocurrency', 'finance_crypto', 2.47, 2.89, 1.56),

-- Education 教育（3个子类）
('Education', 'Online Courses', 'edu_online', 3.39, 2.13, 3.67),
('Education', 'Academic Programs', 'edu_academic', 2.87, 3.42, 2.94),
('Education', 'Professional Training', 'edu_professional', 2.65, 2.78, 3.21),

-- Healthcare 医疗健康（3个子类）
('Healthcare', 'Medical Services', 'health_medical', 3.12, 2.89, 3.78),
('Healthcare', 'Pharmaceuticals', 'health_pharma', 2.68, 1.95, 2.47),
('Healthcare', 'Wellness & Fitness', 'health_wellness', 3.45, 0.89, 3.92),

-- Automotive 汽车（2个子类）
('Automotive', 'Vehicle Sales', 'auto_sales', 2.14, 2.46, 2.53),
('Automotive', 'Auto Parts & Services', 'auto_parts', 2.67, 1.24, 3.14),

-- Real Estate 房地产（2个子类）
('Real Estate', 'Residential', 'realestate_residential', 2.03, 1.89, 1.94),
('Real Estate', 'Commercial', 'realestate_commercial', 1.87, 2.67, 1.72),

-- Entertainment 娱乐（2个子类）
('Entertainment', 'Gaming', 'entertainment_gaming', 3.56, 0.47, 2.87),
('Entertainment', 'Streaming & Media', 'entertainment_media', 3.21, 0.65, 2.34);

-- 更新 offers 表添加行业分类字段（如果不存在）
-- ALTER TABLE offers ADD COLUMN industry_code TEXT;
