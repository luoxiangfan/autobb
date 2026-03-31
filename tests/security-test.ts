/**
 * 安全功能测试脚本
 *
 * 测试内容：
 * 1. 速率限制功能
 * 2. 暴力破解保护（账户锁定）
 * 3. 审计日志记录
 */

import { checkRateLimit, resetRateLimit } from '../src/lib/rate-limiter'
import {
  checkAccountLockout,
  recordFailedLogin,
  resetFailedAttempts,
  getLockedAccounts,
  logLoginAttempt,
} from '../src/lib/auth-security'
import { logAuditEvent, AuditEventType, queryAuditLogs } from '../src/lib/audit-logger'
import { getSQLiteDatabase } from '../src/lib/db'

async function runSecurityTests() {
console.log('\n🔒 开始安全功能测试...\n')

// ==================== 测试1: 速率限制 ====================
console.log('📋 测试1: 速率限制功能')
try {
  const testIp = 'test-ip-192.168.1.100'

  // 重置测试IP的速率限制
  resetRateLimit(`ip:${testIp}`)

  // 前5次应该成功
  for (let i = 1; i <= 5; i++) {
    checkRateLimit(`ip:${testIp}`)
    console.log(`   ✅ 请求 ${i}/5 通过`)
  }

  // 第6次应该被拒绝
  try {
    checkRateLimit(`ip:${testIp}`)
    console.log('   ❌ 失败：第6次请求应该被拒绝')
  } catch (error: any) {
    console.log(`   ✅ 第6次请求被正确拒绝: ${error.message}`)
  }

  // 清理
  resetRateLimit(`ip:${testIp}`)
  console.log('   ✅ 速率限制测试通过\n')
} catch (error) {
  console.error('   ❌ 速率限制测试失败:', error)
}

// ==================== 测试2: 暴力破解保护 ====================
console.log('📋 测试2: 暴力破解保护（账户锁定）')
try {
  const db = getSQLiteDatabase()

  // 创建测试用户
  const testUser = db.prepare(`
    INSERT INTO users (username, email, password_hash, role, package_type, failed_login_count, locked_until)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    'test_security_user',
    'security.test@example.com',
    'dummy_hash',
    'user',
    'trial',
    0,
    null
  )

  const testUserId = testUser.lastInsertRowid as number
  console.log(`   ✅ 创建测试用户 (ID: ${testUserId})`)

  // 模拟5次失败登录
  for (let i = 1; i <= 5; i++) {
    await recordFailedLogin(testUserId, '192.168.1.100', 'test-agent')
    console.log(`   ⚠️  失败登录 ${i}/5`)
  }

  // 检查账户是否被锁定
  const lockedAccounts = getLockedAccounts()
  const isLocked = lockedAccounts.some(acc => acc.id === testUserId)

  if (isLocked) {
    console.log('   ✅ 账户已被正确锁定')

    // 尝试检查锁定状态
    const userAfterLock = db.prepare('SELECT * FROM users WHERE id = ?').get(testUserId) as any
    try {
      await checkAccountLockout(userAfterLock)
      console.log('   ❌ 失败：锁定检查应该抛出错误')
    } catch (error: any) {
      console.log(`   ✅ 锁定检查正确抛出错误: ${error.message}`)
    }
  } else {
    console.log('   ❌ 失败：账户未被锁定')
  }

  // 清理测试用户
  db.prepare('DELETE FROM users WHERE id = ?').run(testUserId)
  console.log('   ✅ 暴力破解保护测试通过\n')
} catch (error) {
  console.error('   ❌ 暴力破解保护测试失败:', error)
}

// ==================== 测试3: 审计日志 ====================
console.log('📋 测试3: 审计日志记录')
try {
  // 记录测试事件
  await logAuditEvent({
    userId: 1,
    eventType: AuditEventType.LOGIN_SUCCESS,
    ipAddress: '192.168.1.100',
    userAgent: 'test-agent',
    details: { test: true },
  })

  await logAuditEvent({
    userId: 1,
    eventType: AuditEventType.LOGIN_FAILED,
    ipAddress: '192.168.1.100',
    userAgent: 'test-agent',
    details: { reason: 'invalid_password' },
  })

  console.log('   ✅ 审计事件已记录')

  // 查询审计日志
  const logs = queryAuditLogs({
    userId: 1,
    limit: 2,
  })

  if (logs.length >= 2) {
    console.log(`   ✅ 成功查询到 ${logs.length} 条审计日志`)
    logs.forEach((log, index) => {
      console.log(`      ${index + 1}. ${log.event_type} - ${log.ip_address}`)
    })
  } else {
    console.log('   ❌ 失败：未查询到足够的审计日志')
  }

  console.log('   ✅ 审计日志测试通过\n')
} catch (error) {
  console.error('   ❌ 审计日志测试失败:', error)
}

// ==================== 测试4: 登录尝试日志 ====================
console.log('📋 测试4: 登录尝试日志')
try {
  await logLoginAttempt(
    'test@example.com',
    '192.168.1.100',
    'test-agent',
    true
  )

  await logLoginAttempt(
    'test@example.com',
    '192.168.1.100',
    'test-agent',
    false,
    '密码错误'
  )

  const db = getSQLiteDatabase()
  const attempts = db.prepare(`
    SELECT * FROM login_attempts
    WHERE username_or_email = 'test@example.com'
    ORDER BY attempted_at DESC
    LIMIT 2
  `).all() as any[]

  if (attempts.length >= 2) {
    console.log(`   ✅ 成功记录 ${attempts.length} 条登录尝试`)
    attempts.forEach((attempt, index) => {
      console.log(`      ${index + 1}. ${attempt.success ? '成功' : '失败'} - ${attempt.failure_reason || 'N/A'}`)
    })
  } else {
    console.log('   ❌ 失败：未记录足够的登录尝试')
  }

  console.log('   ✅ 登录尝试日志测试通过\n')
} catch (error) {
  console.error('   ❌ 登录尝试日志测试失败:', error)
}

console.log('🎉 所有安全功能测试完成！\n')
}

// 运行测试
runSecurityTests().catch(console.error)
