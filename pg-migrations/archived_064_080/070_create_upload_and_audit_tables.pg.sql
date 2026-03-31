-- Migration 070: Create upload_records and audit_logs tables (PostgreSQL)
-- Purpose:
--   1. Track file upload history and processing results
--   2. Record security-related events and user operations
-- Date: 2025-12-10

-- ============================================================
-- Part 1: Create upload_records table
-- ============================================================

CREATE TABLE IF NOT EXISTS upload_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,
  batch_id UUID NOT NULL,

  -- File information
  file_name TEXT NOT NULL,
  file_size INTEGER,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Processing statistics
  valid_count INTEGER DEFAULT 0 CHECK(valid_count >= 0),
  processed_count INTEGER DEFAULT 0 CHECK(processed_count >= 0),
  skipped_count INTEGER DEFAULT 0 CHECK(skipped_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),
  success_rate NUMERIC(5,2) DEFAULT 0.0 CHECK(success_rate >= 0 AND success_rate <= 100),

  -- Status tracking
  status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'partial')) DEFAULT 'pending',

  -- Metadata (PostgreSQL: JSONB for better performance)
  metadata JSONB,

  -- Timestamps (PostgreSQL: TIMESTAMP WITH TIME ZONE)
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batch_tasks(id) ON DELETE CASCADE
);

-- upload_records indexes
CREATE INDEX IF NOT EXISTS idx_upload_records_user_uploaded ON upload_records(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_records_batch ON upload_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_upload_records_status ON upload_records(status, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_records_metadata ON upload_records USING GIN (metadata);

-- upload_records triggers (PostgreSQL syntax)
CREATE OR REPLACE FUNCTION update_upload_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_upload_records_updated_at
BEFORE UPDATE ON upload_records
FOR EACH ROW
EXECUTE FUNCTION update_upload_records_updated_at();

CREATE OR REPLACE FUNCTION update_upload_records_success_rate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.valid_count > 0 THEN
    NEW.success_rate = ROUND((NEW.processed_count::numeric / NEW.valid_count) * 100, 2);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_upload_records_success_rate
BEFORE UPDATE OF processed_count, valid_count ON upload_records
FOR EACH ROW
WHEN (NEW.valid_count > 0)
EXECUTE FUNCTION update_upload_records_success_rate();

-- ============================================================
-- Part 2: Create audit_logs table
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  event_type TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  details JSONB, -- PostgreSQL: JSONB for better performance
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- audit_logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_audit_logs_details ON audit_logs USING GIN(details);

-- ============================================================
-- Table Comments (PostgreSQL syntax)
-- ============================================================

COMMENT ON TABLE upload_records IS 'Track batch file upload history and processing results';
COMMENT ON COLUMN upload_records.id IS 'Unique upload record identifier (UUID)';
COMMENT ON COLUMN upload_records.user_id IS 'User who uploaded the file (for isolation)';
COMMENT ON COLUMN upload_records.batch_id IS 'Reference to batch_tasks for detailed processing status';
COMMENT ON COLUMN upload_records.file_name IS 'Original uploaded file name';
COMMENT ON COLUMN upload_records.file_size IS 'File size in bytes';
COMMENT ON COLUMN upload_records.uploaded_at IS 'Upload timestamp';
COMMENT ON COLUMN upload_records.valid_count IS 'Number of valid offers in the uploaded file';
COMMENT ON COLUMN upload_records.processed_count IS 'Number of successfully processed offers';
COMMENT ON COLUMN upload_records.skipped_count IS 'Number of rows skipped due to missing required fields';
COMMENT ON COLUMN upload_records.failed_count IS 'Number of offers failed during processing';
COMMENT ON COLUMN upload_records.success_rate IS 'Percentage of successful processing (processed / valid * 100)';
COMMENT ON COLUMN upload_records.status IS 'Processing status (pending → processing → completed/failed/partial)';
COMMENT ON COLUMN upload_records.metadata IS 'JSON metadata (errors, warnings, additional info)';

COMMENT ON TABLE audit_logs IS 'Security audit and user operation logging';
COMMENT ON COLUMN audit_logs.id IS 'Unique audit log identifier';
COMMENT ON COLUMN audit_logs.user_id IS 'User who triggered the event (NULL for unauthenticated events)';
COMMENT ON COLUMN audit_logs.event_type IS 'Type of security event (login, logout, password_change, etc.)';
COMMENT ON COLUMN audit_logs.ip_address IS 'IP address of the client';
COMMENT ON COLUMN audit_logs.user_agent IS 'User agent string from the request';
COMMENT ON COLUMN audit_logs.details IS 'Additional context information in JSONB format';
COMMENT ON COLUMN audit_logs.created_at IS 'Event timestamp';

-- ============================================================
-- Migration Notes
-- ============================================================

-- PostgreSQL-specific differences from SQLite:
-- 1. UUID type instead of TEXT for record ids
-- 2. TIMESTAMP WITH TIME ZONE instead of TEXT for timestamps
-- 3. JSONB instead of TEXT for JSON data (better performance)
-- 4. SERIAL for auto-incrementing integers
-- 5. Function/Trigger syntax differences
-- 6. NUMERIC(5,2) instead of REAL for decimal precision
-- 7. COMMENT ON for table/column documentation
-- 8. GIN indexes for JSONB column queries
