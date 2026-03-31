-- Migration 059: Create batch_tasks table for batch operations
-- Purpose: Support batch offer creation, scrape, and other bulk operations
-- Features:
--   - Parent task for coordinating multiple child tasks
--   - Progress tracking (total, completed, failed counts)
--   - Support for different batch types (creation, scrape, enhance)
--   - User-level isolation
-- Date: 2025-12-07

CREATE TABLE IF NOT EXISTS batch_tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  user_id INTEGER NOT NULL,

  -- Batch task type and status
  task_type TEXT NOT NULL CHECK(task_type IN ('offer-creation', 'offer-scrape', 'offer-enhance')) DEFAULT 'offer-creation',
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'partial')) DEFAULT 'pending',

  -- Progress statistics
  total_count INTEGER DEFAULT 0 CHECK(total_count >= 0),
  completed_count INTEGER DEFAULT 0 CHECK(completed_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),

  -- Batch metadata
  source_file TEXT,  -- CSV filename or source identifier
  metadata TEXT,     -- JSON: additional metadata (e.g., {"target_country": "US"})

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,

  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_batch_tasks_user_status ON batch_tasks(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_tasks_status_created ON batch_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_batch_tasks_user_created ON batch_tasks(user_id, created_at DESC);

-- Auto-update trigger for updated_at
CREATE TRIGGER IF NOT EXISTS update_batch_tasks_updated_at
AFTER UPDATE ON batch_tasks
FOR EACH ROW
BEGIN
  UPDATE batch_tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Table comments (stored as separate metadata)
-- batch_tasks: Parent task for coordinating batch operations (offer creation, scraping, etc.)
-- id: Unique batch task identifier (UUID)
-- user_id: User who created the batch task (for isolation and concurrency control)
-- task_type: Type of batch operation (offer-creation, offer-scrape, offer-enhance)
-- status: Batch status - pending → running → (completed | failed | partial)
-- total_count: Total number of child tasks in this batch
-- completed_count: Number of successfully completed child tasks
-- failed_count: Number of failed child tasks
-- source_file: Source file name (e.g., CSV filename for bulk import)
-- metadata: JSON metadata for batch-specific configuration
-- started_at: Timestamp when first child task started
-- completed_at: Timestamp when all child tasks finished

-- Migration Notes:
-- 1. Batch isolation: Each user's batches are isolated by user_id
-- 2. Child task tracking: Child tasks (offer_tasks) will reference this via batch_id
-- 3. Status flow: pending → running → (completed | failed | partial)
--    - completed: All child tasks succeeded
--    - failed: All child tasks failed
--    - partial: Some succeeded, some failed
-- 4. Cleanup: Old batches (>30 days) should be cleaned up by cron job
