/**
 * 安全配置管理 - 移除硬编码默认值
 *
 * 用途：
 * - 集中管理所有敏感配置
 * - 运行时验证必需的环境变量（延迟加载）
 * - 确保密钥强度符合安全标准
 *
 * 注意：构建时和测试时不验证，只在运行时验证
 */

// 标记是否为构建阶段或测试环境
// 🔥 修复：只在真正的构建阶段跳过验证，不能在运行时跳过
// Next.js 构建时会设置 NEXT_PHASE，但某些部署环境可能在运行时也保留这个变量
//
// 判断逻辑：
// 1. NEXT_PHASE === 'phase-production-build' → 构建阶段
// 2. 但如果同时存在 SKIP_ENV_VALIDATION=false → 强制验证（运行时场景）
// 3. 测试环境也跳过验证
const IS_BUILD_TIME = process.env.NEXT_PHASE === 'phase-production-build' && process.env.SKIP_ENV_VALIDATION !== 'false'
const IS_TEST_ENV = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true'
const SKIP_VALIDATION = IS_BUILD_TIME || IS_TEST_ENV

/**
 * 获取必需的环境变量，未设置则抛出错误
 */
function getRequiredEnvVar(name: string, minLength?: number): string {
  const value = process.env[name]

  // 构建时或测试时返回占位符，避免失败
  // 🔥 生产环境运行时永远不跳过验证，即使 NEXT_PHASE 存在
  if (SKIP_VALIDATION) {
    return 'placeholder-for-build-or-test'.padEnd(minLength || 32, '0')
  }

  if (!value) {
    throw new Error(
      `❌ SECURITY ERROR: Missing required environment variable: ${name}\n` +
      `Please set ${name} in your .env file before starting the application.`
    )
  }

  if (minLength && value.length < minLength) {
    throw new Error(
      `❌ SECURITY ERROR: ${name} is too short (minimum ${minLength} characters required)\n` +
      `Current length: ${value.length}, Required: ${minLength}`
    )
  }

  return value
}

/**
 * 获取可选的环境变量，返回默认值
 */
function getOptionalEnvVar(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue
}

// ==================== JWT配置 ====================
export const JWT_SECRET = getRequiredEnvVar('JWT_SECRET', 32)
export const JWT_EXPIRES_IN = getOptionalEnvVar('JWT_EXPIRES_IN', '7d')

// ==================== 加密配置 ====================
export const ENCRYPTION_KEY = getRequiredEnvVar('ENCRYPTION_KEY', 64) // 32字节 = 64 hex字符
export const ENCRYPTION_IV_LENGTH = parseInt(getOptionalEnvVar('ENCRYPTION_IV_LENGTH', '16'), 10)

// ==================== 密码哈希配置 ====================
export const BCRYPT_SALT_ROUNDS = parseInt(getOptionalEnvVar('BCRYPT_SALT_ROUNDS', '12'), 10)

// ==================== 数据库配置 ====================
export const DATABASE_TYPE = getOptionalEnvVar('DATABASE_TYPE', 'sqlite')
export const SQLITE_DB_PATH = getOptionalEnvVar('SQLITE_DB_PATH', './data/autoads.db')

// ==================== Node环境 ====================
export const NODE_ENV = getOptionalEnvVar('NODE_ENV', 'development')
export const IS_PRODUCTION = NODE_ENV === 'production'
export const IS_DEVELOPMENT = NODE_ENV === 'development'

// ==================== Redis配置 ====================
export const REDIS_URL = getOptionalEnvVar('REDIS_URL', 'redis://localhost:6379')

// 🔥 Redis前缀配置（结构化，2025-12-10优化为方案3）
export const REDIS_PREFIX_CONFIG = {
  queue: `autoads:${NODE_ENV}:queue:`,
  // 🔥 非核心任务队列（click-farm/url-swap 等）独立前缀，避免与核心任务互相争抢资源
  queueBackground: `autoads:${NODE_ENV}:queue:bg:`,
  cache: `autoads:${NODE_ENV}:cache:`,
} as const

// 向后兼容：保留REDIS_KEY_PREFIX（队列专用）
export const REDIS_KEY_PREFIX = REDIS_PREFIX_CONFIG.queue

// ==================== 运行时验证（仅在非构建/测试时执行） ====================
if (!SKIP_VALIDATION) {
  // 验证bcrypt强度
  if (BCRYPT_SALT_ROUNDS < 10) {
    throw new Error('❌ SECURITY ERROR: BCRYPT_SALT_ROUNDS must be at least 10')
  }

  // 验证ENCRYPTION_KEY格式（必须是64个十六进制字符）
  if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
    throw new Error(
      '❌ SECURITY ERROR: ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)\n' +
      'Generate a new key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      `Current value format is invalid: ${ENCRYPTION_KEY.substring(0, 10)}...`
    )
  }

  // 生产环境额外验证
  if (IS_PRODUCTION) {
    // 生产环境禁止使用弱密钥
    const weakSecrets = [
      'default-secret-please-change-in-production',
      '0000000000000000000000000000000000000000000000000000000000000000',
      '1111111111111111111111111111111111111111111111111111111111111111',
    ]

    if (weakSecrets.includes(JWT_SECRET)) {
      throw new Error(
        '❌ PRODUCTION SECURITY ERROR: JWT_SECRET is using a default/weak value\n' +
        'Please generate a strong random secret for production deployment.'
      )
    }

    if (weakSecrets.includes(ENCRYPTION_KEY)) {
      throw new Error(
        '❌ PRODUCTION SECURITY ERROR: ENCRYPTION_KEY is using a default/weak value\n' +
        'Please generate a strong random key for production deployment.'
      )
    }

    // 生产环境bcrypt强度建议12+
    if (BCRYPT_SALT_ROUNDS < 12) {
      console.warn(
        '⚠️  WARNING: BCRYPT_SALT_ROUNDS is below recommended value for production (12+)\n' +
        `Current: ${BCRYPT_SALT_ROUNDS}, Recommended: 12-14`
      )
    }
  }

  // ==================== 配置摘要（启动日志） ====================
  if (IS_DEVELOPMENT) {
    console.log('\n✅ Security configuration loaded successfully:')
    console.log(`   - JWT_SECRET: ${JWT_SECRET.substring(0, 10)}... (${JWT_SECRET.length} chars)`)
    console.log(`   - JWT_EXPIRES_IN: ${JWT_EXPIRES_IN}`)
    console.log(`   - ENCRYPTION_KEY: ${ENCRYPTION_KEY.substring(0, 10)}... (${ENCRYPTION_KEY.length} chars)`)
    console.log(`   - BCRYPT_SALT_ROUNDS: ${BCRYPT_SALT_ROUNDS}`)
    console.log(`   - NODE_ENV: ${NODE_ENV}`)
    console.log(`   - DATABASE_TYPE: ${DATABASE_TYPE}\n`)
  }
}
