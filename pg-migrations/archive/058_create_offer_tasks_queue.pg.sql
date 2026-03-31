-- Migration 058: Create offer_tasks table for task queue architecture (PostgreSQL)
-- Purpose: Decouple task execution from SSE connections, enable task persistence and reconnection
-- Features:
--   - User-level isolation (user_id)
--   - Task status tracking (pending, running, completed, failed)
--   - Progress monitoring (0-100)
--   - Result persistence (JSONB)
--   - Respects /admin/queue concurrency limits (globalConcurrency, perUserConcurrency)
-- Date: 2025-12-07

CREATE TABLE IF NOT EXISTS offer_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL,

  -- Task status and progress
  status VARCHAR(20) NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  stage VARCHAR(50), -- resolving_link, brand_extraction, ai_analysis, etc.
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  message TEXT,

  -- Input parameters
  affiliate_link TEXT NOT NULL,
  target_country VARCHAR(10) NOT NULL,
  skip_cache BOOLEAN DEFAULT FALSE,
  skip_warmup BOOLEAN DEFAULT FALSE,

  -- Output results
  result JSONB, -- JSON object of extraction result
  error JSONB,  -- JSON object of error details

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  started_at TIMESTAMP WITH TIME ZONE,    -- When task actually started running
  completed_at TIMESTAMP WITH TIME ZONE,  -- When task finished (success or failure)

  -- Foreign key
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_offer_tasks_user_status ON offer_tasks(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_tasks_status_created ON offer_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_offer_tasks_user_created ON offer_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_tasks_updated ON offer_tasks(updated_at DESC);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_offer_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_offer_tasks_updated_at
BEFORE UPDATE ON offer_tasks
FOR EACH ROW
EXECUTE FUNCTION update_offer_tasks_updated_at();

-- Table comments
COMMENT ON TABLE offer_tasks IS 'Task queue for offer extraction workflow - supports SSE reconnection and task persistence';
COMMENT ON COLUMN offer_tasks.id IS 'Unique task identifier (UUID)';
COMMENT ON COLUMN offer_tasks.user_id IS 'User who created the task (for isolation and concurrency control)';
COMMENT ON COLUMN offer_tasks.status IS 'Task status: pending → running → (completed | failed)';
COMMENT ON COLUMN offer_tasks.stage IS 'Current execution stage (resolving_link, brand_extraction, ai_analysis, etc.)';
COMMENT ON COLUMN offer_tasks.progress IS 'Progress percentage (0-100)';
COMMENT ON COLUMN offer_tasks.result IS 'Extraction result on success (JSONB)';
COMMENT ON COLUMN offer_tasks.error IS 'Error details on failure (JSONB)';
COMMENT ON COLUMN offer_tasks.started_at IS 'Timestamp when task started running';
COMMENT ON COLUMN offer_tasks.completed_at IS 'Timestamp when task completed (success or failure)';

-- Migration Notes:
-- 1. Task isolation: Each user's tasks are isolated by user_id
-- 2. Concurrency control: Application layer enforces globalConcurrency and perUserConcurrency limits
-- 3. Status flow: pending → running → (completed | failed)
-- 4. Cleanup: Old tasks (>7 days) should be cleaned up by cron job
