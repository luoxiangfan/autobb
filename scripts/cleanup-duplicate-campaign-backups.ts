#!/usr/bin/env tsx
/**
 * 一次性清理 campaign_backups 历史重复行。
 *
 * 用法:
 *   npm run campaign-backups:dedup:preview   # 仅统计与预览
 *   npm run campaign-backups:dedup             # 执行归一 + 删除
 *
 * 文档: docs/operations/campaign-backups-dedup.md
 */

import 'dotenv/config'
import { getBackupRankOrderSql } from '../src/lib/campaign-backups'
import { getDatabase, type DatabaseAdapter } from '../src/lib/db'

function distinctPairCountSql(dbType: 'sqlite' | 'postgres'): string {
  return dbType === 'postgres'
    ? 'COUNT(DISTINCT (user_id, offer_id))'
    : "COUNT(DISTINCT user_id || '-' || offer_id)"
}

function rankOrderSql(dbType: 'sqlite' | 'postgres'): string {
  return getBackupRankOrderSql(dbType)
}

async function printPreStats(db: DatabaseAdapter): Promise<number> {
  const distinctPairs = distinctPairCountSql(db.type)
  const before = await db.queryOne<{
    total_rows: number
    distinct_pairs: number
    duplicate_rows: number
  }>(`
    SELECT
      COUNT(*) AS total_rows,
      ${distinctPairs} AS distinct_pairs,
      COUNT(*) - ${distinctPairs} AS duplicate_rows
    FROM campaign_backups
  `)

  console.log('\n=== 清理前统计 ===')
  console.log(before)

  const bySource = await db.query<{ backup_source: string; row_count: number }>(`
    SELECT backup_source, COUNT(*) AS row_count
    FROM campaign_backups
    GROUP BY backup_source
    ORDER BY row_count DESC
  `)
  console.log('\n按 backup_source:')
  console.table(bySource)

  const dupSamples = await db.query(`
    SELECT user_id, offer_id, COUNT(*) AS backup_count
    FROM campaign_backups
    GROUP BY user_id, offer_id
    HAVING COUNT(*) > 1
    ORDER BY backup_count DESC, user_id, offer_id
    LIMIT 20
  `)
  if (dupSamples.length > 0) {
    console.log('\n重复样例（最多 20 组）:')
    console.table(dupSamples)
  }

  return before?.duplicate_rows ?? 0
}

