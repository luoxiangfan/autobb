-- Migration: Add UNIQUE constraint to mcc_customer_id
-- Purpose: Ensure one MCC account can only be bound to one user
-- Created: 2026-04-30

-- SQLite 迁移
-- 注意：SQLite 不支持直接添加 UNIQUE 约束到现有列
-- 需要重建表或使用触发器

-- 方法 1: 使用触发器防止重复（推荐，兼容现有数据）
CREATE TRIGGER IF NOT EXISTS prevent_duplicate_mcc_assignment
BEFORE INSERT ON user_mcc_assignments
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM user_mcc_assignments WHERE mcc_customer_id = NEW.mcc_customer_id AND user_id != NEW.user_id)
    THEN RAISE(ABORT, 'MCC 账号已被其他用户绑定')
  END;
END;

-- 添加索引加速查找
CREATE INDEX IF NOT EXISTS idx_user_mcc_assignments_mcc_id ON user_mcc_assignments(mcc_customer_id);
