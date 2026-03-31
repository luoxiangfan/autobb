-- Migration: 121_auto_sync_batch_status
-- Description: 自动同步 batch_tasks 状态与子任务状态 (SQLite)
-- Created: 2025-12-29
-- Compatible: SQLite 3.30+

-- ============================================================================
-- 注意：SQLite 不支持触发器中的复杂逻辑（如动态统计），
--     因此我们使用应用层逻辑来同步状态。
--     这个迁移主要用于添加索引和必要的字段。
-- ============================================================================

-- ============================================================================
-- 1. 添加索引：如果不存在则添加
-- ============================================================================

-- 批量任务状态索引（如果还没有）
CREATE INDEX IF NOT EXISTS idx_batch_tasks_status ON batch_tasks(status);

-- 批量任务创建时间索引（用于查找旧任务）
CREATE INDEX IF NOT EXISTS idx_batch_tasks_created_at ON batch_tasks(created_at);

-- ============================================================================
-- 2. 同步所有 running 状态的 batch（清理历史数据）
-- ============================================================================

-- 首先同步那些所有子任务都已完成的 batch
UPDATE batch_tasks
SET
    status = CASE
        WHEN (
            SELECT COUNT(*) FROM offer_tasks WHERE batch_id = batch_tasks.id
        ) = (
            SELECT COUNT(*) FROM offer_tasks WHERE batch_id = batch_tasks.id AND status = 'completed'
        )
        THEN 'completed'
        WHEN (
            SELECT COUNT(*) FROM offer_tasks WHERE batch_id = batch_tasks.id AND status = 'failed'
        ) = (
            SELECT COUNT(*) FROM offer_tasks WHERE batch_id = batch_tasks.id
        )
        THEN 'failed'
        WHEN (
            SELECT COUNT(*) FROM offer_tasks WHERE batch_id = batch_tasks.id AND status IN ('completed', 'failed')
        ) = (
            SELECT COUNT(*) FROM offer_tasks WHERE batch_id = batch_tasks.id
        )
        THEN 'partial'
        ELSE status
    END,
    completed_at = CASE
        WHEN status != 'running' THEN datetime('now')
        ELSE completed_at
    END,
    updated_at = datetime('now')
WHERE status = 'running'
  AND NOT EXISTS (
      SELECT 1 FROM offer_tasks
      WHERE batch_id = batch_tasks.id AND status IN ('running', 'pending')
  );

-- ============================================================================
-- 3. 验证迁移结果
-- ============================================================================

-- 输出迁移结果
SELECT 'Migration 121 completed' as status;

-- 显示 batch_tasks 更新后的统计
SELECT
    status,
    COUNT(*) as count,
    CASE status
        WHEN 'running' THEN '⚠️ 需要检查'
        WHEN 'completed' THEN '✅ 正常完成'
        WHEN 'failed' THEN '❌ 全部失败'
        WHEN 'partial' THEN '⚡ 部分成功'
        WHEN 'cancelled' THEN '🚫 已取消'
        ELSE status
    END as description
FROM batch_tasks
GROUP BY status
ORDER BY status;

PRAGMA table_info(batch_tasks);
