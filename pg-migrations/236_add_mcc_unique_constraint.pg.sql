-- Migration: Add UNIQUE constraint to mcc_customer_id (PostgreSQL)
-- Purpose: Ensure one MCC account can only be bound to one user
-- Created: 2026-04-30

-- PostgreSQL 迁移
-- 首先删除可能存在的重复数据（保留每个 MCC 的第一条记录）
DELETE FROM user_mcc_assignments
WHERE id NOT IN (
  SELECT MIN(id)
  FROM user_mcc_assignments
  GROUP BY mcc_customer_id
);

-- 添加 UNIQUE 约束到 mcc_customer_id 列
ALTER TABLE user_mcc_assignments
ADD CONSTRAINT unique_mcc_customer_id UNIQUE (mcc_customer_id);

-- 添加索引加速查找
CREATE INDEX IF NOT EXISTS idx_user_mcc_assignments_mcc_id ON user_mcc_assignments(mcc_customer_id);
