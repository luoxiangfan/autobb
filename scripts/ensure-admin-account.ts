#!/usr/bin/env tsx
/**
 * 确保管理员账号存在
 * 服务启动时执行：如果 autoads 管理员不存在则创建，如果存在则重置密码
 * 密码来自环境变量 DEFAULT_ADMIN_PASSWORD
 */

import { getDatabase, closeDatabase } from '@/lib/db'
import {
  ensureDefaultAdminAccount,
  requireDefaultAdminPasswordFromEnv,
} from '@/lib/db/db-init-admin'

async function main() {
  let password: string
  try {
    password = requireDefaultAdminPasswordFromEnv()
  } catch {
    console.error('❌ 错误: 必须设置环境变量 DEFAULT_ADMIN_PASSWORD')
    console.error(
      '   用法: DEFAULT_ADMIN_PASSWORD="your-password" npx tsx scripts/ensure-admin-account.ts'
    )
    process.exit(1)
  }

  const db = getDatabase()

  try {
    console.log('🔍 检查管理员账号是否存在...')
    await ensureDefaultAdminAccount(db, {
      password,
      onExisting: 'reset-password',
      setOpenclawEnabled: true,
      logCredentials: 'console-banner',
    })
  } catch (error) {
    console.error('❌ 操作失败:', error)
    process.exit(1)
  } finally {
    await closeDatabase()
  }
}

main()
