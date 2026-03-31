-- Migration 059: Create batch_tasks table for batch operations (PostgreSQL)
-- Purpose: Support batch offer creation, scrape, and other bulk operations
-- Features:
--   - Parent task for coordinating multiple child tasks
--   - Progress tracking (total, completed, failed counts)
--   - Support for different batch types (creation, scrape, enhance)
--   - User-level isolation
-- Date: 2025-12-07

CREATE TABLE IF NOT EXISTS batch_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,

  -- Batch task type and status
  task_type VARCHAR(20) NOT NULL CHECK(task_type IN ('offer-creation', 'offer-scrape', 'offer-enhance')) DEFAULT 'offer-creation',
  status VARCHAR(20) NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'partial')) DEFAULT 'pending',

  -- Progress statistics
  total_count INTEGER DEFAULT 0 CHECK(total_count >= 0),
  completed_count INTEGER DEFAULT 0 CHECK(completed_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),

  -- Batch metadata
  source_file TEXT,  -- CSV filename or source identifier
  metadata JSONB,    -- JSON: additional metadata (e.g., {"target_country": "US"})

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,

  -- Foreign key
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_batch_tasks_user_status ON batch_tasks(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_tasks_status_created ON batch_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_batch_tasks_user_created ON batch_tasks(user_id, created_at DESC);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_batch_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_batch_tasks_updated_at
BEFORE UPDATE ON batch_tasks
FOR EACH ROW
EXECUTE FUNCTION update_batch_tasks_updated_at();

-- Table comments
COMMENT ON TABLE batch_tasks IS 'Parent task for coordinating batch operations (offer creation, scraping, etc.)';
COMMENT ON COLUMN batch_tasks.id IS 'Unique batch task identifier (UUID)';
COMMENT ON COLUMN batch_tasks.user_id IS 'User who created the batch task (for isolation and concurrency control)';
COMMENT ON COLUMN batch_tasks.task_type IS 'Type of batch operation (offer-creation, offer-scrape, offer-enhance)';
COMMENT ON COLUMN batch_tasks.status IS 'Batch status: pending → running → (completed | failed | partial)';
COMMENT ON COLUMN batch_tasks.total_count IS 'Total number of child tasks in this batch';
COMMENT ON COLUMN batch_tasks.completed_count IS 'Number of successfully completed child tasks';
COMMENT ON COLUMN batch_tasks.failed_count IS 'Number of failed child tasks';
COMMENT ON COLUMN batch_tasks.source_file IS 'Source file name (e.g., CSV filename for bulk import)';
COMMENT ON COLUMN batch_tasks.metadata IS 'JSON metadata for batch-specific configuration';
COMMENT ON COLUMN batch_tasks.started_at IS 'Timestamp when first child task started';
COMMENT ON COLUMN batch_tasks.completed_at IS 'Timestamp when all child tasks finished';

-- Migration Notes:
-- 1. Batch isolation: Each user's batches are isolated by user_id
-- 2. Child task tracking: Child tasks (offer_tasks) will reference this via batch_id
-- 3. Status flow: pending → running → (completed | failed | partial)
--    - completed: All child tasks succeeded
--    - failed: All child tasks failed
--    - partial: Some succeeded, some failed
-- 4. Cleanup: Old batches (>30 days) should be cleaned up by cron job