async function printDeletePreview(db: DatabaseAdapter): Promise<void> {
  const order = rankOrderSql(db.type)
  const rows = await db.query(`
    WITH ranked AS (
      SELECT
        id,
        user_id,
        offer_id,
        backup_source,
        backup_version,
        updated_at,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, offer_id
          ORDER BY ${order}
        ) AS rn
      FROM campaign_backups
    )
    SELECT id, user_id, offer_id, backup_source, backup_version, updated_at, rn
    FROM ranked
    WHERE rn > 1
    ORDER BY user_id, offer_id, rn
    LIMIT 100
  `)

  console.log('\n=== 将删除的重复行（预览，最多 100 条）===')
  if (rows.length === 0) {
    console.log('（无重复行）')
    return
  }
  console.table(rows)
  const total = await db.queryOne<{ count: number }>(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, offer_id
          ORDER BY ${order}
        ) AS rn
      FROM campaign_backups
    )
    SELECT COUNT(*) AS count FROM ranked WHERE rn > 1
  `)
  console.log(`合计将删除: ${total?.count ?? 0} 行`)
}

async function normalizePublishSources(db: DatabaseAdapter, dryRun: boolean): Promise<number> {
  const order = rankOrderSql(db.type)
  const countRow = await db.queryOne<{ count: number }>(`
    WITH keepers AS (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, offer_id
            ORDER BY ${order}
          ) AS rn
        FROM campaign_backups
      ) ranked
      WHERE rn = 1
    )
    SELECT COUNT(*) AS count
    FROM campaign_backups cb
    INNER JOIN keepers k ON cb.id = k.id
    WHERE cb.backup_source = 'publish'
  `)
  const count = countRow?.count ?? 0

  if (count === 0) {
    console.log('\n=== 归一 backup_source ===')
    console.log('无需更新（无保留行使用 publish）')
    return 0
  }

  console.log(`\n=== 归一 backup_source（publish -> autoads）: ${count} 行 ===`)
  if (dryRun) {
    console.log('[dry-run] 跳过写入')
    return count
  }

  const nowExpr = db.type === 'postgres' ? 'CURRENT_TIMESTAMP' : "datetime('now')"
  const result = await db.exec(`
    WITH keepers AS (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, offer_id
            ORDER BY ${order}
          ) AS rn
        FROM campaign_backups
      ) ranked
      WHERE rn = 1
    )
    UPDATE campaign_backups
    SET backup_source = 'autoads', updated_at = ${nowExpr}
    WHERE id IN (SELECT id FROM keepers)
      AND backup_source = 'publish'
  `)

  console.log(`已更新: ${result.changes} 行`)
  return result.changes
}

async function deleteDuplicates(db: DatabaseAdapter, dryRun: boolean): Promise<number> {
  const order = rankOrderSql(db.type)
  const toDelete = await db.queryOne<{ count: number }>(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id, offer_id
          ORDER BY ${order}
        ) AS rn
      FROM campaign_backups
    )
    SELECT COUNT(*) AS count FROM ranked WHERE rn > 1
  `)
  const count = toDelete?.count ?? 0

  console.log(`\n=== 删除重复行: ${count} 行 ===`)
  if (count === 0) {
    return 0
  }
  if (dryRun) {
    console.log('[dry-run] 跳过删除')
    return count
  }

  if (db.type === 'postgres') {
    const result = await db.exec(`
      WITH ranked AS (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, offer_id
            ORDER BY ${order}
          ) AS rn
        FROM campaign_backups
      )
      DELETE FROM campaign_backups cb
      USING ranked r
      WHERE cb.id = r.id AND r.rn > 1
    `)
    console.log(`已删除: ${result.changes} 行`)
    return result.changes
  }

  const result = await db.exec(`
    DELETE FROM campaign_backups
    WHERE id IN (
      SELECT id
      FROM (
        SELECT
          id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, offer_id
            ORDER BY ${order}
          ) AS rn
        FROM campaign_backups
      )
      WHERE rn > 1
    )
  `)
  console.log(`已删除: ${result.changes} 行`)
  return result.changes
}

async function printPostStats(db: DatabaseAdapter): Promise<boolean> {
  const distinctPairs = distinctPairCountSql(db.type)
  const after = await db.queryOne<{
    total_rows: number
    distinct_pairs: number
  }>(`
    SELECT
      COUNT(*) AS total_rows,
      ${distinctPairs} AS distinct_pairs
    FROM campaign_backups
  `)

  console.log('\n=== 清理后统计 ===')
  console.log(after)

  const remainingDupes = await db.query(`
    SELECT user_id, offer_id, COUNT(*) AS cnt
    FROM campaign_backups
    GROUP BY user_id, offer_id
    HAVING COUNT(*) > 1
    LIMIT 10
  `)
  if (remainingDupes.length > 0) {
    console.error('\n❌ 仍存在重复组合:')
    console.table(remainingDupes)
    return false
  }

  const publishLeft = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*) AS count FROM campaign_backups WHERE backup_source = 'publish'
  `)
  if ((publishLeft?.count ?? 0) > 0) {
    console.warn(`\n⚠️ 仍有 backup_source='publish' 的行: ${publishLeft?.count}（可能为非保留行，请复查）`)
  } else {
    console.log("\n✅ 无 backup_source='publish' 行")
  }

  if (after && after.total_rows === after.distinct_pairs) {
    console.log('✅ 每个 (user_id, offer_id) 仅一条备份')
    return true
  }

  console.error('❌ total_rows 与 distinct_pairs 不一致')
  return false
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const db = getDatabase()

  console.log(`[campaign-backups:dedup] db=${db.type} mode=${dryRun ? 'DRY_RUN' : 'APPLY'}`)

  const duplicateRows = await printPreStats(db)
  if (duplicateRows === 0) {
    console.log('\n无需清理：未发现重复 (user_id, offer_id) 组合。')
    process.exit(0)
  }

  await printDeletePreview(db)
  await normalizePublishSources(db, dryRun)
  await deleteDuplicates(db, dryRun)

  if (dryRun) {
    console.log('\n[dry-run] 完成。执行 npm run campaign-backups:dedup 以应用变更。')
    process.exit(0)
  }

  const ok = await printPostStats(db)
  process.exit(ok ? 0 : 1)
}

main().catch((error) => {
  console.error('[campaign-backups:dedup] 失败:', error)
  process.exit(1)
})
