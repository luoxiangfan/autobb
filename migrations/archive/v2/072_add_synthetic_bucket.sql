-- 072: 添加综合创意桶类型 'S' (Synthetic)
-- 用于第4个综合广告创意，包含所有品牌词+高搜索量非品牌词
--
-- SQLite不支持ALTER TABLE修改CHECK约束，需要重建表
-- 步骤：1.创建新表 2.复制数据 3.删除旧表 4.重命名新表 5.重建索引

PRAGMA foreign_keys = OFF;

-- 防御：避免重复执行时残留临时表导致失败
DROP TABLE IF EXISTS ad_creatives_new;

-- 0) 兼容旧 schema：先补齐本迁移复制阶段会读取的列（避免 "no such column"）
ALTER TABLE ad_creatives ADD COLUMN ad_strength_data TEXT DEFAULT NULL;
ALTER TABLE ad_creatives ADD COLUMN path1 TEXT DEFAULT NULL;
ALTER TABLE ad_creatives ADD COLUMN path2 TEXT DEFAULT NULL;

-- 1. 创建新表（包含更新后的CHECK约束）
CREATE TABLE ad_creatives_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  headlines TEXT NOT NULL,
  descriptions TEXT NOT NULL,
  callouts TEXT,
  sitelinks TEXT,
  keywords TEXT,
  keywords_with_volume TEXT DEFAULT NULL,
  negative_keywords TEXT DEFAULT NULL,
  final_url TEXT NOT NULL,
  final_url_suffix TEXT,
  theme TEXT,
  explanation TEXT DEFAULT NULL,
  score REAL,
  score_breakdown TEXT,
  generation_round INTEGER DEFAULT 1,
  ai_model TEXT,
  is_selected INTEGER DEFAULT 0,
  google_campaign_id TEXT,
  industry_code TEXT,
  orientation TEXT,
  brand TEXT,
  url TEXT,
  score_explanation TEXT,
  ad_strength TEXT DEFAULT 'UNKNOWN',
  ab_test_variant_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  -- P0-1修复: 添加launch_score字段（从launch_scores表冗余）
  launch_score INTEGER DEFAULT NULL,
  -- P1-1修复: 添加Google Ads同步字段
  ad_group_id INTEGER DEFAULT NULL,
  ad_id TEXT DEFAULT NULL,
  creation_status TEXT NOT NULL DEFAULT 'draft',
  creation_error TEXT DEFAULT NULL,
  last_sync_at TEXT DEFAULT NULL,
  ad_strength_data TEXT DEFAULT NULL,
  path1 TEXT DEFAULT NULL,
  path2 TEXT DEFAULT NULL,
  keyword_bucket TEXT CHECK(keyword_bucket IN ('A', 'B', 'C', 'S')),
  keyword_pool_id INTEGER REFERENCES offer_keyword_pools(id),
  bucket_intent TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- 2. 复制数据
INSERT INTO ad_creatives_new (
  id,
  offer_id,
  user_id,
  headlines,
  descriptions,
  keywords,
  callouts,
  sitelinks,
  final_url,
  final_url_suffix,
  score,
  score_breakdown,
  score_explanation,
  ad_strength,
  generation_round,
  theme,
  ai_model,
  is_selected,
  ab_test_variant_id,
  created_at,
  updated_at,
  google_campaign_id,
  industry_code,
  orientation,
  brand,
  url,
  keywords_with_volume,
  negative_keywords,
  explanation,
  launch_score,
  ad_group_id,
  ad_id,
  creation_status,
  creation_error,
  last_sync_at,
  ad_strength_data,
  path1,
  path2,
  keyword_bucket,
  keyword_pool_id,
  bucket_intent
)
SELECT
  id,
  offer_id,
  user_id,
  headlines,
  descriptions,
  keywords,
  callouts,
  sitelinks,
  final_url,
  final_url_suffix,
  score,
  score_breakdown,
  score_explanation,
  ad_strength,
  generation_round,
  theme,
  ai_model,
  is_selected,
  ab_test_variant_id,
  created_at,
  updated_at,
  google_campaign_id,
  industry_code,
  orientation,
  brand,
  url,
  keywords_with_volume,
  negative_keywords,
  explanation,
  launch_score,
  ad_group_id,
  ad_id,
  creation_status,
  creation_error,
  last_sync_at,
  ad_strength_data,
  path1,
  path2,
  keyword_bucket,
  keyword_pool_id,
  bucket_intent
FROM ad_creatives;

-- 3. 删除旧表
DROP TABLE ad_creatives;

-- 4. 重命名新表
ALTER TABLE ad_creatives_new RENAME TO ad_creatives;

-- 5. 重建索引
CREATE INDEX IF NOT EXISTS idx_ad_creatives_user_id ON ad_creatives(user_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_offer_id ON ad_creatives(offer_id);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_is_selected ON ad_creatives(is_selected);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_keyword_bucket ON ad_creatives(keyword_bucket);

PRAGMA foreign_keys = ON;
