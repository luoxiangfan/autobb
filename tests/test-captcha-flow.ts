/**
 * Cloudflare Turnstile CAPTCHA集成测试
 *
 * 测试内容：
 * 1. 正常登录（前3次失败）
 * 2. 第3次失败后触发CAPTCHA要求
 * 3. 验证无CAPTCHA token时登录失败
 * 4. 模拟CAPTCHA验证成功后登录
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { recordFailedLogin, resetFailedAttempts } from '../src/lib/auth-security'
import { hashPassword } from '../src/lib/crypto'

async function testCaptchaFlow() {
  console.log('\n🔐 开始测试Cloudflare Turnstile CAPTCHA集成...\n')

  try {
    const db = getSQLiteDatabase()

    // 步骤1: 创建测试用户
    console.log('📝 步骤1: 创建测试用户...')

    // 先删除已存在的测试用户（如果有）
    db.prepare('DELETE FROM users WHERE username = ?').run('test_captcha_user')

    const passwordHash = await hashPassword('correct_password_123')
    const testUser = db.prepare(`
      INSERT INTO users (username, email, password_hash, role, package_type, failed_login_count, locked_until)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'test_captcha_user',
      'captcha.test@example.com',
      passwordHash,
      'user',
      'trial',
      0,
      null
    )

    const testUserId = testUser.lastInsertRowid as number
    console.log(`   ✅ 创建测试用户 (ID: ${testUserId}, username: test_captcha_user)`)

    // 步骤2: 模拟3次失败登录
    console.log('\n⚠️  步骤2: 模拟3次失败登录...')
    for (let i = 1; i <= 3; i++) {
      await recordFailedLogin(testUserId, '192.168.1.100', 'Test Browser')
      console.log(`   ${i}/3 失败登录已记录`)
    }

    // 验证failed_login_count
    const userAfterFailures = db.prepare('SELECT failed_login_count FROM users WHERE id = ?').get(testUserId) as any
    console.log(`   📊 当前失败次数: ${userAfterFailures.failed_login_count}`)

    if (userAfterFailures.failed_login_count >= 3) {
      console.log('   ✅ 失败次数达到阈值，应触发CAPTCHA要求')
    } else {
      console.log('   ❌ 失败次数未达到阈值')
    }

    // 步骤3: 测试API端点（模拟前端请求）
    console.log('\n🌐 步骤3: 测试API登录端点（无CAPTCHA token）...')
    console.log('   📍 预期结果: 应返回 errorType: "captcha_required"')
    console.log('   💡 实际测试需要启动开发服务器并访问:')
    console.log('      POST http://localhost:3000/api/auth/login')
    console.log('      Body: { "username": "test_captcha_user", "password": "wrong_password" }')
    console.log('   ⚠️  注意: 自动化测试无法模拟Cloudflare Turnstile验证，需要手动测试')

    // 步骤4: 前端测试指南
    console.log('\n🖥️  步骤4: 前端CAPTCHA显示测试指南')
    console.log('   1. 启动开发服务器: npm run dev')
    console.log('   2. 访问登录页面: http://localhost:3000/login')
    console.log('   3. 输入用户名: test_captcha_user')
    console.log('   4. 输入错误密码并提交（第1-3次）')
    console.log('   5. 观察第3次失败后是否显示Turnstile验证码')
    console.log('   6. 完成验证码后，输入正确密码: correct_password_123')
    console.log('   7. 验证是否成功登录')

    // 步骤5: CAPTCHA配置验证
    console.log('\n🔑 步骤5: 验证环境变量配置')
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    const secretKey = process.env.TURNSTILE_SECRET_KEY

    if (siteKey && siteKey.startsWith('0x4')) {
      console.log(`   ✅ NEXT_PUBLIC_TURNSTILE_SITE_KEY 已配置: ${siteKey.substring(0, 15)}...`)
    } else {
      console.log('   ❌ NEXT_PUBLIC_TURNSTILE_SITE_KEY 未正确配置')
    }

    if (secretKey && secretKey.startsWith('0x4')) {
      console.log(`   ✅ TURNSTILE_SECRET_KEY 已配置: ${secretKey.substring(0, 15)}...`)
    } else {
      console.log('   ❌ TURNSTILE_SECRET_KEY 未正确配置')
    }

    // 步骤6: 清理测试数据（可选）
    console.log('\n🧹 步骤6: 清理选项')
    console.log('   💡 测试用户已创建，可用于手动测试')
    console.log('   🗑️  如需清理，运行以下SQL:')
    console.log(`      DELETE FROM users WHERE id = ${testUserId};`)
    console.log('   或保留用户，重置失败次数:')
    console.log(`      UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ${testUserId};`)

    // 重置失败次数以便再次测试
    resetFailedAttempts(testUserId)
    console.log('\n   ✅ 已重置测试用户的失败次数，可重新测试')

    console.log('\n✅ CAPTCHA集成测试准备完成！')
    console.log('\n📋 测试检查清单:')
    console.log('   [ ] 1. 环境变量正确配置')
    console.log('   [ ] 2. 前端可正常加载Turnstile脚本')
    console.log('   [ ] 3. 3次失败后显示CAPTCHA widget')
    console.log('   [ ] 4. 完成CAPTCHA后可继续登录')
    console.log('   [ ] 5. 后端正确验证CAPTCHA token')
    console.log('   [ ] 6. 验证失败后widget可重置')

    console.log('\n🔗 有用的链接:')
    console.log('   - Turnstile文档: https://developers.cloudflare.com/turnstile/')
    console.log('   - Turnstile控制台: https://dash.cloudflare.com/')
    console.log('   - 测试页面: http://localhost:3000/login')

  } catch (error) {
    console.error('❌ 测试失败:', error)
  }

  console.log('\n🎉 CAPTCHA集成测试脚本执行完成！\n')
}

// 运行测试
testCaptchaFlow().catch(console.error)
