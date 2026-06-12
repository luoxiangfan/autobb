#!/usr/bin/env tsx
/**
 * PostgreSQL schema validation (requires DATABASE_URL).
 */

import 'dotenv/config'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (
    !databaseUrl ||
    (!databaseUrl.startsWith('postgres://') && !databaseUrl.startsWith('postgresql://'))
  ) {
    console.log('⚠️  DATABASE_URL 未配置，跳过 PostgreSQL schema 校验')
    process.exit(0)
  }

  const postgres = (await import('postgres')).default
  const sql = postgres(databaseUrl)

  try {
    const tables = await sql<{ count: string }[]>`
      SELECT COUNT(*)::text AS count
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `
    const tableCount = Number(tables[0]?.count ?? 0)
    console.log(`✅ PostgreSQL 连接成功，public 表数量: ${tableCount}`)

    const critical = ['users', 'offers', 'campaigns', 'system_settings']
    for (const name of critical) {
      const row = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ${name}
        ) AS exists
      `
      if (!row[0]?.exists) {
        console.error(`❌ 缺少关键表: ${name}`)
        process.exit(1)
      }
    }
    console.log('✅ 关键表检查通过')
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error('❌ Schema 校验失败:', error)
  process.exit(1)
})
