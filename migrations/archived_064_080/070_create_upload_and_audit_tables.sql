-- Migration 070: Create upload_records and audit_logs tables
-- Purpose:
--   1. Track file upload history and processing results
--   2. Record security-related events and user operations
-- Date: 2025-12-10

-- ============================================================
-- Part 1: Create upload_records table
-- ============================================================

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

-- upload_records indexes
CREATE INDEX IF NOT EXISTS idx_upload_records_user_uploaded ON upload_records(user_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_records_batch ON upload_records(batch_id);
CREATE INDEX IF NOT EXISTS idx_upload_records_status ON upload_records(status, uploaded_at DESC);

-- upload_records triggers
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
-- Part 2: Create audit_logs table
-- ============================================================

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

-- audit_logs indexes
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_ip_address ON audit_logs(ip_address);

-- ============================================================
-- Table Comments
-- ============================================================

-- upload_records: Track batch file upload history and processing results
--   - Provides user-facing upload history
--   - Links to batch_tasks for detailed processing status
--   - Success rate auto-calculated via trigger
--   - Status syncs with batch_tasks.status

-- audit_logs: Security audit and user operation logging
--   - Records authentication events (login, logout, failures)
--   - Tracks sensitive operations (password changes, role updates)
--   - Monitors security events (suspicious activity, unauthorized access)
--   - Retention: 90 days (configurable via cleanup job)
