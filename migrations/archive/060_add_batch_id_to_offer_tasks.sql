-- Migration 060: Add batch_id to offer_tasks table
-- Purpose: Link individual offer tasks to parent batch tasks
-- Date: 2025-12-07

ALTER TABLE offer_tasks ADD COLUMN batch_id TEXT REFERENCES batch_tasks(id) ON DELETE SET NULL;

-- Performance index for batch queries
CREATE INDEX IF NOT EXISTS idx_offer_tasks_batch_id ON offer_tasks(batch_id, status);

-- Migration Notes:
-- 1. batch_id is NULL for standalone tasks (manual single creation)
-- 2. batch_id is set for tasks created as part of a batch operation
-- 3. ON DELETE SET NULL: If batch is deleted, child tasks become standalone
-- 4. Index supports efficient queries: "Get all tasks for batch X"
