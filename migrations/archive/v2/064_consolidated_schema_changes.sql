-- =====================================================
-- Migration: 064_consolidated_schema_changes.sql
-- Description: 合并Schema变更（原064-080中的表结构和字段变更）
-- Date: 2025-12-14
--
-- 整合来源:
--   - 065: CREATE creative_tasks
--   - 067: ALTER google_ads_accounts ADD status
--   - 068: ALTER ad_creatives ADD ad_strength_data
--   - 069: ALTER scraped_products ADD sales_volume, discount, delivery_info
--   - 070: CREATE upload_records, audit_logs
--   - 072: ALTER offers ADD product_name
--   - 077: ALTER launch_scores ADD dimension columns, ALTER ad_creatives ADD path1/path2
-- =====================================================

-- ============================================================
-- PART 1: CREATE creative_tasks (原065)
-- ============================================================
-- 广告创意生成任务队列表

CREATE TABLE IF NOT EXISTS creative_tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 任务状态
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  stage TEXT DEFAULT 'init',  -- init, generating, evaluating, saving, complete
  progress INTEGER DEFAULT 0,  -- 0-100
  message TEXT,

  -- 输入参数
  max_retries INTEGER DEFAULT 3,
  target_rating TEXT DEFAULT 'EXCELLENT',

  -- 执行状态
  current_attempt INTEGER DEFAULT 0,
  optimization_history TEXT,  -- JSON: [{attempt, rating, score, suggestions}]

  -- 结果数据
  creative_id INTEGER,  -- 关联到 ad_creatives.id
  result TEXT,  -- JSON: 完整的创意生成结果
  error TEXT,   -- JSON: 错误详情

  -- 时间戳
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  FOREIGN KEY (creative_id) REFERENCES ad_creatives(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_creative_tasks_user_status ON creative_tasks(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_creative_tasks_status_created ON creative_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_creative_tasks_offer_id ON creative_tasks(offer_id);
CREATE INDEX IF NOT EXISTS idx_creative_tasks_updated ON creative_tasks(updated_at DESC);

-- ============================================================
-- PART 2: CREATE upload_records (原070)
-- ============================================================
-- 文件上传记录表

CREATE TABLE IF NOT EXISTS upload_records (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,
  batch_id TEXT NOT NULL,

  -- File information
  file_name TEXT NOT NULL,
  file_size INTEGER,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Processing statistics
  valid_count INTEGER DEFAULT 0 CHECK(valid_count >= 0),
  processed_count INTEGER DEFAULT 0 CHECK(processed_count >= 0),
  skipped_count INTEGER DEFAULT 0 CHECK(skipped_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),
  success_rate REAL DEFAULT 0.0 CHECK(success_rate >= 0 AND success_rate <= 100),

  -- Status tracking
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'partial')) DEFAULT 'pending',

  -- Metadata
  metadata TEXT,  -- JSON format

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batch_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_upload_records_user_uploaded ON upload_records(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_records_batch ON upload_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_upload_records_status ON upload_records(status, uploaded_at DESC);

CREATE TRIGGER IF NOT EXISTS update_upload_records_updated_at
AFTER UPDATE ON upload_records
FOR EACH ROW
BEGIN
  UPDATE upload_records SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_upload_records_success_rate
AFTER UPDATE OF processed_count, valid_count ON upload_records
FOR EACH ROW
WHEN NEW.valid_count > 0
BEGIN
  UPDATE upload_records
  SET success_rate = ROUND((CAST(NEW.processed_count AS REAL) / NEW.valid_count) * 100, 2)
  WHERE id = NEW.id;
END;

-- ============================================================
-- PART 3: CREATE audit_logs (原070)
-- ============================================================
-- 安全审计日志表

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  details TEXT, -- JSON format
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);

-- ============================================================
-- PART 4: ALTER google_ads_accounts (原067)
-- ============================================================
-- 添加账户状态字段（带幂等性检查）

CREATE TABLE IF NOT EXISTS _temp_cols AS SELECT name FROM pragma_table_info('google_ads_accounts') WHERE name = 'status';
INSERT INTO _temp_cols VALUES ('status') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols;

ALTER TABLE google_ads_accounts ADD COLUMN status TEXT DEFAULT 'ENABLED';
UPDATE google_ads_accounts SET status = 'ENABLED' WHERE status IS NULL;

-- ============================================================
-- PART 5: ALTER ad_creatives (原068, 077)
-- ============================================================
-- 添加Ad Strength完整数据字段

CREATE TABLE IF NOT EXISTS _temp_cols5 AS SELECT name FROM pragma_table_info('ad_creatives') WHERE name = 'ad_strength_data';
INSERT INTO _temp_cols5 VALUES ('ad_strength_data') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols5;
ALTER TABLE ad_creatives ADD COLUMN ad_strength_data TEXT DEFAULT NULL;

-- 添加RSA Display Path字段
CREATE TABLE IF NOT EXISTS _temp_cols5b AS SELECT name FROM pragma_table_info('ad_creatives') WHERE name = 'path1';
INSERT INTO _temp_cols5b VALUES ('path1') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols5b;
ALTER TABLE ad_creatives ADD COLUMN path1 TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS _temp_cols5c AS SELECT name FROM pragma_table_info('ad_creatives') WHERE name = 'path2';
INSERT INTO _temp_cols5c VALUES ('path2') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols5c;
ALTER TABLE ad_creatives ADD COLUMN path2 TEXT DEFAULT NULL;

-- ============================================================
-- PART 6: ALTER scraped_products (原069)
-- ============================================================
-- 添加销售热度、折扣、配送信息字段（带幂等性检查）

CREATE TABLE IF NOT EXISTS _temp_cols6a AS SELECT name FROM pragma_table_info('scraped_products') WHERE name = 'sales_volume';
INSERT INTO _temp_cols6a VALUES ('sales_volume') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols6a;
ALTER TABLE scraped_products ADD COLUMN sales_volume TEXT;

CREATE TABLE IF NOT EXISTS _temp_cols6b AS SELECT name FROM pragma_table_info('scraped_products') WHERE name = 'discount';
INSERT INTO _temp_cols6b VALUES ('discount') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols6b;
ALTER TABLE scraped_products ADD COLUMN discount TEXT;

CREATE TABLE IF NOT EXISTS _temp_cols6c AS SELECT name FROM pragma_table_info('scraped_products') WHERE name = 'delivery_info';
INSERT INTO _temp_cols6c VALUES ('delivery_info') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols6c;
ALTER TABLE scraped_products ADD COLUMN delivery_info TEXT;

CREATE INDEX IF NOT EXISTS idx_scraped_products_sales_volume
  ON scraped_products(offer_id, sales_volume);

-- ============================================================
-- PART 7: ALTER offers (原072)
-- ============================================================
-- 添加产品名称字段（带幂等性检查）

CREATE TABLE IF NOT EXISTS _temp_cols7 AS SELECT name FROM pragma_table_info('offers') WHERE name = 'product_name';
INSERT INTO _temp_cols7 VALUES ('product_name') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols7;
ALTER TABLE offers ADD COLUMN product_name TEXT;

-- ============================================================
-- PART 8: ALTER launch_scores (原077)
-- ============================================================
-- 添加Launch Score v4.0的4维度评分字段（带幂等性检查）

CREATE TABLE IF NOT EXISTS _temp_cols8a AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'launch_viability_score';
INSERT INTO _temp_cols8a VALUES ('launch_viability_score') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8a;
ALTER TABLE launch_scores ADD COLUMN launch_viability_score INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS _temp_cols8b AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'ad_quality_score';
INSERT INTO _temp_cols8b VALUES ('ad_quality_score') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8b;
ALTER TABLE launch_scores ADD COLUMN ad_quality_score INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS _temp_cols8c AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'keyword_strategy_score';
INSERT INTO _temp_cols8c VALUES ('keyword_strategy_score') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8c;
ALTER TABLE launch_scores ADD COLUMN keyword_strategy_score INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS _temp_cols8d AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'basic_config_score';
INSERT INTO _temp_cols8d VALUES ('basic_config_score') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8d;
ALTER TABLE launch_scores ADD COLUMN basic_config_score INTEGER DEFAULT 0;

-- 添加维度数据字段 (JSON)
CREATE TABLE IF NOT EXISTS _temp_cols8e AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'launch_viability_data';
INSERT INTO _temp_cols8e VALUES ('launch_viability_data') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8e;
ALTER TABLE launch_scores ADD COLUMN launch_viability_data TEXT;

CREATE TABLE IF NOT EXISTS _temp_cols8f AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'ad_quality_data';
INSERT INTO _temp_cols8f VALUES ('ad_quality_data') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8f;
ALTER TABLE launch_scores ADD COLUMN ad_quality_data TEXT;

CREATE TABLE IF NOT EXISTS _temp_cols8g AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'keyword_strategy_data';
INSERT INTO _temp_cols8g VALUES ('keyword_strategy_data') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8g;
ALTER TABLE launch_scores ADD COLUMN keyword_strategy_data TEXT;

CREATE TABLE IF NOT EXISTS _temp_cols8h AS SELECT name FROM pragma_table_info('launch_scores') WHERE name = 'basic_config_data';
INSERT INTO _temp_cols8h VALUES ('basic_config_data') ON CONFLICT DO NOTHING;
DROP TABLE IF EXISTS _temp_cols8h;
ALTER TABLE launch_scores ADD COLUMN basic_config_data TEXT;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- 运行以下查询验证迁移成功:
-- SELECT name FROM sqlite_master WHERE type='table' AND name IN ('creative_tasks', 'upload_records', 'audit_logs');
-- SELECT name FROM pragma_table_info('google_ads_accounts') WHERE name='status';
-- SELECT name FROM pragma_table_info('ad_creatives') WHERE name IN ('ad_strength_data', 'path1', 'path2');
-- SELECT name FROM pragma_table_info('scraped_products') WHERE name IN ('sales_volume', 'discount', 'delivery_info');
-- SELECT name FROM pragma_table_info('offers') WHERE name='product_name';
-- SELECT name FROM pragma_table_info('launch_scores') WHERE name LIKE '%_score' OR name LIKE '%_data';
