-- Migration: Create user_mcc_assignments table
-- Purpose: Allow admins to assign MCC accounts to users
-- Created: 2026-04-23

-- SQLite 迁移
CREATE TABLE IF NOT EXISTS user_mcc_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mcc_customer_id TEXT NOT NULL,  -- MCC 账号的 customer_id
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by INTEGER,  -- 分配的管理员 ID
  UNIQUE(user_id, mcc_customer_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 添加索引加速查询
CREATE INDEX IF NOT EXISTS idx_user_mcc_assignments_user_id ON user_mcc_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_mcc_assignments_mcc_id ON user_mcc_assignments(mcc_customer_id);
