-- ==========================================
-- Migration: 044_fix_offer_name_unique_constraint (PostgreSQL)
-- Purpose: 修复 offer_name 全局唯一约束为用户级别唯一
-- Issue: offer_name 当前是全局唯一，会导致不同用户创建同名 Offer 冲突
-- Solution: 改为 UNIQUE(user_id, offer_name) 组合唯一约束
-- ==========================================

-- Step 1: 删除现有的全局唯一约束
ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_offer_name_key;

-- Step 2: 添加用户级别唯一约束
ALTER TABLE offers ADD CONSTRAINT offers_user_offer_name_unique UNIQUE (user_id, offer_name);

-- 验证约束
-- \d offers
