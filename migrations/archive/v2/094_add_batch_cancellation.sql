-- ===================================================
-- Migration: 094_add_batch_cancellation.sql
-- Description: 为batch_tasks添加取消功能支持
-- Created: 2025-12-23
-- ===================================================

-- 🔥 问题背景：
-- 当代理质量差导致批量任务大量失败时，无法及时终止任务
-- 用户需要等待所有任务执行完毕才能重新上传

-- 🎯 解决方案：
-- 1. 添加'cancelled'状态支持
-- 2. 记录取消时间和取消原因
-- 3. 支持用户主动取消批量任务

-- Step 1: 创建新表（包含cancelled状态）
CREATE TABLE batch_tasks_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,

  -- Batch task type and status
  task_type TEXT NOT NULL CHECK(task_type IN ('offer-creation', 'offer-scrape', 'offer-enhance')) DEFAULT 'offer-creation',
  status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed', 'partial', 'cancelled')) DEFAULT 'pending',

  -- Progress statistics
  total_count INTEGER DEFAULT 0 CHECK(total_count >= 0),
  completed_count INTEGER DEFAULT 0 CHECK(completed_count >= 0),
  failed_count INTEGER DEFAULT 0 CHECK(failed_count >= 0),

  -- Batch metadata
  source_file TEXT,
  metadata TEXT,

  -- Timestamps
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TEXT,
  completed_at TEXT,

  -- 🆕 Cancellation fields
  cancelled_at TEXT,
  cancelled_by INTEGER,
  cancellation_reason TEXT,

  -- Foreign keys
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL
);

-- Step 2: 复制现有数据
INSERT INTO batch_tasks_new (
  id, user_id, task_type, status,
  total_count, completed_count, failed_count,
  source_file, metadata,
  created_at, updated_at, started_at, completed_at
)
SELECT
  id, user_id, task_type, status,
  total_count, completed_count, failed_count,
  source_file, metadata,
  created_at, updated_at, started_at, completed_at
FROM batch_tasks;

-- Step 3: 删除旧表
DROP TABLE batch_tasks;

-- Step 4: 重命名新表
ALTER TABLE batch_tasks_new RENAME TO batch_tasks;

-- Step 5: 重建索引
CREATE INDEX idx_batch_tasks_user_status ON batch_tasks(user_id, status, created_at DESC);
CREATE INDEX idx_batch_tasks_status_created ON batch_tasks(status, created_at);
CREATE INDEX idx_batch_tasks_user_created ON batch_tasks(user_id, created_at DESC);

-- Step 6: 为upload_records添加cancelled状态支持
CREATE TABLE upload_records_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,
  batch_id TEXT NOT NULL,

  -- File metadata
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,

  -- Processing statistics
  valid_count INTEGER DEFAULT 0,
  processed_count INTEGER DEFAULT 0,
  skipped_count INTEGER DEFAULT 0,
  failed_count INTEGER DEFAULT 0,
  success_rate REAL DEFAULT 0.0,

  -- Status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial' | 'cancelled'
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'partial', 'cancelled')),

  -- Metadata
  metadata TEXT,

  -- Timestamps
  uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Foreign keys
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES batch_tasks(id) ON DELETE CASCADE
);

-- 复制现有数据
INSERT INTO upload_records_new SELECT * FROM upload_records;

-- 删除旧表并重命名
DROP TABLE upload_records;
ALTER TABLE upload_records_new RENAME TO upload_records;

-- 重建索引
CREATE INDEX idx_upload_records_user_batch ON upload_records(user_id, batch_id);
CREATE INDEX idx_upload_records_user_uploaded ON upload_records(user_id, uploaded_at DESC);
CREATE INDEX idx_upload_records_batch ON upload_records(batch_id);

-- ✅ Migration complete!
-- 用户现在可以通过 POST /api/offers/batch/[batchId]/cancel 取消批量任务
