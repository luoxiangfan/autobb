import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '@/lib/queue/unified-queue-manager'
import { createHash } from 'crypto'

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
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const body = await request.json()
    const { 
      backupIds, 
      googleAdsAccountId,
      regenerateCreativeMap 
    } = body

    if (!backupIds || !Array.isArray(backupIds) || backupIds.length === 0) {
      return NextResponse.json(
        { error: '请选择至少一个备份' },
        { status: 400 }
      )
    }

    const db = await getDatabase()
    
    // 验证所有备份都存在且属于当前用户
    const placeholders = backupIds.map(() => '?').join(',')
    const validationQuery = `
      SELECT id FROM campaign_backups
      WHERE id IN (${placeholders}) AND user_id = ?
    `
    const validBackups = await db.query(validationQuery, [...backupIds, userId]) as Array<{ id: number }>
    const validBackupIds = new Set(validBackups.map(b => b.id))

    const invalidBackups = backupIds.filter(id => !validBackupIds.has(id))
    if (invalidBackups.length > 0) {
      return NextResponse.json(
        { error: `以下备份不存在或无权访问：${invalidBackups.join(', ')}` },
        { status: 400 }
      )
    }

    // 生成稳定的 batchId
    const batchId = createHash('sha256')
      .update(`campaign-batch:${userId}:${Date.now()}`)
      .digest('hex')
      .slice(0, 16)

    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 创建 batch_tasks 记录
    await db.exec(`
      INSERT INTO batch_tasks (
        id,
        user_id,
        task_type,
        status,
        total_count,
        created_at,
        updated_at
      ) VALUES (?, ?, 'campaign-batch-create', 'pending', ?, ${nowFunc}, ${nowFunc})
    `, [batchId, userId, backupIds.length])

    // 创建任务数据
    const taskData = {
      batchId,
      backupIds,
      googleAdsAccountId,
      regenerateCreativeMap,
    }

    // 加入队列
    const queue = getQueueManager()
    await queue.enqueue('campaign-batch-create', taskData, userId, {
      priority: 'normal',
      maxRetries: 3,
    })

    console.log(
      `✅ 批量创建任务已加入队列：batchId=${batchId}, userId=${userId}, count=${backupIds.length}`
    )

    return NextResponse.json({
      success: true,
      batchId,
      total_count: backupIds.length,
    })
  } catch (error: any) {
    console.error('批量创建任务失败:', error)
    return NextResponse.json(
      { error: error.message || '批量创建失败' },
      { status: 500 }
    )
  }
}
