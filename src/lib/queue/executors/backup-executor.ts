/**
 * Backup 任务执行器
 *
 * 负责执行数据库备份任务，包括：
 * - SQLite数据库文件备份
 * - 自动清理旧备份文件
 * - 备份状态记录到数据库
 * - 失败重试机制
 *
 * 🔄 替换原有的定时调度器
 * 优势：支持并发控制、任务恢复、失败重试
 */

import type { Task, TaskExecutor } from '../types'
import { backupDatabase } from '@/lib/backup'

/**
 * Backup 任务数据接口
 */
export interface BackupTaskData {
  backupType: 'manual' | 'auto'
  createdBy?: number  // 用户ID（手动备份时）
  dbPath?: string     // 可选，自定义数据库路径
}

/**
 * Backup 任务结果接口
 */
export interface BackupTaskResult {
  success: boolean
  backupFilename?: string
  backupPath?: string
  fileSizeBytes?: number
  errorMessage?: string
  duration: number  // 备份耗时（毫秒）
}

/**
 * 创建 Backup 任务执行器
 */
export function createBackupExecutor(): TaskExecutor<BackupTaskData, BackupTaskResult> {
  return async (task: Task<BackupTaskData>) => {
    const { backupType, createdBy, dbPath } = task.data

    console.log(`💾 [BackupExecutor] 开始备份任务: 类型=${backupType}, 用户=${createdBy || 'system'}`)

    const startTime = Date.now()

    try {
      // 调用现有的备份服务
      const result = await backupDatabase(backupType, createdBy)

      const duration = Date.now() - startTime

      if (result.success) {
        console.log(`✅ [BackupExecutor] 备份任务完成: ${result.backupFilename}, 文件大小=${(result.fileSizeBytes! / 1024 / 1024).toFixed(2)}MB, 耗时=${duration}ms`)
      } else {
        console.error(`❌ [BackupExecutor] 备份任务失败: ${result.errorMessage}, 耗时=${duration}ms`)
      }

      return {
        success: result.success,
        backupFilename: result.backupFilename,
        backupPath: result.backupPath,
        fileSizeBytes: result.fileSizeBytes,
        errorMessage: result.errorMessage,
        duration
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`❌ [BackupExecutor] 备份任务异常: ${error.message}, 耗时=${duration}ms`)
      throw error
    }
  }
}
