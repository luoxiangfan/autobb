/**
 * 批量创建广告系列任务执行器（从备份）
 *
 * 功能：
 * 1. 从备份列表批量创建广告系列
 * 2. 支持重新生成广告创意
 * 3. 实时更新进度到 batch_tasks 表
 * 4. 支持重试和错误处理
 *
 * 注意：
 * - 这是异步执行器，任务加入队列后立即返回
 * - 通过 batch_id 关联任务记录
 * - 支持 SSE 实时推送进度
 */

import type { Task } from '../types'
import { getDatabase } from '@/lib/db'
import { createCampaignFromBackup } from '@/lib/campaign-backups'
import { getInsertedId } from '@/lib/db-helpers'

/**
 * 批量创建广告系列任务数据接口
 */
export interface CampaignBatchCreateTaskData {
  batchId: string
  backupIds: number[]
  googleAdsAccountId?: number
  regenerateCreativeMap?: Record<number, boolean>
}

/**
 * 批量创建广告系列执行器
 */
export async function executeCampaignBatchCreate(
  task: Task<CampaignBatchCreateTaskData>
): Promise<void> {
  const { batchId, backupIds, googleAdsAccountId, regenerateCreativeMap } = task.data
  const db = await getDatabase()
  
  // PostgreSQL 兼容性
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  
  console.log(`🚀 开始执行批量创建广告系列：batch=${batchId}, count=${backupIds.length}`)

  try {
    // 1. 更新 batch_tasks 状态为 running
    await db.exec(`
      UPDATE batch_tasks
      SET status = 'running', started_at = ${nowFunc}, updated_at = ${nowFunc}
      WHERE id = ?
    `, [batchId])

    let completed = 0
    let failed = 0
    const errors: Array<{ backupId: number; error: string }> = []
    const createdCampaigns: Array<{ backupId: number; campaignId: number }> = []

    // 2. 逐个创建广告系列
    for (const backupId of backupIds) {
      try {
        // 获取备份信息
        const backup = await db.queryOne(`
          SELECT * FROM campaign_backups
          WHERE id = ? AND user_id = ?
        `, [backupId, task.userId]) as any

        if (!backup) {
          failed++
          errors.push({ backupId, error: '备份不存在或无权访问' })
          console.log(`⚠️ 跳过备份 ${backupId}: 不存在或无权访问`)
          continue
        }

        // 检查是否已有活跃广告系列（避免重复创建）
        const existingCampaign = await db.queryOne(`
          SELECT id FROM campaigns
          WHERE offer_id = ? AND user_id = ? AND is_deleted = 0
        `, [backup.offer_id, task.userId]) as { id: number } | undefined

        if (existingCampaign) {
          failed++
          errors.push({ backupId, error: '该 Offer 已有活跃广告系列' })
          console.log(`⚠️ 跳过备份 ${backupId}: Offer 已有活跃广告系列`)
          continue
        }

        // 确定是否重新生成广告创意
        const shouldRegenerate = regenerateCreativeMap?.[backupId] || false

        // 创建广告系列
        const result = await createCampaignFromBackup(
          backupId,
          task.userId,
          {
            googleAdsAccountId: googleAdsAccountId || backup.google_ads_account_id,
            createToGoogle: false, // 后台批量创建时不立即同步到 Google Ads
          }
        )

        createdCampaigns.push({ backupId, campaignId: result.campaignId })
        completed++
        
        console.log(`✅ 创建成功：backupId=${backupId}, campaignId=${result.campaignId}`)

        // 3. 更新进度
        await db.exec(`
          UPDATE batch_tasks
          SET completed_count = ?, failed_count = ?, updated_at = ${nowFunc}
          WHERE id = ?
        `, [completed, failed, batchId])

      } catch (error: any) {
        failed++
        errors.push({ backupId, error: error.message })
        console.error(`❌ 创建失败：backupId=${backupId}:`, error.message)
        
        // 更新进度（即使失败也要更新）
        await db.exec(`
          UPDATE batch_tasks
          SET failed_count = ?, updated_at = ${nowFunc}
          WHERE id = ?
        `, [failed, batchId])
      }
    }

    // 4. 确定最终状态
    let finalStatus: 'completed' | 'failed' | 'partial'
    if (failed === 0) {
      finalStatus = 'completed'
    } else if (completed === 0) {
      finalStatus = 'failed'
    } else {
      finalStatus = 'partial'
    }

    // 5. 更新最终状态和错误信息
    await db.exec(`
      UPDATE batch_tasks
      SET
        status = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc},
        metadata = ?
      WHERE id = ?
    `, [
      finalStatus,
      JSON.stringify({
        errors: errors.slice(0, 100), // 限制错误数量
        createdCampaigns,
      }),
      batchId
    ])

    console.log(
      `✅ 批量创建完成：batch=${batchId}, status=${finalStatus}, ` +
      `completed=${completed}, failed=${failed}, total=${backupIds.length}`
    )

  } catch (error: any) {
    console.error(`❌ 批量创建失败：batch=${batchId}:`, error.message)

    const nowFuncErr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    
    // 更新为失败状态
    await db.exec(`
      UPDATE batch_tasks
      SET 
        status = 'failed', 
        completed_at = ${nowFuncErr}, 
        updated_at = ${nowFuncErr},
        metadata = ?
      WHERE id = ?
    `, [
      JSON.stringify({ error: error.message, stack: error.stack }),
      batchId
    ])

    throw error
  }
}
