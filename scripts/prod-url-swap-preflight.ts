#!/usr/bin/env tsx
/**
 * 生产环境 URL Swap 预检（默认只读）
 *
 * 用法：
 *   DATABASE_URL='postgresql://...' tsx scripts/prod-url-swap-preflight.ts
 *
 * 可选：
 *   --task-id <uuid>        查看指定任务概要（不输出敏感token）
 *   --apply-134             执行 134_fix_url_swap_offer_unique_soft_delete（会写库，谨慎；迁移文件在 pg-migrations/ 或 pg-migrations/archive/v2/）
 *
 * 注意：
 * - 不会打印 DATABASE_URL
 * - 默认只读；只有传 --apply-134 才会执行写操作
 */

import fs from 'fs'
import path from 'path'

type Args = {
  taskId?: string
  apply134: boolean
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply134: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--task-id') {
      const value = argv[i + 1]
      if (!value) throw new Error('--task-id 需要一个值')
      args.taskId = value
      i++
      continue
    }
    if (a === '--apply-134') {
      args.apply134 = true
      continue
    }
  }
  return args
}

async function main() {
  const { taskId, apply134 } = parseArgs(process.argv.slice(2))

  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      '缺少 DATABASE_URL 环境变量（建议在你本机终端 export 后再运行本脚本；不要把链接写进命令或提交到仓库）。'
    )
  }

  const postgres = (await import('postgres')).default
  const sql = postgres(databaseUrl, {
    // 预检脚本：尽量减少长连接占用
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
  })

  const now = new Date().toISOString()
  console.log(`\n🔎 URL Swap 生产预检 @ ${now}`)

  try {
    const dbInfo = await sql<{ current_database: string; current_user: string; version: string }[]>`
      SELECT
        current_database() AS current_database,
        current_user AS current_user,
        version() AS version
    `
    console.log(`- database: ${dbInfo[0]?.current_database ?? 'unknown'}`)
    console.log(`- user: ${dbInfo[0]?.current_user ?? 'unknown'}`)

    const tableExists = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.url_swap_tasks') IS NOT NULL AS exists
    `
    console.log(`- url_swap_tasks: ${tableExists[0]?.exists ? '✅ exists' : '❌ missing'}`)
    if (!tableExists[0]?.exists) {
      throw new Error('url_swap_tasks 表不存在：请先确认生产是否已执行 128_create_url_swap_tasks.pg.sql')
    }

    // 1) 迁移记录检查（不强依赖）
    const mhExists = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.migration_history') IS NOT NULL AS exists
    `
    if (mhExists[0]?.exists) {
      const row = await sql<{ migration_name: string; applied_at: string }[]>`
        SELECT migration_name, applied_at
        FROM migration_history
        WHERE migration_name = '134_fix_url_swap_offer_unique_soft_delete'
        LIMIT 1
      `
      console.log(`- migration_history[134]: ${row.length ? '✅ applied' : '⚠️  not found'}`)
    } else {
      console.log(`- migration_history: ⚠️  table missing (skip)`)
    }

    // 2) 约束 / 索引检查
    const constraints = await sql<{ conname: string }[]>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'public.url_swap_tasks'::regclass
      ORDER BY conname
    `
    const hasUqConstraint = constraints.some(c => c.conname === 'uq_url_swap_offer')
    console.log(`- constraint uq_url_swap_offer: ${hasUqConstraint ? '⚠️  exists' : '✅ not present'}`)

    const indexes = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'url_swap_tasks'
      ORDER BY indexname
    `
    const hasPartialUnique = indexes.some(i => i.indexname === 'uq_url_swap_offer_active')
    console.log(`- index uq_url_swap_offer_active: ${hasPartialUnique ? '✅ exists' : '⚠️  missing'}`)

    // 3) 如果要应用 134，先做“会不会失败”的预检
    const activeDupes = await sql<{ offer_id: number; cnt: number }[]>`
      SELECT offer_id, COUNT(*)::int AS cnt
      FROM url_swap_tasks
      WHERE is_deleted = FALSE AND status <> 'completed'
      GROUP BY offer_id
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, offer_id
      LIMIT 20
    `
    console.log(`- active duplicates (offer_id): ${activeDupes.length ? `⚠️  ${activeDupes.length} found` : '✅ none'}`)
    if (activeDupes.length) {
      console.log(`  例: ${activeDupes.slice(0, 5).map(r => `${r.offer_id}(${r.cnt})`).join(', ')}`)
    }

    // 4) 可选：查看指定任务（不打印敏感字段）
    if (taskId) {
      const task = await sql<any[]>`
        SELECT
          id, user_id, offer_id,
          status, enabled, is_deleted,
          error_message, error_at,
          total_swaps, success_swaps, failed_swaps,
          consecutive_failures,
          next_swap_at, updated_at, created_at
        FROM url_swap_tasks
        WHERE id = ${taskId}
        LIMIT 1
      `
      console.log(`\n📌 task ${taskId}: ${task.length ? 'found' : 'not found'}`)
      if (task.length) {
        const t = task[0]
        console.log(`- status=${t.status} enabled=${t.enabled} is_deleted=${t.is_deleted}`)
        console.log(`- offer_id=${t.offer_id} user_id=${t.user_id}`)
        console.log(`- swaps total=${t.total_swaps} ok=${t.success_swaps} fail=${t.failed_swaps} consecutive_failures=${t.consecutive_failures}`)
        console.log(`- error_at=${t.error_at ?? ''}`)
        console.log(`- error_message=${(t.error_message ?? '').slice(0, 240)}`)
      }
    }

    if (apply134) {
      console.log('\n🚨 准备执行写操作：应用 134_fix_url_swap_offer_unique_soft_delete（PostgreSQL）')
      if (activeDupes.length) {
        throw new Error('检测到“未删除且未完成”的重复 offer_id 记录，创建部分唯一索引可能失败；请先人工清理再执行。')
      }

      const possiblePaths = [
        path.join(process.cwd(), 'pg-migrations', '134_fix_url_swap_offer_unique_soft_delete.pg.sql'),
        path.join(process.cwd(), 'pg-migrations', 'archive', 'v2', '134_fix_url_swap_offer_unique_soft_delete.pg.sql'),
      ]
      const migrationPath = possiblePaths.find(p => fs.existsSync(p))
      if (!migrationPath) {
        throw new Error(`找不到迁移文件，尝试过:\n${possiblePaths.join('\n')}`)
      }
      const migrationSql = fs.readFileSync(migrationPath, 'utf-8')

      await sql.begin(async tx => {
        await tx.unsafe(migrationSql)
        const mh = await tx<{ exists: boolean }[]>`
          SELECT to_regclass('public.migration_history') IS NOT NULL AS exists
        `
        if (mh[0]?.exists) {
          await tx`
            INSERT INTO migration_history (migration_name, applied_at)
            VALUES ('134_fix_url_swap_offer_unique_soft_delete', NOW())
            ON CONFLICT (migration_name) DO NOTHING
          `
        }
      })

      console.log('✅ 已应用 134（如 migration_history 存在则已记录）')
    }

    console.log('\n✅ 预检完成')
    console.log('建议：如果生产仍出现“删除后无法重建任务”，且 uq_url_swap_offer_active 不存在，就在维护窗口运行一次本脚本加 --apply-134。')
  } finally {
    await sql.end({ timeout: 2 })
  }
}

main().catch(err => {
  console.error(`\n❌ 预检失败: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
