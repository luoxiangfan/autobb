import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue'
import { validateCampaignBackupsForBatchCreate } from '@/lib/campaign/server'
import { createHash } from 'crypto'

const MAX_BATCH_BACKUP_COUNT = 50

/**
 * POST /api/campaign-backups/batch-create
 * 批量从备份创建广告系列（异步队列）
 *
 * 请求体：
 * {
 *   backupIds: number[]
 *   googleAdsAccountId?: number
 *   regenerateCreativeMap?: Record<number, boolean>
 * }
 *
 * 响应：
 * {
 *   success: true
 *   batchId: string
 *   total_count: number
 * }
 */
export const POST = withAuth(async (request, user) => {
  try {
    const userId = user.userId
    const body = await request.json()
    const { backupIds, googleAdsAccountId, regenerateCreativeMap } = body

    if (!backupIds || !Array.isArray(backupIds) || backupIds.length === 0) {
      return NextResponse.json({ error: '请选择至少一个备份' }, { status: 400 })
    }

    const numericBackupIds: number[] = []
    for (const id of backupIds) {
      const parsed = Number(id)
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return NextResponse.json({ error: '备份 ID 无效' }, { status: 400 })
      }
      numericBackupIds.push(parsed)
    }
    const uniqueBackupIds = [...new Set(numericBackupIds)]

    if (uniqueBackupIds.length > MAX_BATCH_BACKUP_COUNT) {
      return NextResponse.json(
        { error: `单次最多批量创建 ${MAX_BATCH_BACKUP_COUNT} 个备份` },
        { status: 400 }
      )
    }

    if (!googleAdsAccountId) {
      return NextResponse.json({ error: '请选择 Google Ads 账号' }, { status: 400 })
    }

    const db = await getDatabase()

    // 验证所有备份都存在且属于当前用户
    const placeholders = uniqueBackupIds.map(() => '?').join(',')
    const validationQuery = `
      SELECT id FROM campaign_backups
      WHERE id IN (${placeholders}) AND user_id = ?
    `
    const validBackups = (await db.query(validationQuery, [...uniqueBackupIds, userId])) as Array<{
      id: number
    }>
    const validBackupIds = new Set(validBackups.map((b) => b.id))

    const invalidBackups = uniqueBackupIds.filter((id) => !validBackupIds.has(id))
    if (invalidBackups.length > 0) {
      return NextResponse.json(
        { error: `以下备份不存在或无权访问：${invalidBackups.join(', ')}` },
        { status: 400 }
      )
    }

    const batchValidation = await validateCampaignBackupsForBatchCreate(
      uniqueBackupIds,
      userId,
      Number(googleAdsAccountId)
    )
    if (!batchValidation.ok) {
      return NextResponse.json({ error: batchValidation.error }, { status: 400 })
    }

    // 生成稳定的 batchId
    const batchId = createHash('sha256')
      .update(`campaign-batch:${userId}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const nowFunc = 'NOW()'

    // 创建 batch_tasks 记录
    await db.exec(
      `
      INSERT INTO batch_tasks (
        id,
        user_id,
        task_type,
        status,
        total_count,
        created_at,
        updated_at
      ) VALUES (?, ?, 'campaign-batch-create', 'pending', ?, ${nowFunc}, ${nowFunc})
    `,
      [batchId, userId, uniqueBackupIds.length]
    )

    // 创建任务数据
    const taskData = {
      batchId,
      backupIds: uniqueBackupIds,
      googleAdsAccountId,
      regenerateCreativeMap,
    }

    try {
      const queue = getQueueManager()
      await queue.enqueue('campaign-batch-create', taskData, userId, {
        priority: 'normal',
        maxRetries: 3,
      })
    } catch (enqueueError: any) {
      await db.exec(
        `
        UPDATE batch_tasks
        SET status = 'failed', updated_at = ${nowFunc},
            metadata = ?
        WHERE id = ?
      `,
        [
          JSON.stringify({
            error: enqueueError?.message || '任务入队失败',
          }),
          batchId,
        ]
      )
      throw enqueueError
    }

    console.log(
      `✅ 批量创建任务已加入队列：batchId=${batchId}, userId=${userId}, count=${uniqueBackupIds.length}`
    )

    return NextResponse.json({
      success: true,
      batchId,
      total_count: uniqueBackupIds.length,
    })
  } catch (error: any) {
    console.error('批量创建任务失败:', error)
    return NextResponse.json({ error: error.message || '批量创建失败' }, { status: 500 })
  }
})
