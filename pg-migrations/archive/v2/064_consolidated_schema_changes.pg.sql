-- =====================================================
-- Migration: 064_consolidated_schema_changes.pg.sql
-- Description: 合并Schema变更（PostgreSQL版）
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

CREATE TABLE IF NOT EXISTS creative_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- 任务状态
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  stage TEXT DEFAULT 'init',
  progress INTEGER DEFAULT 0,
  message TEXT,

  -- 输入参数
  max_retries INTEGER DEFAULT 3,
  target_rating TEXT DEFAULT 'EXCELLENT',

  -- 执行状态
  current_attempt INTEGER DEFAULT 0,
  optimization_history JSONB,

  -- 结果数据
  creative_id INTEGER,
  result JSONB,
  error JSONB,

  -- 时间戳
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

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

CREATE TABLE IF NOT EXISTS upload_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  batch_id UUID NOT NULL,

  -- File information
  file_name TEXT NOT NULL,
  file_size INTEGER,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Processing statistics
  valid_count INTEGER DEFAULT 0 CHECK(valid_count >= 0),
  processed_count INTEGER DEFAULT 0 CHECK(processed_count >= 0),
  skipped_count INTEGER DEFAULT 0 CHECK(skipped_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),
  success_rate REAL DEFAULT 0.0 CHECK(success_rate >= 0 AND success_rate <= 100),

  -- Status tracking
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'partial')) DEFAULT 'pending',

  -- Metadata
  metadata JSONB,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batch_tasks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_upload_records_user_uploaded ON upload_records(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_records_batch ON upload_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_upload_records_status ON upload_records(status, uploaded_at DESC);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_upload_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_upload_records_updated_at ON upload_records;
CREATE TRIGGER update_upload_records_updated_at
BEFORE UPDATE ON upload_records
FOR EACH ROW
EXECUTE FUNCTION update_upload_records_updated_at();

-- Trigger for success_rate calculation
CREATE OR REPLACE FUNCTION update_upload_records_success_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.valid_count > 0 THEN
    NEW.success_rate = ROUND((NEW.processed_count::numeric / NEW.valid_count) * 100, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_upload_records_success_rate ON upload_records;
CREATE TRIGGER update_upload_records_success_rate
BEFORE UPDATE OF processed_count, valid_count ON upload_records
FOR EACH ROW
EXECUTE FUNCTION update_upload_records_success_rate();

-- ============================================================
-- PART 3: CREATE audit_logs (原070)
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);

-- ============================================================
-- PART 4: ALTER google_ads_accounts (原067)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'google_ads_accounts' AND column_name = 'status'
  ) THEN
    ALTER TABLE google_ads_accounts ADD COLUMN status TEXT DEFAULT 'ENABLED';
  END IF;
END $$;

UPDATE google_ads_accounts SET status = 'ENABLED' WHERE status IS NULL;

-- ============================================================
-- PART 5: ALTER ad_creatives (原068, 077)
-- ============================================================

DO $$
BEGIN
  -- Add ad_strength_data column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'ad_strength_data'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN ad_strength_data JSONB DEFAULT NULL;
  END IF;

  -- Add path1 column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'path1'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN path1 TEXT DEFAULT NULL;
  END IF;

  -- Add path2 column
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ad_creatives' AND column_name = 'path2'
  ) THEN
    ALTER TABLE ad_creatives ADD COLUMN path2 TEXT DEFAULT NULL;
  END IF;
END $$;

-- ============================================================
-- PART 6: ALTER scraped_products (原069)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'sales_volume'
  ) THEN
    ALTER TABLE scraped_products ADD COLUMN sales_volume TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'discount'
  ) THEN
    ALTER TABLE scraped_products ADD COLUMN discount TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scraped_products' AND column_name = 'delivery_info'
  ) THEN
    ALTER TABLE scraped_products ADD COLUMN delivery_info TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_scraped_products_sales_volume
  ON scraped_products(offer_id, sales_volume);

-- ============================================================
-- PART 7: ALTER offers (原072)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'offers' AND column_name = 'product_name'
  ) THEN
    ALTER TABLE offers ADD COLUMN product_name TEXT;
  END IF;
END $$;

-- ============================================================
-- PART 8: ALTER launch_scores (原077)
-- ============================================================

DO $$
BEGIN
  -- Add dimension score columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'launch_viability_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN launch_viability_score INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'ad_quality_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN ad_quality_score INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'keyword_strategy_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN keyword_strategy_score INTEGER DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'basic_config_score'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN basic_config_score INTEGER DEFAULT 0;
  END IF;

  -- Add dimension data columns (JSONB)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'launch_viability_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN launch_viability_data JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'ad_quality_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN ad_quality_data JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'keyword_strategy_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN keyword_strategy_data JSONB;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'launch_scores' AND column_name = 'basic_config_data'
  ) THEN
    ALTER TABLE launch_scores ADD COLUMN basic_config_data JSONB;
  END IF;
END $$;

-- ============================================================
-- VERIFICATION
-- ============================================================
-- SELECT table_name FROM information_schema.tables WHERE table_name IN ('creative_tasks', 'upload_records', 'audit_logs');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'google_ads_accounts' AND column_name = 'status';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'ad_creatives' AND column_name IN ('ad_strength_data', 'path1', 'path2');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'scraped_products' AND column_name IN ('sales_volume', 'discount', 'delivery_info');
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'offers' AND column_name = 'product_name';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'launch_scores' AND column_name LIKE '%_score' OR column_name LIKE '%_data';
