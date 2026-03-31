/**
 * 批量Offer创建任务执行器
 *
 * 功能：
 * 1. 解析CSV行数据
 * 2. 为每行创建一个offer_task (关联batch_id)
 * 3. 将所有offer_tasks加入队列
 * 4. 监控子任务完成情况，更新batch_tasks进度
 *
 * 注意：
 * - 这是一个协调器任务，本身不执行提取逻辑
 * - 真正的提取由offer-extraction executor执行
 * - 通过batch_id关联父子任务
 */

import type { Task } from '../types'
import { createHash } from 'crypto'
import { getDatabase } from '@/lib/db'
import { getQueueManager } from '../unified-queue-manager'
import type { OfferExtractionTaskData } from './offer-extraction-executor'

/**
 * 批量创建任务数据接口
 */
export interface BatchCreationTaskData {
  batchId: string
  rows: Array<{
    affiliate_link: string
    target_country: string
    brand_name?: string
    product_price?: string
    commission_payout?: string
    commission_type?: 'percent' | 'amount'
    commission_value?: string
    commission_currency?: string
    page_type?: 'store' | 'product'
    store_product_links?: string[]
  }>
}

/**
 * 生成稳定的子任务ID（同一batch同一行在重试时保持一致）
 * 这样父任务重试不会重复创建新的 offer_tasks 记录。
 */
