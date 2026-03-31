/**
 * Migration 063: Add indexes to offer_tasks table for performance optimization
 *
 * 优化目标:
 * 1. updated_at索引: 加速SSE轮询中的updated_at比较查询
 * 2. status索引: 加速按状态过滤查询
 * 3. user_id + status复合索引: 优化用户任务列表查询
 *
 * 预期性能提升:
 * - 轮询查询速度提升 50-80%
 * - 任务列表查询速度提升 60-90%
 */

-- 1. updated_at索引: SSE轮询性能优化
-- 用于: SELECT * FROM offer_tasks WHERE id = ? 后的 updated_at 比较
CREATE INDEX IF NOT EXISTS idx_offer_tasks_updated_at
ON offer_tasks(updated_at DESC);

-- 2. status索引: 状态过滤查询优化
-- 用于: SELECT * FROM offer_tasks WHERE status = 'running'
CREATE INDEX IF NOT EXISTS idx_offer_tasks_status
ON offer_tasks(status);

-- 3. user_id + status复合索引: 用户任务列表查询优化
-- 用于: SELECT * FROM offer_tasks WHERE user_id = ? AND status = ?
CREATE INDEX IF NOT EXISTS idx_offer_tasks_user_status
ON offer_tasks(user_id, status);

-- 4. id + updated_at复合索引: SSE轮询专用优化
-- 用于: SELECT ... FROM offer_tasks WHERE id = ? ORDER BY updated_at DESC
CREATE INDEX IF NOT EXISTS idx_offer_tasks_id_updated
ON offer_tasks(id, updated_at DESC);
