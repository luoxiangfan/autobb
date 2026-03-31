#!/usr/bin/env node

/**
 * 验证 ENCRYPTION_KEY 是否能正确解密数据库中的敏感配置
 */

const crypto = require('crypto')

const ENCRYPTION_KEY = '2a2f9ff10362b9800363146406c9e0295deff460ed23cce739cdc39ec2d7fa8f'

function decrypt(encryptedData) {
  try {
    const parts = encryptedData.split(':')
    if (parts.length !== 3) {
      console.error('❌ 加密数据格式无效，应为 iv:authTag:encrypted 格式')
      return null
    }

    const [ivHex, authTagHex, encrypted] = parts
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const key = Buffer.from(ENCRYPTION_KEY, 'hex')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')

    return decrypted
  } catch (error) {
    console.error('❌ 解密失败:', error.message)
    return null
  }
}

// 从命令行参数获取加密数据
const encryptedValue = process.argv[2]

if (!encryptedValue) {
  console.error('用法: node verify-encryption.js <encrypted_value>')
  process.exit(1)
}

console.log('ENCRYPTION_KEY:', ENCRYPTION_KEY)
console.log('加密数据长度:', encryptedValue.length)
console.log('加密数据预览:', encryptedValue.substring(0, 40) + '...')
console.log('')

const decrypted = decrypt(encryptedValue)

if (decrypted) {
  console.log('✅ 解密成功!')
  console.log('解密后的值长度:', decrypted.length)
  console.log('解密后的值预览:', decrypted.substring(0, 20) + '...')
} else {
  console.log('❌ 解密失败')
}
