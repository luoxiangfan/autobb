#!/usr/bin/env tsx
/**
 * 检查生产/测试环境数据库中的任务状态
 *
 * 使用方法：
 *   DATABASE_URL='postgresql://<user>:<password>@<host>:<port>/<db>' tsx scripts/check-db-tasks.ts
 */

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 环境变量未设置')
  process.exit(1)
}

async function main() {
  console.log('🔍 检查数据库任务状态\n')

  const sql = postgres(DATABASE_URL)

  try {
    // 检查 offer_tasks 表
    console.log('📊 offer_tasks 任务统计:')
    const offerStats = await sql`
      SELECT status, COUNT(*) as count
      FROM offer_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    for (const row of offerStats) {
      console.log(`  ${row.status}: ${row.count}`)
    }

    // 显示运行中的任务
    console.log('\n🔄 运行中的 offer_tasks:')
    const runningOfferTasks = await sql`
      SELECT id, user_id, status, stage, message, progress, created_at, started_at
      FROM offer_tasks
      WHERE status = 'running'
      ORDER BY started_at DESC
    `
    console.log(`  找到 ${runningOfferTasks.length} 个运行中的任务`)
    for (const task of runningOfferTasks) {
      console.log(`\n  任务 ID: ${task.id}`)
      console.log(`    用户: ${task.user_id}`)
      console.log(`    阶段: ${task.stage}`)
      console.log(`    进度: ${task.progress}%`)
      console.log(`    消息: ${task.message}`)
      console.log(`    创建时间: ${task.created_at}`)
      console.log(`    开始时间: ${task.started_at}`)
    }

    // 检查 batch_tasks 表
    console.log('\n📊 batch_tasks 任务统计:')
    const batchStats = await sql`
      SELECT status, COUNT(*) as count
      FROM batch_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    for (const row of batchStats) {
      console.log(`  ${row.status}: ${row.count}`)
    }

    // 显示运行中的批量任务
    console.log('\n🔄 运行中的 batch_tasks:')
    const runningBatchTasks = await sql`
      SELECT id, user_id, status, total_count, completed_count, failed_count, created_at, started_at
      FROM batch_tasks
      WHERE status = 'running'
      ORDER BY started_at DESC
    `
    console.log(`  找到 ${runningBatchTasks.length} 个运行中的批量任务`)
    for (const batch of runningBatchTasks) {
      console.log(`\n  批量任务 ID: ${batch.id}`)
      console.log(`    用户: ${batch.user_id}`)
      console.log(`    总数: ${batch.total_count}`)
      console.log(`    已完成: ${batch.completed_count}`)
      console.log(`    失败: ${batch.failed_count}`)
      console.log(`    创建时间: ${batch.created_at}`)
      console.log(`    开始时间: ${batch.started_at}`)
    }

  } catch (error) {
    console.error('❌ 查询失败:', error)
  } finally {
    await sql.end()
  }
}

main().catch(console.error)

