/**
 * 批量从备份创建广告系列并发布到 Google Ads
 */

import type { Task } from '../types'
import { getDatabase } from '@/lib/db'
import { parseCampaignBackup } from '@/lib/campaign/server'
import {
  createCampaignRowFromBackup,
  enqueueCampaignPublishFromBackup,
  validateGoogleAdsAccountForRestore,
} from '@/lib/campaign/server'
import { BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE } from '@/lib/campaign/server'
import {
  abandonStalePendingCampaignsForOffers,
  getActiveCampaignConflictsForOffers,
  rollbackPendingCampaignAfterEnqueueFailure,
} from '@/lib/campaign/server'

export interface CampaignBatchCreateTaskData {
  batchId: string
  backupIds: number[]
  googleAdsAccountId?: number
  regenerateCreativeMap?: Record<number, boolean>
}

export async function executeCampaignBatchCreate(
  task: Task<CampaignBatchCreateTaskData>
): Promise<void> {
  const { batchId, backupIds, googleAdsAccountId, regenerateCreativeMap } = task.data
  const db = await getDatabase()
  const nowFunc = 'NOW()'

  console.log(`🚀 开始执行批量创建广告系列：batch=${batchId}, count=${backupIds.length}`)

  if (!googleAdsAccountId) {
    throw new Error('批量创建需要指定 googleAdsAccountId')
  }

  const accountCheck = await validateGoogleAdsAccountForRestore(db, googleAdsAccountId, task.userId)
  if (!accountCheck.ok) {
    throw new Error(accountCheck.message)
  }

  try {
    await db.exec(
      `
      UPDATE batch_tasks
      SET status = 'running', started_at = ${nowFunc}, updated_at = ${nowFunc}
      WHERE id = ?
    `,
      [batchId]
    )

    let completed = 0
    let failed = 0
    const errors: Array<{ backupId: number; error: string }> = []
    const warnings: Array<{ backupId: number; message: string }> = []
    const createdCampaigns: Array<{ backupId: number; campaignId: number }> = []

    const backupPlaceholders = backupIds.map(() => '?').join(',')
    const backupRows = (await db.query(
      `
      SELECT * FROM campaign_backups
      WHERE id IN (${backupPlaceholders}) AND user_id = ?
    `,
      [...backupIds, task.userId]
    )) as Array<Record<string, unknown>>

    const backupById = new Map<number, ReturnType<typeof parseCampaignBackup>>()
    for (const row of backupRows) {
      backupById.set(Number(row.id), parseCampaignBackup(row))
    }

    const uniqueOfferIds = [...new Set([...backupById.values()].map((b) => b.offerId))]
    await abandonStalePendingCampaignsForOffers(uniqueOfferIds, task.userId)
    const initialConflicts = await getActiveCampaignConflictsForOffers(uniqueOfferIds, task.userId)
    const blockedOfferIds = new Set(initialConflicts.keys())

    for (const backupId of backupIds) {
      let pendingCampaignId: number | undefined
      let pendingOfferId: number | undefined

      try {
        const backup = backupById.get(backupId)

        if (!backup) {
          failed++
          errors.push({ backupId, error: '备份不存在或无权访问' })
          continue
        }

        pendingOfferId = backup.offerId

        if (blockedOfferIds.has(backup.offerId)) {
          failed++
          errors.push({
            backupId,
            error: BACKUP_CREATE_BLOCKED_BY_ACTIVE_CAMPAIGN_MESSAGE,
          })
          await db.exec(
            `UPDATE batch_tasks SET failed_count = ?, updated_at = ${nowFunc} WHERE id = ?`,
            [failed, batchId]
          )
          continue
        }

        const dbDetail = await createCampaignRowFromBackup({
          backup,
          userId: task.userId,
          googleAdsAccountId,
          db,
          skipOccupancyPrecheck: true,
        })

        if (!dbDetail.campaignId) {
          failed++
          errors.push({ backupId, error: dbDetail.error || '数据库创建失败' })
          await db.exec(
            `UPDATE batch_tasks SET failed_count = ?, updated_at = ${nowFunc} WHERE id = ?`,
            [failed, batchId]
          )
          continue
        }

        blockedOfferIds.add(backup.offerId)
        pendingCampaignId = dbDetail.campaignId

        const publishDetail = await enqueueCampaignPublishFromBackup({
          backup,
          campaignId: dbDetail.campaignId,
          userId: task.userId,
          googleAdsAccountId,
          db,
          regenerateCreative: regenerateCreativeMap?.[backupId] === true,
        })

        if (publishDetail.error) {
          failed++
          errors.push({ backupId, error: publishDetail.error })
          await rollbackPendingCampaignAfterEnqueueFailure({
            campaignId: dbDetail.campaignId,
            offerId: backup.offerId,
            userId: task.userId,
            reason: publishDetail.error,
          })
          pendingCampaignId = undefined
        } else {
          completed++
          createdCampaigns.push({ backupId, campaignId: dbDetail.campaignId })
          pendingCampaignId = undefined
          if (publishDetail.warning) {
            warnings.push({ backupId, message: publishDetail.warning })
          }
          console.log(`✅ 创建并入队发布：backupId=${backupId}, campaignId=${dbDetail.campaignId}`)
        }

        await db.exec(
          `
          UPDATE batch_tasks
          SET completed_count = ?, failed_count = ?, updated_at = ${nowFunc}
          WHERE id = ?
        `,
          [completed, failed, batchId]
        )
      } catch (error: any) {
        if (pendingCampaignId && pendingOfferId) {
          await rollbackPendingCampaignAfterEnqueueFailure({
            campaignId: pendingCampaignId,
            offerId: pendingOfferId,
            userId: task.userId,
            reason: error?.message || '批量创建发生意外错误',
          })
        }
        failed++
        errors.push({ backupId, error: error.message })
        console.error(`❌ 创建失败：backupId=${backupId}:`, error.message)
        await db.exec(
          `UPDATE batch_tasks SET failed_count = ?, updated_at = ${nowFunc} WHERE id = ?`,
          [failed, batchId]
        )
      }
    }

    let finalStatus: 'completed' | 'failed' | 'partial'
    if (failed === 0) {
      finalStatus = 'completed'
    } else if (completed === 0) {
      finalStatus = 'failed'
    } else {
      finalStatus = 'partial'
    }

    await db.exec(
      `
      UPDATE batch_tasks
      SET
        status = ?,
        completed_at = ${nowFunc},
        updated_at = ${nowFunc},
        metadata = ?
      WHERE id = ?
    `,
      [
        finalStatus,
        JSON.stringify({
          errors: errors.slice(0, 100),
          warnings: warnings.slice(0, 100),
          createdCampaigns,
        }),
        batchId,
      ]
    )

    console.log(
      `✅ 批量创建完成：batch=${batchId}, status=${finalStatus}, ` +
        `completed=${completed}, failed=${failed}, total=${backupIds.length}`
    )
  } catch (error: any) {
    console.error(`❌ 批量创建失败：batch=${batchId}:`, error.message)
    const nowFuncErr = 'NOW()'
    await db.exec(
      `
      UPDATE batch_tasks
      SET
        status = 'failed',
        completed_at = ${nowFuncErr},
        updated_at = ${nowFuncErr},
        metadata = ?
      WHERE id = ?
    `,
      [JSON.stringify({ error: error.message, stack: error.stack }), batchId]
    )
    throw error
  }
}
