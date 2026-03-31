-- Migration: 134_fix_url_swap_offer_unique_soft_delete
-- Description: 修复url_swap_tasks的offer_id唯一约束与软删除/完成态冲突
-- PostgreSQL版本
--
-- 背景：
-- - 现有 uq_url_swap_offer UNIQUE(offer_id) 会导致：任务软删除后仍无法为同一Offer重新创建任务
-- - 同时也会导致：任务状态变为 completed 后，hasUrlSwapTask 允许创建但数据库仍会因唯一约束报错
--
-- 目标：
-- - 仅对“未删除且未完成”的任务保持 offer_id 唯一性
-- - 允许已删除/已完成任务存在历史记录，同时可重新创建新任务

-- 1) 删除旧的唯一约束（会同时删除底层唯一索引）
ALTER TABLE url_swap_tasks DROP CONSTRAINT IF EXISTS uq_url_swap_offer;

-- 2) 兜底：如果还有同名唯一索引，显式删除（不同环境可能出现）
DROP INDEX IF EXISTS uq_url_swap_offer;

-- 3) 创建部分唯一索引：仅约束未删除且未完成的记录
CREATE UNIQUE INDEX IF NOT EXISTS uq_url_swap_offer_active
  ON url_swap_tasks (offer_id)
  WHERE is_deleted = FALSE AND status <> 'completed';

