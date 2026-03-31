-- Migration: 20260306_offline_not_soft_delete
-- Date: 2026-03-06
-- Description: 确保历史下线(offline)的广告系列仅标记 REMOVED，而不被软删除

-- 对于通过 P1/P2 之前版本标记为 is_deleted=1 且 status='REMOVED' 且 removed_reason='offline' 的记录
-- 将其从软删除状态恢复为普通“已下线”记录（仅保留 REMOVED + removed_reason='offline'）

UPDATE campaigns
SET is_deleted = 0,
    deleted_at = NULL
WHERE status = 'REMOVED'
  AND is_deleted = 1
  AND (removed_reason = 'offline' OR removed_reason IS NULL);

