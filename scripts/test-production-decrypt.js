#!/usr/bin/env node

/**
 * 测试生产环境的配置和解密功能
 *
 * 使用方法：
 * ENCRYPTION_KEY=2a2f9ff10362b9800363146406c9e0295deff460ed23cce739cdc39ec2d7fa8f node scripts/test-production-decrypt.js
 */

async function testDecryption() {
  console.log('=== 测试生产环境配置和解密 ===\n')

  // 1. 检查环境变量
  console.log('1. 环境变量检查：')
  console.log('   ENCRYPTION_KEY:', process.env.ENCRYPTION_KEY ? '已设置' : '❌ 未设置')
  if (process.env.ENCRYPTION_KEY) {
    console.log('   长度:', process.env.ENCRYPTION_KEY.length)
    console.log('   格式:', /^[0-9a-fA-F]{64}$/.test(process.env.ENCRYPTION_KEY) ? '✅ 正确' : '❌ 错误')
    console.log('   预览:', process.env.ENCRYPTION_KEY.substring(0, 20) + '...')
  }
  console.log('')

  // 2. 加载配置模块
  console.log('2. 加载配置模块：')
  try {
    const config = require('../src/lib/config')
    console.log('   ✅ 配置模块加载成功')
    console.log('   ENCRYPTION_KEY:', config.ENCRYPTION_KEY.substring(0, 20) + '...')
  } catch (error) {
    console.log('   ❌ 配置模块加载失败:', error.message)
    return
  }
  console.log('')

  // 3. 测试解密函数
  console.log('3. 测试解密函数：')
  try {
    const { decrypt } = require('../src/lib/crypto')
    const testData = "20e69ed41aa09804dda3559645dcc600:87f8af17a4574293fee20afb206a7b88:4185facea7b9120879723a96b7da2267"

    const result = decrypt(testData)
    if (result) {
      console.log('   ✅ 解密成功')
      console.log('   解密值长度:', result.length)
      console.log('   解密值预览:', result.substring(0, 10) + '...')
    } else {
      console.log('   ❌ 解密失败（返回 null）')
    }
  } catch (error) {
    console.log('   ❌ 解密函数执行失败:', error.message)
  }
  console.log('')

  // 4. 测试配置读取
  console.log('4. 测试配置读取：')
  try {
    const { getUserOnlySetting } = require('../src/lib/settings')

    const setting = await getUserOnlySetting('affiliate_sync', 'yeahpromos_token', 1)
    if (setting) {
      console.log('   ✅ 配置读取成功')
      console.log('   isSensitive:', setting.isSensitive)
      console.log('   value:', setting.value ? `已解密（长度 ${setting.value.length}）` : '❌ 解密失败（null）')
    } else {
      console.log('   ❌ 配置不存在')
    }
  } catch (error) {
    console.log('   ❌ 配置读取失败:', error.message)
    console.error(error)
  }
  console.log('')

  console.log('=== 测试完成 ===')
}

testDecryption().catch(console.error)
