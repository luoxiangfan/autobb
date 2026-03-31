import { getDatabase } from './db'
import { encrypt, decrypt } from './crypto'
import { normalizeCountryCode } from './language-country-codes'
import {
  GEMINI_ACTIVE_MODEL,
  getSupportedModelsForProvider,
  normalizeGeminiModel,
} from './gemini-models'
import { estimateTokenCost, recordTokenUsage } from './ai-token-tracker'

export interface SystemSetting {
  id: number
  user_id: number | null
  category: string
  key: string
  value: string | null
  encrypted_value: string | null
  data_type: string
  // 注意：PostgreSQL 返回 boolean 类型，SQLite 返回 0/1 (number)
  is_sensitive: number | boolean
  is_required: number | boolean
  validation_status: string | null
  validation_message: string | null
  last_validated_at: string | null
  default_value: string | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface SettingValue {
  category: string
  key: string
  value: string | null
  dataType: string
  isSensitive: boolean
  isRequired: boolean
  validationStatus?: string | null
  validationMessage?: string | null
  lastValidatedAt?: string | null
  description?: string | null
}

function normalizeSettingValue(category: string, key: string, value: string | null): string | null {
  if (category === 'ai' && key === 'gemini_model') {
    return normalizeGeminiModel(value)
  }

  return value
}

function normalizeInputValue(category: string, key: string, value: string): string {
  if (category === 'ai' && key === 'gemini_model') {
    return normalizeGeminiModel(value)
  }

  // 防止粘贴时带入首尾空白导致 API Key 无效
  if (category === 'ai' && (key === 'gemini_api_key' || key === 'gemini_relay_api_key')) {
    return value.trim()
  }

  return value
}

/**
 * 获取所有系统配置（包括全局和用户级）
 * 优先级：用户配置 > 全局配置
 */
export async function getAllSettings(userId?: number): Promise<SettingValue[]> {
  const db = await getDatabase()

  const query = userId
    ? 'SELECT * FROM system_settings WHERE user_id IS NULL OR user_id = ? ORDER BY category, key'
    : 'SELECT * FROM system_settings WHERE user_id IS NULL ORDER BY category, key'

  const params = userId ? [userId] : []
  const settings = await db.query(query, params) as SystemSetting[]

  // 去重：对于同一个 (category, key) 组合，优先使用用户配置
  const settingsMap = new Map<string, SystemSetting>()
  for (const setting of settings) {
    const mapKey = `${setting.category}:${setting.key}`
    const existing = settingsMap.get(mapKey)

    // 如果不存在，或者当前是用户配置（优先级更高），则更新
    if (!existing || setting.user_id !== null) {
      settingsMap.set(mapKey, setting)
    }
  }

  // 转换为返回格式
  // 注意：PostgreSQL 返回 boolean 类型，SQLite 返回 0/1，需要兼容处理
  return Array.from(settingsMap.values()).map(setting => {
    const isSensitive = setting.is_sensitive === true || setting.is_sensitive === 1
    const rawValue = normalizeSettingValue(setting.category, setting.key, setting.value)
    return {
      category: setting.category,
      key: setting.key,
      value: isSensitive && setting.encrypted_value
        ? decrypt(setting.encrypted_value)
        : rawValue,
      dataType: setting.data_type,
      isSensitive,
      isRequired: setting.is_required === true || setting.is_required === 1,
      validationStatus: setting.validation_status,
      validationMessage: setting.validation_message,
      lastValidatedAt: setting.last_validated_at,
      description: setting.description,
    }
  })
}

/**
 * 获取指定分类的配置
 * 优先级：用户配置 > 全局配置
 */
export async function getSettingsByCategory(category: string, userId?: number): Promise<SettingValue[]> {
  const db = await getDatabase()

  const query = userId
    ? 'SELECT * FROM system_settings WHERE category = ? AND (user_id IS NULL OR user_id = ?) ORDER BY key'
    : 'SELECT * FROM system_settings WHERE category = ? AND user_id IS NULL ORDER BY key'

  const params = userId ? [category, userId] : [category]
  const settings = await db.query(query, params) as SystemSetting[]

  // 去重：对于同一个 key，优先使用用户配置
  const settingsMap = new Map<string, SystemSetting>()
  for (const setting of settings) {
    const existing = settingsMap.get(setting.key)

    // 如果不存在，或者当前是用户配置（优先级更高），则更新
    if (!existing || setting.user_id !== null) {
      settingsMap.set(setting.key, setting)
    }
  }

  // 转换为返回格式
  // 注意：PostgreSQL 返回 boolean 类型，SQLite 返回 0/1，需要兼容处理
  return Array.from(settingsMap.values()).map(setting => {
    const isSensitive = setting.is_sensitive === true || setting.is_sensitive === 1
    const rawValue = normalizeSettingValue(setting.category, setting.key, setting.value)
    return {
      category: setting.category,
      key: setting.key,
      value: isSensitive && setting.encrypted_value
        ? decrypt(setting.encrypted_value)
        : rawValue,
      dataType: setting.data_type,
      isSensitive,
      isRequired: setting.is_required === true || setting.is_required === 1,
      validationStatus: setting.validation_status,
      validationMessage: setting.validation_message,
      lastValidatedAt: setting.last_validated_at,
      description: setting.description,
    }
  })
}

/**
 * 获取指定分类的用户级配置（严格不回退到全局）
 */
export async function getUserOnlySettingsByCategory(category: string, userId: number): Promise<SettingValue[]> {
  if (!userId || userId <= 0) {
    return []
  }

  const db = await getDatabase()
  const settings = await db.query(
    'SELECT * FROM system_settings WHERE category = ? AND user_id = ? ORDER BY key',
    [category, userId]
  ) as SystemSetting[]

  return settings.map(setting => {
    const isSensitive = setting.is_sensitive === true || setting.is_sensitive === 1
    const rawValue = normalizeSettingValue(setting.category, setting.key, setting.value)
    return {
      category: setting.category,
      key: setting.key,
      value: isSensitive && setting.encrypted_value
        ? decrypt(setting.encrypted_value)
        : rawValue,
      dataType: setting.data_type,
      isSensitive,
      isRequired: setting.is_required === true || setting.is_required === 1,
      validationStatus: setting.validation_status,
      validationMessage: setting.validation_message,
      lastValidatedAt: setting.last_validated_at,
      description: setting.description,
    }
  })
}

/**
 * 获取单个配置项
 */
export async function getSetting(category: string, key: string, userId?: number): Promise<SettingValue | null> {
  const db = await getDatabase()

  // 注意：PostgreSQL 中 ORDER BY user_id DESC 会把 NULL 排在最前面
  // 我们需要用户配置优先于全局配置，所以使用 NULLS LAST
  const query = userId
    ? 'SELECT * FROM system_settings WHERE category = ? AND key = ? AND (user_id IS NULL OR user_id = ?) ORDER BY user_id DESC NULLS LAST LIMIT 1'
    : 'SELECT * FROM system_settings WHERE category = ? AND key = ? AND user_id IS NULL LIMIT 1'

  const params = userId ? [category, key, userId] : [category, key]
  const setting = await db.queryOne(query, params) as SystemSetting | undefined

  if (!setting) return null

  // 自动迁移：已下线模型统一映射到 Gemini 3 Flash Preview
  const rawValue = normalizeSettingValue(setting.category, setting.key, setting.value)

  // 注意：PostgreSQL 返回 boolean 类型，SQLite 返回 0/1，需要兼容处理
  const isSensitive = setting.is_sensitive === true || setting.is_sensitive === 1

  let value: string | null = rawValue
  if (isSensitive && setting.encrypted_value) {
    const decrypted = decrypt(setting.encrypted_value)
    if (decrypted === null) {
      console.error(`[settings] 解密失败: category=${setting.category}, key=${setting.key}, user_id=${userId || 'global'}`)
      // 解密失败时返回 null，让调用方知道配置不可用
      value = null
    } else {
      value = decrypted
    }
  }

  return {
    category: setting.category,
    key: setting.key,
    value,
    dataType: setting.data_type,
    isSensitive,
    isRequired: setting.is_required === true || setting.is_required === 1,
    validationStatus: setting.validation_status,
    validationMessage: setting.validation_message,
    lastValidatedAt: setting.last_validated_at,
    description: setting.description,
  }
}

/**
 * 获取用户级配置项（不回退到全局配置）
 *
 * 重要：此函数只返回用户自己的配置，不会返回全局配置
 * 用于需要严格用户隔离的场景（如AI配置）
 *
 * @param category - 配置分类
 * @param key - 配置键
 * @param userId - 用户ID（必需）
 * @returns 用户级配置值，如果用户没有配置则返回 null
 */
export async function getUserOnlySetting(category: string, key: string, userId: number): Promise<SettingValue | null> {
  if (!userId || userId <= 0) {
    throw new Error('getUserOnlySetting requires a valid userId')
  }

  const db = await getDatabase()

  // 只查询用户级配置，不包含全局配置（user_id IS NULL）
  const query = 'SELECT * FROM system_settings WHERE category = ? AND key = ? AND user_id = ? LIMIT 1'
  const params = [category, key, userId]

  const setting = await db.queryOne(query, params) as SystemSetting | undefined

  if (!setting) return null

  // 自动迁移：已下线模型统一映射到 Gemini 3 Flash Preview
  const rawValue = normalizeSettingValue(setting.category, setting.key, setting.value)

  // 注意：PostgreSQL 返回 boolean 类型，SQLite 返回 0/1，需要兼容处理
  const isSensitive = setting.is_sensitive === true || setting.is_sensitive === 1

  let value: string | null = rawValue
  if (isSensitive && setting.encrypted_value) {
    const decrypted = decrypt(setting.encrypted_value)
    if (decrypted === null) {
      console.error(`[settings] 解密失败: category=${setting.category}, key=${setting.key}, user_id=${userId || 'global'}`)
      // 解密失败时返回 null，让调用方知道配置不可用
      value = null
    } else {
      value = decrypted
    }
  }

  return {
    category: setting.category,
    key: setting.key,
    value,
    dataType: setting.data_type,
    isSensitive,
    isRequired: setting.is_required === true || setting.is_required === 1,
    validationStatus: setting.validation_status,
    validationMessage: setting.validation_message,
    lastValidatedAt: setting.last_validated_at,
    description: setting.description,
  }
}

/**
 * 更新配置项
 */
export async function updateSetting(
  category: string,
  key: string,
  value: string,
  userId?: number
): Promise<void> {
  const normalizedValue = normalizeInputValue(category, key, value)

  const db = await getDatabase()

  // 获取配置元数据（从全局模板获取字段定义）
  const metadata = await db.queryOne(`
    SELECT * FROM system_settings
    WHERE category = ? AND key = ? AND user_id IS NULL
    LIMIT 1
  `, [category, key]) as SystemSetting | undefined

  if (!metadata) {
    throw new Error(`配置项不存在: ${category}.${key}`)
  }

  // 确定是否需要加密
  // 注意：PostgreSQL 返回 boolean 类型，SQLite 返回 0/1，需要兼容处理
  const isSensitive = metadata.is_sensitive === true || metadata.is_sensitive === 1

  // 🔥 阻止保存空的敏感字段（防止加密空字符串导致验证失败）
  if (isSensitive && (!normalizedValue || normalizedValue.trim() === '')) {
    throw new Error(`敏感字段 ${category}.${key} 不能为空`)
  }

  const configValue = isSensitive ? null : normalizedValue
  const encryptedValue = isSensitive ? encrypt(normalizedValue) : null

  // 检查是否已存在用户级配置
  if (userId) {
    const userSetting = await db.queryOne(`
      SELECT id FROM system_settings
      WHERE category = ? AND key = ? AND user_id = ?
    `, [category, key, userId]) as { id: number } | undefined

    if (userSetting) {
      // 更新现有用户配置
      await db.exec(`
        UPDATE system_settings
        SET value = ?, encrypted_value = ?, updated_at = datetime('now')
        WHERE id = ?
      `, [configValue, encryptedValue, userSetting.id])
    } else {
      // 创建新的用户配置
      await db.exec(`
        INSERT INTO system_settings (
          user_id, category, key, value, encrypted_value,
          data_type, is_sensitive, is_required, description
        )
        SELECT ?, category, key, ?, ?, data_type, is_sensitive, is_required, description
        FROM system_settings
        WHERE category = ? AND key = ? AND user_id IS NULL
      `, [userId, configValue, encryptedValue, category, key])
    }
  } else {
    // 更新全局配置
    await db.exec(`
      UPDATE system_settings
      SET value = ?, encrypted_value = ?, updated_at = datetime('now')
      WHERE category = ? AND key = ? AND user_id IS NULL
    `, [configValue, encryptedValue, category, key])
  }
}

/**
 * 批量更新配置
 */
export async function updateSettings(
  updates: Array<{ category: string; key: string; value: string }>,
  userId?: number
): Promise<void> {
  // Note: Without native transaction support in the abstraction, we execute sequentially
  // Consider adding transaction support to the database abstraction layer if needed
  for (const update of updates) {
    await updateSetting(update.category, update.key, update.value, userId)
  }
}

/**
 * 清空用户级配置（不影响全局模板配置）
 *
 * 说明：
 * - 仅删除 user_id 对应的配置行（user_id IS NULL 的模板行保留）
 * - 用于“删除配置”场景，确保数据库中对应用户配置彻底清空
 */
export async function clearUserSettings(
  category: string,
  keys: string[],
  userId: number
): Promise<{ cleared: number }> {
  if (!userId || userId <= 0) {
    throw new Error('clearUserSettings requires a valid userId')
  }
  if (!category || !Array.isArray(keys) || keys.length === 0) {
    return { cleared: 0 }
  }

  const db = await getDatabase()
  let cleared = 0

  await db.transaction(async () => {
    for (const key of keys) {
      const result = await db.exec(
        'DELETE FROM system_settings WHERE user_id = ? AND category = ? AND key = ?',
        [userId, category, key]
      )
      cleared += result.changes
    }
  })

  return { cleared }
}

/**
 * 更新配置验证状态
 */
export async function updateValidationStatus(
  category: string,
  key: string,
  status: 'valid' | 'invalid' | 'pending',
  message?: string,
  userId?: number
): Promise<void> {
  const db = await getDatabase()

  const query = userId
    ? `UPDATE system_settings
       SET validation_status = ?, validation_message = ?, last_validated_at = datetime('now'), updated_at = datetime('now')
       WHERE category = ? AND key = ? AND user_id = ?`
    : `UPDATE system_settings
       SET validation_status = ?, validation_message = ?, last_validated_at = datetime('now'), updated_at = datetime('now')
       WHERE category = ? AND key = ? AND user_id IS NULL`

  const params = userId
    ? [status, message || null, category, key, userId]
    : [status, message || null, category, key]

  await db.exec(query, params)
}

/**
 * 验证结果缓存
 * 结构: Map<credentialsHash, { result, timestamp }>
 */
interface ValidationCacheEntry {
  result: { valid: boolean; message: string }
  timestamp: number
}

const validationCache = new Map<string, ValidationCacheEntry>()
const CACHE_TTL = 15 * 60 * 1000 // 15分钟缓存

/**
 * 生成credentials的哈希key（用于缓存）
 */
function generateCredentialsHash(
  clientId: string,
  clientSecret: string,
  developerToken: string
): string {
  // 简单的哈希：使用前10个字符避免完整存储敏感信息
  const hash = `${clientId.substring(0, 20)}_${clientSecret.substring(0, 10)}_${developerToken.substring(0, 10)}`
  return hash
}

/**
 * 清理过期的缓存条目
 */
function cleanExpiredCache(): void {
  const now = Date.now()
  for (const [key, entry] of validationCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      validationCache.delete(key)
    }
  }
}

