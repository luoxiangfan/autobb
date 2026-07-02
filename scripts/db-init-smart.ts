#!/usr/bin/env tsx
/**
 * PostgreSQL database initialization helper
 *
 * 1. Verifies critical tables exist (run db:migrate first if missing)
 * 2. Ensures default admin account exists
 */

import { getDatabase, closeDatabase } from '@/lib/db'
import { ensureDefaultAdminAccount } from '@/lib/db/db-init-admin'
import {
  DB_INIT_CRITICAL_TABLES,
  resolveDefaultAdminPassword,
} from '@/lib/db/db-init-constants'
import { isSmartInitTablesReady } from '@/lib/db/db-init-critical-tables'

async function main() {
  console.log('🚀 PostgreSQL 数据库初始化检查...\n')

  const db = getDatabase()
  let existingCount = 0
  let ready = false

  try {
    const result = await isSmartInitTablesReady(db)
    existingCount = result.existingCount
    ready = result.ready
    console.log(`📊 检查结果: ${existingCount}/${DB_INIT_CRITICAL_TABLES.length} 个关键表存在`)
  } catch (error) {
    console.warn('⚠️ 检查数据库失败:', error)
  } finally {
    await closeDatabase()
  }

  if (!ready) {
    console.log('⚠️ 数据库未初始化，请先运行: npm run db:migrate')
    process.exit(1)
  }

  console.log('🔑 检查管理员账号...')
  const password = resolveDefaultAdminPassword()
  const adminDb = getDatabase()

  try {
    await ensureDefaultAdminAccount(adminDb, {
      password,
      onExisting: 'reset-password',
      logCredentials: 'console-banner',
    })
    console.log('🎉 数据库初始化完成！')
  } catch (error) {
    console.error('❌ 管理员账号操作失败:', error)
    throw error
  } finally {
    await closeDatabase()
  }
}

main().catch((error) => {
  console.error('❌ 初始化失败:', error)
  process.exit(1)
})
