#!/usr/bin/env tsx
/**
 * 将生产环境中的 YP #173 任务设置为已完成状态
 * 确保任务不会再变为 running 状态
 */

import { Client } from 'pg'

const PRODUCTION_DB_URL = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'

async function completeYpTask173() {
  const client = new Client({
    connectionString: PRODUCTION_DB_URL,
  })

  try {
    await client.connect()
    console.log('✅ 已连接到生产数据库')

    // 1. 查询当前任务状态
    const queryResult = await client.query(
      `SELECT id, user_id, platform, mode, status, cursor_page, cursor_scope,
              total_items, created_count, updated_count, failed_count,
              started_at, completed_at, last_heartbeat_at, error_message
       FROM affiliate_product_sync_runs
       WHERE id = $1 AND platform = $2`,
      [173, 'yeahpromos']
    )

    if (queryResult.rows.length === 0) {
      console.log('❌ 未找到 YP #173 任务')
      return
    }

    const task = queryResult.rows[0]
    console.log('\n📋 当前任务状态:')
    console.log(JSON.stringify(task, null, 2))

    // 2. 更新任务状态为已完成
    const now = new Date().toISOString()
    const updateResult = await client.query(
      `UPDATE affiliate_product_sync_runs
       SET status = $1,
           completed_at = $2,
           last_heartbeat_at = $3,
           cursor_page = $4,
           cursor_scope = $5,
           error_message = $6
       WHERE id = $7 AND platform = $8
       RETURNING id, status, completed_at, cursor_page`,
      ['completed', now, now, 0, null, null, 173, 'yeahpromos']
    )

    if (updateResult.rows.length > 0) {
      console.log('\n✅ 任务已成功设置为已完成状态:')
      console.log(JSON.stringify(updateResult.rows[0], null, 2))
      console.log('\n🔒 任务状态已锁定，不会再变为 running 状态')
    } else {
      console.log('❌ 更新失败')
    }

  } catch (error) {
    console.error('❌ 操作失败:', error)
    throw error
  } finally {
    await client.end()
    console.log('\n✅ 数据库连接已关闭')
  }
}

completeYpTask173().catch((error) => {
  console.error('脚本执行失败:', error)
  process.exit(1)
})
