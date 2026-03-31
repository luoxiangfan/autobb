/**
 * 清理重复的Google Ads账户
 *
 * 问题：多次OAuth回调可能创建重复的账户（相同user_id + customer_id）
 * 解决：保留最新的账户，删除（软删除）旧的重复账户
 *
 * 使用方法：
 *   ts-node scripts/cleanup-duplicate-accounts.ts
 */

import { getDatabase } from '../src/lib/db'

async function cleanupDuplicateAccounts() {
  const db = await getDatabase()

  console.log('🔍 开始扫描重复的Google Ads账户...\n')

  const isDeletedFalse = db.type === 'postgres' ? 'FALSE' : '0'
  const isDeletedTrue = db.type === 'postgres' ? 'TRUE' : '1'
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  // 查找所有有重复的 (user_id, customer_id) 组合
  const duplicates = await db.query(`
    SELECT user_id, customer_id, COUNT(*) as count
    FROM google_ads_accounts
    WHERE is_deleted = ${isDeletedFalse}
    GROUP BY user_id, customer_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC
  `) as { user_id: number; customer_id: string; count: number }[]

  if (duplicates.length === 0) {
    console.log('✅ 没有发现重复账户')
    return
  }

  console.log(`⚠️ 发现 ${duplicates.length} 组重复账户:\n`)

  let totalCleaned = 0

  for (const dup of duplicates) {
    console.log(`  用户 ${dup.user_id}, 账户 ${dup.customer_id}: ${dup.count} 个重复`)

    // 获取该组的所有账户，按创建时间排序
    const accounts = await db.query(`
      SELECT id, created_at, access_token, refresh_token
      FROM google_ads_accounts
      WHERE user_id = ? AND customer_id = ? AND is_deleted = ${isDeletedFalse}
      ORDER BY created_at DESC
    `, [dup.user_id, dup.customer_id]) as { id: number; created_at: string; access_token: string | null; refresh_token: string | null }[]

    // 保留最新的（第一个），删除其他
    const keepId = accounts[0].id
    const deleteIds = accounts.slice(1).map(a => a.id)

    console.log(`    ✅ 保留账户 ID: ${keepId} (创建于 ${accounts[0].created_at})`)

    for (const deleteId of deleteIds) {
      const account = accounts.find(a => a.id === deleteId)!
      await db.exec(`
        UPDATE google_ads_accounts
        SET is_deleted = ${isDeletedTrue},
            deleted_at = ${nowFunc}
        WHERE id = ?
      `, [deleteId])

      console.log(`    🗑️  删除账户 ID: ${deleteId} (创建于 ${account.created_at})`)
      totalCleaned++
    }

    console.log()
  }

  console.log(`✅ 清理完成！共删除 ${totalCleaned} 个重复账户\n`)
}

cleanupDuplicateAccounts()
  .then(() => {
    console.log('🎉 任务完成')
    process.exit(0)
  })
  .catch((error) => {
    console.error('❌ 清理失败:', error)
    process.exit(1)
  })
