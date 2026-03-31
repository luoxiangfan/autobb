/**
 * 检查生产环境任务队列状态
 */

import postgres from 'postgres'

const DATABASE_URL = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'

async function main() {
  console.log('🔍 检查生产环境任务队列状态...\n')

  const sql = postgres(DATABASE_URL, {
    max: 2,
    connect_timeout: 10,
  })

  try {
    // 1. 检查 batch_tasks
    console.log('1️⃣ Batch Tasks:')
    const batchStats = await sql`
      SELECT status, COUNT(*) as count
      FROM batch_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    batchStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    const batchPending = await sql`
      SELECT id, type, status, created_at, updated_at
      FROM batch_tasks
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `
    if (batchPending.length > 0) {
      console.log('  最近 pending:')
      batchPending.forEach((t) => {
        console.log(`    [${t.id}] ${t.type} - 创建于 ${t.created_at}`)
      })
    }

    // 2. 检查 click_farm_tasks
    console.log('\n2️⃣ Click Farm Tasks:')
    const clickFarmStats = await sql`
      SELECT status, COUNT(*) as count
      FROM click_farm_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    clickFarmStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    const clickFarmPending = await sql`
      SELECT id, task_type, status, created_at, updated_at
      FROM click_farm_tasks
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `
    if (clickFarmPending.length > 0) {
      console.log('  最近 pending:')
      clickFarmPending.forEach((t) => {
        console.log(`    [${t.id}] ${t.task_type} - 创建于 ${t.created_at}`)
      })
    }

    // 3. 检查 url_swap_tasks
    console.log('\n3️⃣ URL Swap Tasks:')
    const urlSwapStats = await sql`
      SELECT status, COUNT(*) as count
      FROM url_swap_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    urlSwapStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    const urlSwapPending = await sql`
      SELECT id, status, created_at, updated_at
      FROM url_swap_tasks
      WHERE status = 'pending'
      ORDER BY created_at DESC
      LIMIT 10
    `
    if (urlSwapPending.length > 0) {
      console.log('  最近 pending:')
      urlSwapPending.forEach((t) => {
        console.log(`    [${t.id}] 创建于 ${t.created_at}`)
      })
    }

    // 4. 检查 creative_tasks
    console.log('\n4️⃣ Creative Tasks:')
    const creativeStats = await sql`
      SELECT status, COUNT(*) as count
      FROM creative_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    creativeStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    // 5. 检查 offer_tasks
    console.log('\n5️⃣ Offer Tasks:')
    const offerStats = await sql`
      SELECT status, COUNT(*) as count
      FROM offer_tasks
      GROUP BY status
      ORDER BY count DESC
    `
    offerStats.forEach((s) => {
      console.log(`  ${s.status}: ${s.count}`)
    })

    // 6. 检查最近的活动
    console.log('\n6️⃣ 最近完成的任务 (batch_tasks):')
    const recentCompleted = await sql`
      SELECT id, type, status, created_at, updated_at
      FROM batch_tasks
      WHERE status = 'completed'
      ORDER BY updated_at DESC
      LIMIT 5
    `
    recentCompleted.forEach((t) => {
      const duration = new Date(t.updated_at).getTime() - new Date(t.created_at).getTime()
      console.log(`  [${t.id}] ${t.type} - 完成于 ${t.updated_at} (耗时 ${Math.round(duration/1000)}s)`)
    })

    // 7. 检查失败的任务
    console.log('\n7️⃣ 最近失败的任务 (batch_tasks):')
    const recentFailed = await sql`
      SELECT id, type, status, error, created_at, updated_at
      FROM batch_tasks
      WHERE status = 'failed'
      ORDER BY updated_at DESC
      LIMIT 5
    `
    recentFailed.forEach((t) => {
      console.log(`  [${t.id}] ${t.type} - 失败于 ${t.updated_at}`)
      if (t.error) {
        const errorMsg = typeof t.error === 'string' ? t.error : JSON.stringify(t.error)
        console.log(`    错误: ${errorMsg.substring(0, 100)}`)
      }
    })

  } finally {
    await sql.end()
  }
}

main().catch(console.error)