function buildBatchChildTaskId(batchId: string, rowIndex: number): string {
  const digest = createHash('sha256')
    .update(`${batchId}:${rowIndex}`)
    .digest('hex')

  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`
}

/**
 * 批量Offer创建执行器
 */
export async function executeBatchCreation(
  task: Task<BatchCreationTaskData>
): Promise<void> {
  const { batchId, rows } = task.data
  const db = getDatabase()
  const queue = getQueueManager()

  // 🔧 PostgreSQL兼容性：根据数据库类型选择NOW函数
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  console.log(`🚀 开始执行批量创建任务: batch=${batchId}, count=${rows.length}`)

  try {
    // 1. 更新batch_tasks和upload_records状态为running
    await db.exec(`
      UPDATE batch_tasks
      SET status = 'running', started_at = ${nowFunc}, updated_at = ${nowFunc}
      WHERE id = ?
    `, [batchId])

    await db.exec(`
      UPDATE upload_records
      SET status = 'processing', updated_at = ${nowFunc}
      WHERE batch_id = ?
    `, [batchId])

    // 2. 为每行数据创建offer_task并加入队列（幂等）
    const childTaskIds: string[] = []
    let createdTaskCount = 0
    let reusedTaskCount = 0
    let enqueuedTaskCount = 0

    const existingTasks = await db.query<{ id: string; status: string }>(`
      SELECT id, status
      FROM offer_tasks
      WHERE batch_id = ?
    `, [batchId])
    const existingTaskStatus = new Map(existingTasks.map((t) => [t.id, t.status]))

    for (const [rowIndex, row] of rows.entries()) {
      // 使用稳定ID避免重试时重复创建子任务
      const childTaskId = buildBatchChildTaskId(batchId, rowIndex)
      const currentStatus = existingTaskStatus.get(childTaskId)

      if (!currentStatus) {
        // 仅在不存在时插入，避免父任务重试导致重复子任务
        await db.exec(`
          INSERT INTO offer_tasks (
            id,
            user_id,
            batch_id,
            status,
            affiliate_link,
            target_country,
            page_type,
            store_product_links,
            brand_name,
            product_price,
            commission_payout,
            skip_cache,
            skip_warmup,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, false, false, ${nowFunc}, ${nowFunc})
        `, [
          childTaskId,
          task.userId,
          batchId,
          row.affiliate_link,
          row.target_country,
          row.page_type || null,
          row.store_product_links && row.store_product_links.length > 0
            ? JSON.stringify(row.store_product_links)
            : null,
          row.brand_name || null,
          row.product_price || null,
          row.commission_payout || null,
        ])
        existingTaskStatus.set(childTaskId, 'pending')
        createdTaskCount++
      } else {
        reusedTaskCount++
      }

      const taskData: OfferExtractionTaskData = {
        affiliateLink: row.affiliate_link,
        targetCountry: row.target_country,
        skipCache: false,
        skipWarmup: false,
        // 🔥 修复（2025-12-08）：传递产品价格和佣金比例，用于创建Offer记录
        productPrice: row.product_price,
        commissionPayout: row.commission_payout,
        commissionType: row.commission_type,
        commissionValue: row.commission_value,
        commissionCurrency: row.commission_currency,
        brandName: row.brand_name,
        pageType: row.page_type,
        storeProductLinks: row.store_product_links,
      }

      const statusForEnqueue = existingTaskStatus.get(childTaskId)
      const shouldEnqueue = !statusForEnqueue || statusForEnqueue === 'pending' || statusForEnqueue === 'failed'
      if (shouldEnqueue) {
        await queue.enqueue(
          'offer-extraction',
          taskData,
          task.userId,
          {
            priority: 'normal',
            requireProxy: true,
            maxRetries: 2,
            taskId: childTaskId  // 关键：传递预定义的taskId，确保队列任务ID与offer_tasks记录ID一致
          }
        )
        enqueuedTaskCount++
      } else {
        console.log(`⏭️ 跳过重复入队: childTask=${childTaskId}, status=${statusForEnqueue}`)
      }

      childTaskIds.push(childTaskId)
    }

    console.log(
      `✅ 批量任务子任务准备完成: total=${childTaskIds.length}, created=${createdTaskCount}, reused=${reusedTaskCount}, enqueued=${enqueuedTaskCount}`
    )

    // 3. 启动监控循环（检查子任务完成情况）
    const monitorInterval = setInterval(async () => {
      try {
        // 查询子任务统计
        const stats = await db.query<{
          status: string
          count: number
        }>(`
          SELECT status, COUNT(*) as count
          FROM offer_tasks
          WHERE batch_id = ?
          GROUP BY status
        `, [batchId])

        const statsMap: Record<string, number> = {}
        for (const row of stats) {
          statsMap[row.status] = row.count
        }

        const completed = statsMap['completed'] || 0
        const failed = statsMap['failed'] || 0
        const total = rows.length

        // 更新batch_tasks和upload_records进度
        await db.exec(`
          UPDATE batch_tasks
          SET
            completed_count = ?,
            failed_count = ?,
            updated_at = ${nowFunc}
          WHERE id = ?
        `, [completed, failed, batchId])

        await db.exec(`
          UPDATE upload_records
          SET
            processed_count = ?,
            failed_count = ?,
            updated_at = ${nowFunc}
          WHERE batch_id = ?
        `, [completed, failed, batchId])

        // 检查是否全部完成
        if (completed + failed >= total) {
          clearInterval(monitorInterval)

          // 确定最终状态
          let finalStatus: 'completed' | 'failed' | 'partial'
          if (failed === 0) {
            finalStatus = 'completed'
          } else if (completed === 0) {
            finalStatus = 'failed'
          } else {
            finalStatus = 'partial'
          }

          // 更新batch_tasks和upload_records最终状态
          await db.exec(`
            UPDATE batch_tasks
            SET
              status = ?,
              completed_at = ${nowFunc},
              updated_at = ${nowFunc}
            WHERE id = ?
          `, [finalStatus, batchId])

          await db.exec(`
            UPDATE upload_records
            SET
              status = ?,
              completed_at = ${nowFunc},
              updated_at = ${nowFunc}
            WHERE batch_id = ?
          `, [finalStatus, batchId])

          console.log(`✅ 批量任务完成: batch=${batchId}, status=${finalStatus}, completed=${completed}, failed=${failed}`)
        }
      } catch (error: any) {
        console.error('❌ 批量任务监控错误:', error)
        clearInterval(monitorInterval)
      }
    }, 2000) // 每2秒检查一次

    // 超时保护：10分钟后自动停止监控（正常情况下子任务会更早完成）
    setTimeout(() => {
      clearInterval(monitorInterval)
      console.log(`⏱️ 批量任务监控超时: batch=${batchId}`)
    }, 600000)

  } catch (error: any) {
    console.error(`❌ 批量创建任务失败: batch=${batchId}:`, error.message)

    // 🔧 PostgreSQL兼容性：在catch块中也需要使用正确的NOW函数
    const nowFuncErr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 更新batch_tasks和upload_records为失败状态
    await db.exec(`
      UPDATE batch_tasks
      SET
        status = 'failed',
        completed_at = ${nowFuncErr},
        updated_at = ${nowFuncErr}
      WHERE id = ?
    `, [batchId])

    await db.exec(`
      UPDATE upload_records
      SET
        status = 'failed',
        completed_at = ${nowFuncErr},
        updated_at = ${nowFuncErr}
      WHERE batch_id = ?
    `, [batchId])

    throw error
  }
}
