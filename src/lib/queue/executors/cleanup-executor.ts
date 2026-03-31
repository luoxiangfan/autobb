/**
 * Cleanup 任务执行器
 *
 * 负责执行数据清理任务，包括：
 * - 清理过期的性能数据
 * - 清理过期的同步日志
 * - 清理过期的备份文件
 *
 * 🔄 迁移自 scheduler.ts 中的 cleanupOldDataTask()
 * 优势：支持并发控制、失败重试、清理进度追踪
 */

import type { Task, TaskExecutor } from '../types'
import { getDatabase } from '@/lib/db'
import { resolveBackupDir } from '@/lib/backup'
import fs from 'fs'
import path from 'path'

/**
 * Cleanup 任务数据接口
 */
export interface CleanupTaskData {
  cleanupType: 'daily' | 'manual'
  retentionDays?: number  // 数据保留天数，默认90天
  backupRetentionDays?: number  // 备份保留天数，默认7天
  targets?: Array<'performance' | 'sync_logs' | 'backups' | 'link_check_history'>
}

/**
 * Cleanup 任务结果接口
 */
export interface CleanupTaskResult {
  success: boolean
  deletedPerformanceRows: number
  deletedSyncLogs: number
  deletedBackupFiles: number
  deletedLinkCheckHistory: number
  errorMessage?: string
  duration: number  // 清理耗时（毫秒）
}

/**
 * 清理旧备份文件
 */
async function cleanupOldBackups(daysToKeep: number): Promise<number> {
  const backupDir = resolveBackupDir()

  if (!fs.existsSync(backupDir)) {
    return 0
  }

  const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000
  const files = fs.readdirSync(backupDir)

  let deletedCount = 0

  for (const file of files) {
    const filePath = path.join(backupDir, file)
    try {
      const stats = fs.statSync(filePath)

      if (stats.mtimeMs < cutoffTime) {
        fs.unlinkSync(filePath)
        deletedCount++
        console.log(`🗑️ [CleanupExecutor] 删除旧备份文件: ${file}`)
      }
    } catch (err) {
      console.error(`⚠️ [CleanupExecutor] 无法删除备份文件 ${file}:`, err)
    }
  }

  return deletedCount
}

/**
 * 创建 Cleanup 任务执行器
 */
export function createCleanupExecutor(): TaskExecutor<CleanupTaskData, CleanupTaskResult> {
  return async (task: Task<CleanupTaskData>) => {
    const {
      cleanupType,
      retentionDays = 90,
      backupRetentionDays = 7,
      targets = ['performance', 'sync_logs', 'backups', 'link_check_history']
    } = task.data

    console.log(`🗑️ [CleanupExecutor] 开始数据清理任务: 类型=${cleanupType}, 保留天数=${retentionDays}`)

    const startTime = Date.now()

    try {
      const db = await getDatabase()

      // 计算截止日期
      const cutoffDate = new Date()
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
      const cutoffDateStr = cutoffDate.toISOString().split('T')[0]

      let deletedPerformanceRows = 0
      let deletedSyncLogs = 0
      let deletedBackupFiles = 0
      let deletedLinkCheckHistory = 0

      // 清理campaign_performance表
      if (targets.includes('performance')) {
        const result = await db.exec(
          'DELETE FROM campaign_performance WHERE date < ?',
          [cutoffDateStr]
        )
        deletedPerformanceRows = result.changes || 0
        console.log(`   ✅ 删除 ${deletedPerformanceRows} 条性能数据`)
      }

      // 清理sync_logs表
      if (targets.includes('sync_logs')) {
        const result = await db.exec(
          'DELETE FROM sync_logs WHERE started_at < ?',
          [cutoffDateStr]
        )
        deletedSyncLogs = result.changes || 0
        console.log(`   ✅ 删除 ${deletedSyncLogs} 条同步日志`)
      }

      // 清理link_check_history表
      if (targets.includes('link_check_history')) {
        const result = await db.exec(
          'DELETE FROM link_check_history WHERE checked_at < ?',
          [cutoffDateStr]
        )
        deletedLinkCheckHistory = result.changes || 0
        console.log(`   ✅ 删除 ${deletedLinkCheckHistory} 条链接检查历史`)
      }

      // 清理旧备份文件
      if (targets.includes('backups')) {
        deletedBackupFiles = await cleanupOldBackups(backupRetentionDays)
        console.log(`   ✅ 删除 ${deletedBackupFiles} 个旧备份文件`)
      }

      const duration = Date.now() - startTime

      console.log(`✅ [CleanupExecutor] 数据清理完成: 性能数据=${deletedPerformanceRows}, 同步日志=${deletedSyncLogs}, 备份文件=${deletedBackupFiles}, 链接历史=${deletedLinkCheckHistory}, 耗时=${duration}ms`)

      return {
        success: true,
        deletedPerformanceRows,
        deletedSyncLogs,
        deletedBackupFiles,
        deletedLinkCheckHistory,
        duration
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`❌ [CleanupExecutor] 数据清理失败: ${error.message}, 耗时=${duration}ms`)

      return {
        success: false,
        deletedPerformanceRows: 0,
        deletedSyncLogs: 0,
        deletedBackupFiles: 0,
        deletedLinkCheckHistory: 0,
        errorMessage: error.message,
        duration
      }
    }
  }
}