/**
 * 验证Google Ads API配置
 *
 * 验证步骤：
 * 1. 检查缓存
 * 2. 基础格式验证
 * 3. 尝试创建GoogleAdsApi实例
 * 4. 验证OAuth配置（可选：测试client credentials）
 * 5. 缓存成功结果
 */
export async function validateGoogleAdsConfig(
  clientId: string,
  clientSecret: string,
  developerToken: string
): Promise<{ valid: boolean; message: string }> {
  try {
    const looksLikeOAuthClientId = (value: string) => value.includes('.apps.googleusercontent.com')
    const looksLikeOAuthClientSecret = (value: string) => /^GOCSPX[-_]?/i.test(value.trim())
    const looksLikeOAuthAccessToken = (value: string) => /^ya29\./i.test(value.trim())

    // 清理过期缓存
    cleanExpiredCache()

    // 检查缓存
    const cacheKey = generateCredentialsHash(clientId, clientSecret, developerToken)
    const cached = validationCache.get(cacheKey)
    if (cached) {
      const age = Date.now() - cached.timestamp
      if (age < CACHE_TTL) {
        console.log(`[Google Ads验证] 使用缓存结果 (缓存时间: ${Math.floor(age / 1000)}秒前)`)
        return cached.result
      }
    }

    // Step 1: 基础验证
    if (!clientId || !clientSecret || !developerToken) {
      return {
        valid: false,
        message: '所有字段都是必填的',
      }
    }

    // Step 2: 格式验证
    // Client ID格式: xxx.apps.googleusercontent.com
    if (!looksLikeOAuthClientId(clientId)) {
      return {
        valid: false,
        message: 'Client ID格式不正确，应包含 .apps.googleusercontent.com',
      }
    }

    // Client Secret格式验证
    if (clientSecret.length < 20) {
      return {
        valid: false,
        message: 'Client Secret格式不正确，长度过短',
      }
    }

    // 🧯 防误填：developer_token 常被误填为 client_secret / client_id / access_token
    // 典型误填：developer_token 以 GOCSPX- 开头（这通常是 OAuth Client Secret）
    if (developerToken.trim() === clientSecret.trim()) {
      return {
        valid: false,
        message: 'Developer Token 与 Client Secret 相同，疑似误填。Developer Token 需从 Google Ads API Center 获取。',
      }
    }
    if (looksLikeOAuthClientId(developerToken)) {
      return {
        valid: false,
        message: 'Developer Token 看起来像 Client ID（包含 .apps.googleusercontent.com），请填写 Google Ads Developer Token。',
      }
    }
    if (looksLikeOAuthClientSecret(developerToken)) {
      return {
        valid: false,
        message: 'Developer Token 看起来像 Client Secret（以 GOCSPX- 开头），请在 Google Ads API Center 获取正确的 Developer Token。',
      }
    }
    if (looksLikeOAuthAccessToken(developerToken)) {
      return {
        valid: false,
        message: 'Developer Token 看起来像 Access Token（以 ya29. 开头），请填写 Google Ads Developer Token。',
      }
    }

    // Developer Token格式验证（通常是32位字符，可能包含-）
    if (developerToken.length < 20) {
      return {
        valid: false,
        message: 'Developer Token格式不正确，长度过短',
      }
    }

    // Step 3: 尝试创建GoogleAdsApi实例（验证配置能否被库接受）
    try {
      // 使用统一的 getGoogleAdsClient 验证配置
      const { getGoogleAdsClient } = await import('./google-ads-api')

      const testClient = getGoogleAdsClient({
        client_id: clientId,
        client_secret: clientSecret,
        developer_token: developerToken,
      })

      // 如果能成功创建实例，说明配置格式被google-ads-api库接受
      if (!testClient) {
        return {
          valid: false,
          message: '无法创建Google Ads API客户端',
        }
      }
    } catch (error: any) {
      return {
        valid: false,
        message: `Google Ads API客户端创建失败: ${error.message}`,
      }
    }

    // Step 4: 验证OAuth URL能否正确生成
    try {
      const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-ads/callback`

      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/adwords',
        access_type: 'offline',
        prompt: 'consent',
      })

      const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

      // 验证URL格式
      new URL(oauthUrl)
    } catch (error: any) {
      return {
        valid: false,
        message: `OAuth URL生成失败: ${error.message}`,
      }
    }

    // Step 5: 可选 - 验证client credentials（测试client_id和client_secret是否有效）
    // 注意：这个步骤会实际调用Google OAuth服务器
    try {
      const testTokenEndpoint = 'https://oauth2.googleapis.com/token'

      // 使用无效的授权码尝试，如果client_id/client_secret无效，会返回特定错误
      const testResponse = await fetch(testTokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: 'invalid_code_for_testing',
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/auth/google-ads/callback`,
          grant_type: 'authorization_code',
        }),
      })

      const testResult = await testResponse.json()

      // 分析错误类型
      if (testResult.error === 'invalid_client') {
        return {
          valid: false,
          message: 'Client ID或Client Secret无效，请检查配置',
        }
      }

      // 其他错误（如invalid_grant）说明client凭证是有效的
      // 只是授权码无效，这是预期行为
    } catch (error: any) {
      // 网络错误或其他问题，不影响验证结果
      console.warn('OAuth服务器测试失败（不影响验证）:', error.message)
    }

    // 所有验证通过
    const successResult = {
      valid: true,
      message: '✅ 配置验证通过！下一步请进行Google Ads账号授权。',
    }

    // 缓存成功结果
    validationCache.set(cacheKey, {
      result: successResult,
      timestamp: Date.now(),
    })
    console.log(`[Google Ads验证] 验证成功，结果已缓存 (TTL: ${CACHE_TTL / 1000}秒)`)

    return successResult
  } catch (error: any) {
    return {
      valid: false,
      message: `验证失败: ${error.message}`,
    }
  }
}

