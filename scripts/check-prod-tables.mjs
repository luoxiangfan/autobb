/**
 * 检查生产数据库表结构
 */

import postgres from 'postgres'

const DATABASE_URL = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'

async function main() {
  console.log('🔍 连接生产数据库...\n')

  const sql = postgres(DATABASE_URL, {
    max: 2,
    connect_timeout: 10,
  })

  try {
    // 1. 列出所有表
    console.log('1️⃣ 数据库表列表:')
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `
    tables.forEach((t) => {
      console.log(`  - ${t.table_name}`)
    })

    // 2. 检查是否有队列相关的表
    console.log('\n2️⃣ 队列相关表:')
    const queueTables = tables.filter((t) =>
      t.table_name.includes('queue') ||
      t.table_name.includes('task') ||
      t.table_name.includes('job')
    )
    if (queueTables.length > 0) {
      queueTables.forEach((t) => {
        console.log(`  - ${t.table_name}`)
      })
    } else {
      console.log('  未找到队列相关表')
    }

    // 3. 检查 system_settings 表
    console.log('\n3️⃣ System Settings:')
    const settings = await sql`
      SELECT category, key, value
      FROM system_settings
      WHERE category IN ('queue', 'worker', 'redis')
      ORDER BY category, key
    `
    settings.forEach((s) => {
      console.log(`  ${s.category}.${s.key}:`,
        s.value && s.value.length > 100 ? `${s.value.substring(0, 100)}...` : s.value
      )
    })

  } finally {
    await sql.end()
  }
}

main().catch(console.error)
