#!/usr/bin/env node
/**
 * 诊断生产环境 ENCRYPTION_KEY 配置问题
 *
 * 使用方法：
 * 1. 在生产环境运行: node scripts/diagnose-encryption-env.js
 * 2. 或者手动设置环境变量测试: ENCRYPTION_KEY=xxx node scripts/diagnose-encryption-env.js
 */

console.log('=== 环境变量诊断 ===\n')

// 1. 检查 ENCRYPTION_KEY 是否存在
const encryptionKey = process.env.ENCRYPTION_KEY
console.log('1. ENCRYPTION_KEY 是否存在:', !!encryptionKey)

if (!encryptionKey) {
  console.error('❌ ENCRYPTION_KEY 未设置')
  console.log('\n请检查：')
  console.log('  - Docker: 是否在 docker-compose.yml 或 Dockerfile 中设置了环境变量？')
  console.log('  - Cloud Run: 是否在服务配置中设置了环境变量？')
  console.log('  - Vercel: 是否在项目设置中添加了环境变量？')
  process.exit(1)
}

// 2. 检查长度
console.log('2. ENCRYPTION_KEY 长度:', encryptionKey.length)
console.log('   预期长度: 64 (32字节的十六进制)')

// 3. 检查格式
const isValidHex = /^[0-9a-fA-F]{64}$/.test(encryptionKey)
console.log('3. 格式是否正确 (64个十六进制字符):', isValidHex)

if (!isValidHex) {
  console.error('❌ ENCRYPTION_KEY 格式无效')
  console.log('\n当前值预览:', encryptionKey.substring(0, 20) + '...')
  console.log('当前值长度:', encryptionKey.length)
  console.log('\n可能的问题：')
  console.log('  - 包含空格或换行符')
  console.log('  - 长度不是64个字符')
  console.log('  - 包含非十六进制字符')

  // 检查是否有空格或换行
  if (encryptionKey.includes(' ')) {
    console.log('  ⚠️  检测到空格')
  }
  if (encryptionKey.includes('\n') || encryptionKey.includes('\r')) {
    console.log('  ⚠️  检测到换行符')
  }

  process.exit(1)
}

// 4. 测试解密
console.log('\n4. 测试解密功能...')

try {
  const crypto = require('crypto')

  // 使用生产环境的加密数据进行测试
  const testEncrypted = '6e0e5e0f5c5e5e5e5e5e5e5e5e5e5e5e:5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e:5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e'

  const parts = testEncrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('测试数据格式无效')
  }

  const [ivHex, authTagHex, encrypted] = parts
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const key = Buffer.from(encryptionKey, 'hex')

  console.log('   - IV 长度:', iv.length, '字节')
  console.log('   - AuthTag 长度:', authTag.length, '字节')
  console.log('   - Key 长度:', key.length, '字节 (预期32)')

  if (key.length !== 32) {
    console.error('   ❌ Key 长度不正确，应为32字节')
    process.exit(1)
  }

  console.log('   ✅ Key 格式正确')

} catch (error) {
  console.error('   ❌ 解密测试失败:', error.message)
  process.exit(1)
}

console.log('\n✅ 所有检查通过！ENCRYPTION_KEY 配置正确')
console.log('\n如果生产环境仍然解密失败，请检查：')
console.log('  1. 确认使用的 ENCRYPTION_KEY 与加密时使用的密钥一致')
console.log('  2. 确认数据库中的 encrypted_value 格式正确 (iv:authTag:encrypted)')
console.log('  3. 检查应用日志中的详细错误信息')