/**
 * 验证Gemini API密钥和模型（直接API模式）
 * @param apiKey - API密钥
 * @param model - 模型名称
 * @param userId - 用户ID（必需，用于调用AI服务）
 */
export async function validateGeminiConfig(
  apiKey: string,
  model: string = GEMINI_ACTIVE_MODEL,
  userId: number,
  provider?: string  // 🔧 关键修复(2025-12-30): 新增 provider 参数，用于验证未保存配置
): Promise<{ valid: boolean; message: string }> {
  // Step 1: 基础验证
  if (!apiKey) {
    return {
      valid: false,
      message: 'API密钥不能为空',
    }
  }

  if (apiKey.length < 20) {
    return {
      valid: false,
      message: 'API密钥格式不正确',
    }
  }

  // Step 2: 验证模型名称（按服务商）
  const normalizedProvider = provider === 'relay' ? 'relay' : 'official'
  const normalizedModel = normalizeGeminiModel(model)
  const validModels = getSupportedModelsForProvider(normalizedProvider)
  if (!validModels.includes(normalizedModel)) {
    return {
      valid: false,
      message: `服务商 ${normalizedProvider} 不支持模型: ${model}。支持的模型: ${validModels.join(', ')}`,
    }
  }

  // Step 3: 实际API测试
  try {
    const { generateContent } = await import('./gemini-axios')

    // 🔧 关键修复(2025-12-30): 使用临时配置覆盖参数
    // 避免 generateContent → getGeminiApiKey 从数据库读取空值
    const overrideConfig = provider ? {
      provider,
      apiKey
    } : undefined

    // 使用选择的模型进行测试（使用用户级AI配置）
    // 注意：Gemini 2.5+ 模型有"思考"功能，思考过程可能占用大量tokens
    // 为了确保有足够的输出空间，设置maxOutputTokens为1000
    const validationResult = await generateContent({
      model: normalizedModel,
      prompt: 'Say "OK" if you can hear me.',
      temperature: 0.1,
      maxOutputTokens: 4096, // 🔧 修复(2025-12-11): 增加token限制以容纳思考过程和实际输出
    }, userId, overrideConfig)

    if (validationResult.usage) {
      const cost = estimateTokenCost(
        validationResult.model,
        validationResult.usage.inputTokens,
        validationResult.usage.outputTokens
      )
      await recordTokenUsage({
        userId,
        model: validationResult.model,
        operationType: 'connection_test',
        inputTokens: validationResult.usage.inputTokens,
        outputTokens: validationResult.usage.outputTokens,
        totalTokens: validationResult.usage.totalTokens,
        cost,
        apiType: 'direct-api',
      })
    }

    return {
      valid: true,
      message: `✅ ${normalizedModel} 模型验证成功（直接API模式），连接正常`,
    }
  } catch (error: any) {
    // API调用失败，分析错误类型
    const errorMessage = error.message || '未知错误'

    if (errorMessage.includes('API_KEY_INVALID') || errorMessage.includes('invalid key') || errorMessage.includes('400')) {
      return {
        valid: false,
        message: 'API密钥无效，请检查密钥是否正确',
      }
    }

    if (errorMessage.includes('quota') || errorMessage.includes('limit')) {
      return {
        valid: false,
        message: 'API密钥配额已用尽或达到速率限制',
      }
    }

    const isDnsResolutionError = errorMessage.includes('ENOTFOUND') || errorMessage.includes('EAI_AGAIN')
    if (isDnsResolutionError) {
      return {
        valid: false,
        message: '网络DNS解析失败，请检查服务器网络/DNS配置，或调整第三方中转域名后重试',
      }
    }

    if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      return {
        valid: false,
        message: '网络连接失败，请检查代理配置或稍后重试',
      }
    }

    if (errorMessage.includes('404') || errorMessage.includes('not found')) {
      return {
        valid: false,
        message: `模型 ${normalizedModel} 不可用或不存在`,
      }
    }

    return {
      valid: false,
      message: `API验证失败: ${errorMessage}`,
    }
  }
}

