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
import { getBackupRankOrderSql, pruneCampaignBackupsForOffer } from '../src/lib/campaign-backups'
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
    WITH canonical AS (
      SELECT user_id, offer_id, id AS canonical_id
      FROM (
        SELECT
          id,
          user_id,
          offer_id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, offer_id
            ORDER BY ${order}
          ) AS rn
        FROM campaign_backups
      ) ranked
      WHERE rn = 1
    ),
    keeper_ids AS (
      SELECT cb.id
      FROM campaign_backups cb
      INNER JOIN canonical c
        ON cb.user_id = c.user_id AND cb.offer_id = c.offer_id
      WHERE cb.id = c.canonical_id
         OR (cb.backup_source = 'google_ads' AND cb.backup_version >= 2)
    )
    SELECT
      cb.id,
      cb.user_id,
      cb.offer_id,
      cb.backup_source,
      cb.backup_version,
      cb.updated_at
    FROM campaign_backups cb
    WHERE cb.id NOT IN (SELECT id FROM keeper_ids)
    ORDER BY cb.user_id, cb.offer_id, cb.id
    LIMIT 100
  `)

  console.log('\n=== 将删除的重复行（prune 预览，最多 100 条）===')
  if (rows.length === 0) {
    console.log('（无 prune 将删除的行）')
    return
  }
  console.table(rows)
  const total = await db.queryOne<{ count: number }>(`
    WITH canonical AS (
      SELECT user_id, offer_id, id AS canonical_id
      FROM (
        SELECT
          id,
          user_id,
          offer_id,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, offer_id
            ORDER BY ${order}
          ) AS rn
        FROM campaign_backups
      ) ranked
      WHERE rn = 1
    ),
    keeper_ids AS (
      SELECT cb.id
      FROM campaign_backups cb
      INNER JOIN canonical c
        ON cb.user_id = c.user_id AND cb.offer_id = c.offer_id
      WHERE cb.id = c.canonical_id
         OR (cb.backup_source = 'google_ads' AND cb.backup_version >= 2)
    )
    SELECT COUNT(*) AS count
    FROM campaign_backups cb
    WHERE cb.id NOT IN (SELECT id FROM keeper_ids)
  `)
  console.log(`合计将删除: ${total?.count ?? 0} 行（保留 canonical + google_ads v2+）`)
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

async function pruneAllDuplicateOffers(db: DatabaseAdapter, dryRun: boolean): Promise<number> {
  const duplicateOffers = (await db.query(`
    SELECT user_id, offer_id, COUNT(*) AS backup_count
    FROM campaign_backups
    GROUP BY user_id, offer_id
    HAVING COUNT(*) > 1
  `)) as Array<{ user_id: number; offer_id: number; backup_count: number }>

  console.log(`\n=== 按 Offer 修剪重复备份: ${duplicateOffers.length} 组 ===`)

  if (duplicateOffers.length === 0) {
    return 0
  }

  if (dryRun) {
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
    console.log(`[dry-run] 预计将删除约 ${count} 行（保留 canonical + google_ads v2+）`)
    return count
  }

  let totalDeleted = 0
  for (const row of duplicateOffers) {
    const deleted = await pruneCampaignBackupsForOffer(row.offer_id, row.user_id)
    totalDeleted += deleted
  }

  console.log(`已删除: ${totalDeleted} 行`)
  return totalDeleted
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

  const overLimitGroups = await db.query(`
    SELECT user_id, offer_id, COUNT(*) AS cnt
    FROM campaign_backups
    GROUP BY user_id, offer_id
    HAVING COUNT(*) > 2
    LIMIT 10
  `)
  if (overLimitGroups.length > 0) {
    console.error('\n❌ 仍有 Offer 备份数超过 2（canonical + google_ads v2 上限）:')
    console.table(overLimitGroups)
    return false
  }

  const publishLeft = await db.queryOne<{ count: number }>(`
    SELECT COUNT(*) AS count FROM campaign_backups WHERE backup_source = 'publish'
  `)
  if ((publishLeft?.count ?? 0) > 0) {
    console.warn(
      `\n⚠️ 仍有 backup_source='publish' 的行: ${publishLeft?.count}（可能为非保留行，请复查）`
    )
  } else {
    console.log("\n✅ 无 backup_source='publish' 行")
  }

  console.log('✅ 无多余重复组合（允许 canonical + google_ads v2 最终版共存）')
  return true
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
  await pruneAllDuplicateOffers(db, dryRun)

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
