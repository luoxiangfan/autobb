import crypto from 'crypto'
import { compare as bcryptCompare, hash as bcryptHash } from './bcrypt'
import { ENCRYPTION_KEY, ENCRYPTION_IV_LENGTH, BCRYPT_SALT_ROUNDS } from './config'

const IV_LENGTH = ENCRYPTION_IV_LENGTH

/**
 * 使用AES-256-GCM加密敏感数据
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = Buffer.from(ENCRYPTION_KEY, 'hex')

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  // 格式: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * 解密AES-256-GCM加密的数据
 */
export function decrypt(encryptedData: string): string | null {
  try {
    const parts = encryptedData.split(':')
    if (parts.length !== 3) {
      console.error('[crypto] 解密失败: 加密数据格式无效，应为 iv:authTag:encrypted 格式')
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
    console.error('[crypto] 解密失败:', {
      error: error instanceof Error ? error.message : String(error),
      encryptedDataLength: encryptedData?.length,
      encryptedDataPreview: encryptedData?.substring(0, 20) + '...',
      encryptionKeyConfigured: !!ENCRYPTION_KEY,
      encryptionKeyLength: ENCRYPTION_KEY?.length,
    })
    return null
  }
}

/**
 * 使用bcrypt哈希密码
 */
export async function hashPassword(password: string): Promise<string> {
  return await bcryptHash(password, BCRYPT_SALT_ROUNDS)
}

/**
 * 验证密码
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return await bcryptCompare(password, hash)
}

/**
 * 生成随机密钥（用于初始化配置）
 */
export function generateRandomKey(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex')
}
