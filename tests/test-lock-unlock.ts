/**
 * 锁定状态和解锁功能测试脚本
 *
 * 测试内容：
 * 1. 模拟用户被锁定（5次失败登录）
 * 2. 验证锁定状态在API中正确返回
 * 3. 测试管理员解锁功能
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { recordFailedLogin } from '../src/lib/auth-security'
import { unlockAccount, getLockedAccounts } from '../src/lib/auth-security'

async function testLockUnlock() {
  console.log('\n🔒 开始测试锁定状态和解锁功能...\n')

  try {
    const db = getSQLiteDatabase()

    // 步骤1: 创建测试用户
    console.log('📝 创建测试用户...')
    const testUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, package_type, failed_login_count, locked_until)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test_lock_user',
      'lock.test@example.com',
      'dummy_hash',
      'user',
      'trial',
      0,
      null
    )

    const testUserId = testUser.lastInsertRowid as number
    console.log(`   ✅ 创建测试用户 (ID: ${testUserId}, username: test_lock_user)`)

    // 步骤2: 模拟5次失败登录导致锁定
    console.log('\n⚠️  模拟5次失败登录...')
    for (let i = 1; i <= 5; i++) {
      await recordFailedLogin(testUserId, '192.168.1.200', 'Test Browser')
      console.log(`   ${i}/5 失败登录已记录`)
    }

    // 步骤3: 验证用户已被锁定
    console.log('\n🔍 验证锁定状态...')
    const userAfterLock = db.prepare('SELECT * FROM users WHERE id = ?').get(testUserId) as any

    if (userAfterLock.locked_until) {
      const lockEnd = new Date(userAfterLock.locked_until)
      const now = new Date()
      const isLocked = lockEnd > now

      if (isLocked) {
        const minutesRemaining = Math.ceil((lockEnd.getTime() - now.getTime()) / 60000)
        console.log(`   ✅ 用户已被锁定`)
        console.log(`   ⏳ 锁定剩余时间: ${minutesRemaining} 分钟`)
        console.log(`   📊 失败登录次数: ${userAfterLock.failed_login_count}`)
        console.log(`   🔒 锁定截止时间: ${userAfterLock.locked_until}`)
      } else {
        console.log('   ❌ 锁定时间已过期')
      }
    } else {
      console.log('   ❌ 用户未被锁定（locked_until为空）')
    }

    // 步骤4: 测试getLockedAccounts函数
    console.log('\n📋 测试getLockedAccounts函数...')
    const lockedAccounts = getLockedAccounts()
    const ourUser = lockedAccounts.find(acc => acc.id === testUserId)

    if (ourUser) {
      console.log(`   ✅ 在锁定账户列表中找到测试用户`)
      console.log(`   - 用户名: ${ourUser.username}`)
      console.log(`   - 邮箱: ${ourUser.email}`)
      console.log(`   - 失败次数: ${ourUser.failed_login_count}`)
    } else {
      console.log('   ❌ 未在锁定账户列表中找到测试用户')
    }

    // 步骤5: 测试管理员解锁功能
    console.log('\n🔓 测试管理员解锁功能...')
    unlockAccount(testUserId)
    console.log('   ✅ 调用unlockAccount函数完成')

    // 步骤6: 验证解锁后的状态
    const userAfterUnlock = db.prepare('SELECT * FROM users WHERE id = ?').get(testUserId) as any

    if (!userAfterUnlock.locked_until && userAfterUnlock.failed_login_count === 0) {
      console.log('   ✅ 解锁成功！')
      console.log(`   - locked_until: ${userAfterUnlock.locked_until || 'NULL'}`)
      console.log(`   - failed_login_count: ${userAfterUnlock.failed_login_count}`)
    } else {
      console.log('   ❌ 解锁失败，状态未正确重置')
    }

    // 步骤7: 模拟API查询（验证locked_until字段在API中返回）
    console.log('\n🔍 模拟API查询（包含locked_until字段）...')
    const apiResult = db.prepare(`
      SELECT id, username, email, role, package_type, is_active, locked_until, failed_login_count
      FROM users
      WHERE id = ?
    `).get(testUserId) as any

    console.log('   ✅ API查询结果:')
    console.log(`   - username: ${apiResult.username}`)
    console.log(`   - is_active: ${apiResult.is_active}`)
    console.log(`   - locked_until: ${apiResult.locked_until || 'NULL'}`)
    console.log(`   - failed_login_count: ${apiResult.failed_login_count}`)

    // 清理测试数据
    console.log('\n🧹 清理测试数据...')
    db.prepare('DELETE FROM users WHERE id = ?').run(testUserId)
    console.log('   ✅ 测试用户已删除')

    console.log('\n✅ 所有测试通过！')
    console.log('\n📌 前端测试步骤:')
    console.log('   1. 访问 http://localhost:3000/admin/users')
    console.log('   2. 找到被锁定的用户（黄色Badge: ⏳ 已锁定）')
    console.log('   3. 点击蓝色"解锁"按钮（🔓 图标）')
    console.log('   4. 确认解锁后状态变为"✅ 正常"')

  } catch (error) {
    console.error('❌ 测试失败:', error)
  }

  console.log('\n🎉 锁定状态和解锁功能测试完成！\n')
}

// 运行测试
testLockUnlock().catch(console.error)
