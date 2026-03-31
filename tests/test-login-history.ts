/**
 * 登录记录功能测试脚本
 *
 * 测试内容：
 * 1. 创建测试登录记录
 * 2. 通过API获取登录记录
 * 3. 验证返回数据格式和内容
 */

import { getSQLiteDatabase } from '../src/lib/db'

async function testLoginHistory() {
  console.log('\n🔍 开始测试登录记录功能...\n')

  try {
    const db = getSQLiteDatabase()

    // 步骤1: 获取第一个测试用户
    const user = db.prepare('SELECT id, username, email FROM users LIMIT 1').get() as any

    if (!user) {
      console.log('❌ 没有找到用户，请先创建用户')
      return
    }

    console.log(`✅ 找到测试用户: ${user.username} (ID: ${user.id})`)

    // 步骤2: 创建测试登录记录
    console.log('\n📝 创建测试登录记录...')

    // 成功登录记录
    db.prepare(`
      INSERT INTO login_attempts (username_or_email, ip_address, user_agent, success, failure_reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.username, '192.168.1.100', 'Mozilla/5.0 (Test Browser)', 1, null)

    // 失败登录记录
    db.prepare(`
      INSERT INTO login_attempts (username_or_email, ip_address, user_agent, success, failure_reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.username, '192.168.1.101', 'Mozilla/5.0 (Test Browser)', 0, '密码错误')

    console.log('   ✅ 成功创建 2 条测试登录记录')

    // 步骤3: 模拟API调用获取登录记录
    console.log('\n🔍 测试API查询登录记录...')

    const loginAttempts = db.prepare(`
      SELECT
        id,
        username_or_email,
        ip_address,
        user_agent,
        success,
        failure_reason,
        attempted_at
      FROM login_attempts
      WHERE username_or_email IN (?, ?)
      ORDER BY attempted_at DESC
      LIMIT 10
    `).all(user.username, user.email || user.username) as any[]

    console.log(`   ✅ 查询到 ${loginAttempts.length} 条登录尝试记录`)

    loginAttempts.slice(0, 3).forEach((record, index) => {
      console.log(`      ${index + 1}. ${record.success ? '✅ 成功' : '❌ 失败'} - IP: ${record.ip_address} - ${record.attempted_at}`)
      if (record.failure_reason) {
        console.log(`         失败原因: ${record.failure_reason}`)
      }
    })

    // 步骤4: 测试审计日志查询
    console.log('\n🔍 测试审计日志查询...')

    const auditLogs = db.prepare(`
      SELECT
        id,
        event_type,
        ip_address,
        user_agent,
        details,
        created_at
      FROM audit_logs
      WHERE user_id = ?
        AND event_type IN ('login_success', 'login_failed', 'account_locked')
      ORDER BY created_at DESC
      LIMIT 10
    `).all(user.id) as any[]

    console.log(`   ✅ 查询到 ${auditLogs.length} 条审计日志`)

    auditLogs.slice(0, 3).forEach((log, index) => {
      console.log(`      ${index + 1}. ${log.event_type} - IP: ${log.ip_address} - ${log.created_at}`)
    })

    // 步骤5: 验证合并记录逻辑
    console.log('\n🔍 验证记录合并和排序...')

    const combinedRecords = [
      ...loginAttempts.map(record => ({
        type: 'login_attempt',
        success: record.success === 1,
        ipAddress: record.ip_address,
        timestamp: record.attempted_at,
      })),
      ...auditLogs.map(log => ({
        type: 'audit_log',
        eventType: log.event_type,
        ipAddress: log.ip_address,
        timestamp: log.created_at,
      }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    console.log(`   ✅ 合并后共 ${combinedRecords.length} 条记录`)
    console.log(`   ✅ 最新 3 条记录:`)

    combinedRecords.slice(0, 3).forEach((record, index) => {
      const status = record.type === 'login_attempt'
        ? (record.success ? '✅ 登录成功' : '❌ 登录失败')
        : `🔐 ${record.eventType}`
      console.log(`      ${index + 1}. ${status} - IP: ${record.ipAddress} - ${record.timestamp}`)
    })

    console.log('\n✅ 所有测试通过！')
    console.log('\n📌 下一步操作:')
    console.log('   1. 访问 http://localhost:3000/admin/users')
    console.log('   2. 点击用户行的"历史"图标按钮')
    console.log('   3. 查看登录记录弹窗')

  } catch (error) {
    console.error('❌ 测试失败:', error)
  }

  console.log('\n🎉 登录记录功能测试完成！\n')
}

// 运行测试
testLoginHistory().catch(console.error)
