-- Migration 058: Create offer_tasks table for task queue architecture
-- Purpose: Decouple task execution from SSE connections, enable task persistence and reconnection
-- Features:
--   - User-level isolation (user_id)
--   - Task status tracking (pending, running, completed, failed)
--   - Progress monitoring (0-100)
--   - Result persistence (JSON)
--   - Respects /admin/queue concurrency limits (globalConcurrency, perUserConcurrency)
-- Date: 2025-12-07

CREATE TABLE IF NOT EXISTS offer_tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()) % 4 + 1, 1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
  user_id INTEGER NOT NULL,

  -- Task status and progress
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')) DEFAULT 'pending',
  stage TEXT, -- resolving_link, brand_extraction, ai_analysis, etc.
  progress INTEGER DEFAULT 0 CHECK(progress >= 0 AND progress <= 100),
  message TEXT,

  -- Input parameters
  affiliate_link TEXT NOT NULL,
  target_country TEXT NOT NULL,
  skip_cache INTEGER DEFAULT 0, -- 0 or 1 (SQLite boolean)
  skip_warmup INTEGER DEFAULT 0, -- 0 or 1 (SQLite boolean)

  -- Output results
  result TEXT, -- JSON string of extraction result
  error TEXT,  -- JSON string of error details

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,    -- When task actually started running
  completed_at TEXT,  -- When task finished (success or failure)

  -- Foreign key
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_offer_tasks_user_status ON offer_tasks(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_tasks_status_created ON offer_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_offer_tasks_user_created ON offer_tasks(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_offer_tasks_updated ON offer_tasks(updated_at DESC);

-- Auto-update trigger for updated_at
CREATE TRIGGER IF NOT EXISTS trigger_offer_tasks_updated_at
AFTER UPDATE ON offer_tasks
FOR EACH ROW
WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE offer_tasks SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Migration Notes:
-- 1. Task isolation: Each user's tasks are isolated by user_id
-- 2. Concurrency control: Application layer enforces globalConcurrency and perUserConcurrency limits
-- 3. Status flow: pending → running → (completed | failed)
-- 4. Cleanup: Old tasks (>7 days) should be cleaned up by cron job