// 代理URL配置项接口
interface ProxyUrlConfig {
  country: string
  url: string
}

const PROXY_COUNTRY_ALIAS_MAP: Readonly<Record<string, string[]>> = {
  GB: ['UK'],
  UK: ['GB'],
}

function resolveProxyCountryCandidates(country: string): string[] {
  const raw = String(country || '').trim()
  if (!raw) return []

  const rawUpper = raw.toUpperCase()
  const normalized = normalizeCountryCode(raw)
  const candidates = new Set<string>()

  if (normalized) candidates.add(normalized)
  if (rawUpper) candidates.add(rawUpper)

  const addAliases = (code: string) => {
    const aliases = PROXY_COUNTRY_ALIAS_MAP[code]
    if (!aliases) return
    for (const alias of aliases) {
      if (alias) candidates.add(alias)
    }
  }

  if (normalized) addAliases(normalized)
  if (rawUpper && rawUpper !== normalized) addAliases(rawUpper)

  return Array.from(candidates)
}

function expandProxyUrlCountries(proxyUrls: ProxyUrlConfig[]): ProxyUrlConfig[] {
  const expanded: ProxyUrlConfig[] = []
  const seen = new Set<string>()

  for (const item of proxyUrls) {
    const rawCountry = String(item?.country || '').trim()
    const url = String(item?.url || '')
    if (!rawCountry || !url) continue

    const countryCandidates = resolveProxyCountryCandidates(rawCountry)
    const finalCandidates = countryCandidates.length > 0 ? countryCandidates : [rawCountry.toUpperCase()]

    for (const country of finalCandidates) {
      const key = `${country}\u0000${url}`
      if (seen.has(key)) continue
      seen.add(key)
      expanded.push({ country, url })
    }
  }

  return expanded
}

