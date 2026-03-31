-- ==========================================
-- 迁移脚本：创建backup_logs表
-- 日期：2025-11-18
-- 描述：创建数据库备份日志表，用于记录备份历史
-- ==========================================

-- 创建备份日志表
CREATE TABLE IF NOT EXISTS backup_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  backup_filename TEXT NOT NULL,
  backup_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'in_progress')),
  error_message TEXT,
  backup_type TEXT NOT NULL DEFAULT 'auto' CHECK(backup_type IN ('auto', 'manual')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 创建索引以提升查询性能
CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_logs_status ON backup_logs(status);
CREATE INDEX IF NOT EXISTS idx_backup_logs_type ON backup_logs(backup_type);

-- 表说明：
-- - backup_filename: 备份文件名（例如：autoads_backup_20251118_020000.db）
-- - backup_path: 备份文件完整路径
-- - file_size_bytes: 备份文件大小（字节）
-- - status: 备份状态（success/failed/in_progress）
-- - error_message: 失败时的错误信息
-- - backup_type: 备份类型（auto自动/manual手动）
-- - created_at: 备份创建时间
