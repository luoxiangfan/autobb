/**
 * 查看表结构
 */

import postgres from 'postgres'

const DATABASE_URL = 'postgresql://postgres:kwscccxs@dbprovider.sg-members-1.clawcloudrun.com:32243/autoads'

async function main() {
  const sql = postgres(DATABASE_URL, {
    max: 2,
    connect_timeout: 10,
  })

  try {
    console.log('📋 Batch Tasks 表结构:')
    const batchCols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'batch_tasks'
      ORDER BY ordinal_position
    `
    batchCols.forEach((c) => {
      console.log(`  ${c.column_name}: ${c.data_type}`)
    })

    console.log('\n📋 Click Farm Tasks 表结构:')
    const clickCols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'click_farm_tasks'
      ORDER BY ordinal_position
    `
    clickCols.forEach((c) => {
      console.log(`  ${c.column_name}: ${c.data_type}`)
    })

    console.log('\n📋 URL Swap Tasks 表结构:')
    const urlCols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'url_swap_tasks'
      ORDER BY ordinal_position
    `
    urlCols.forEach((c) => {
      console.log(`  ${c.column_name}: ${c.data_type}`)
    })

  } finally {
    await sql.end()
  }
}

main().catch(console.error)