/**
 * 获取指定国家的代理URL
 * 如果没有找到对应国家的代理，返回第一个配置的URL作为兜底
 *
 * @param targetCountry - 目标国家代码 (如 'US', 'UK', 'DE' 等)
 * @param userId - 用户ID
 * @returns 代理URL或undefined（如果未配置代理）
 */
export async function getProxyUrlForCountry(targetCountry: string, userId?: number): Promise<string | undefined> {
  const proxyUrls = await getAllProxyUrls(userId)
  if (!proxyUrls || proxyUrls.length === 0) {
    return undefined
  }

  // 查找匹配的国家（支持 UK/GB 等别名）
  const countryCandidates = new Set(resolveProxyCountryCandidates(targetCountry))
  const matched = proxyUrls.find(item =>
    countryCandidates.has(String(item.country || '').trim().toUpperCase())
  )

  if (matched) {
    return matched.url
  }

  // 没有找到匹配的国家，返回第一个作为兜底
  return proxyUrls[0].url
}

/**
 * 检查是否启用了代理
 * 只要配置了有效的代理URL即代表启用
 *
 * @param userId - 用户ID
 * @returns 是否启用代理
 */
export async function isProxyEnabled(userId?: number): Promise<boolean> {
  const setting = await getSetting('proxy', 'urls', userId)

  if (!setting?.value) {
    return false
  }

  try {
    const proxyUrls: ProxyUrlConfig[] = JSON.parse(setting.value)
    return Array.isArray(proxyUrls) && proxyUrls.length > 0 && proxyUrls.some(item => item.url.trim() !== '')
  } catch {
    return false
  }
}

/**
 * 获取所有配置的代理URL列表
 *
 * @param userId - 用户ID
 * @returns 代理URL配置列表
 */
export async function getAllProxyUrls(userId?: number): Promise<ProxyUrlConfig[]> {
  const setting = await getSetting('proxy', 'urls', userId)

  if (!setting?.value) {
    return []
  }

  try {
    const proxyUrls: ProxyUrlConfig[] = JSON.parse(setting.value)
    if (!Array.isArray(proxyUrls) || proxyUrls.length === 0) {
      return []
    }
    return expandProxyUrlCountries(proxyUrls)
  } catch {
    return []
  }
}

/**
 * 获取Gemini Model实例（用于直接API调用）
 * 用于需要使用GoogleGenerativeAI SDK的场景
 *
 * @param userId - 用户ID（可选）
 * @returns GoogleGenerativeAI实例
 */
export async function getGeminiModel(userId?: number) {
  const apiKeySetting = await getSetting('ai', 'gemini_api_key', userId)

  if (!apiKeySetting?.value) {
    throw new Error(
      'Gemini API密钥未配置。请在设置页面配置 Gemini API 密钥。'
    )
  }

  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  return new GoogleGenerativeAI(apiKeySetting.value)
}
