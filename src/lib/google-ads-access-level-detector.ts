/**
 * Google Ads API 访问级别检测器
 * 通过实际调用API来检测Developer Token的访问级别
 */

import { getDatabase } from './db'
import { getGoogleAdsClient } from './google-ads-api'

export type ApiAccessLevel = 'test' | 'explorer' | 'basic' | 'standard'

interface AccessLevelDetectionResult {
  level: ApiAccessLevel
  detectedAt: string
  method: 'api_call' | 'error_pattern' | 'default'
  details?: string
}

/**
 * 从错误消息中检测访问级别
 */
function detectLevelFromError(errorMessage: string): ApiAccessLevel | null {
  const msg = errorMessage.toLowerCase()

  // Test access: 只能访问测试账号
  if (
    msg.includes('only approved for use with test accounts') ||
    msg.includes('developer token is only approved for test') ||
    (msg.includes('developer token') && msg.includes('test') && msg.includes('not approved'))
  ) {
    return 'test'
  }

  // 标准权限提示（部分返回消息可能包含 approved/granted + standard access）
  if (
    msg.includes('standard access')
    && (msg.includes('approved') || msg.includes('granted'))
  ) {
    return 'standard'
  }

  // 如果明确提到需要申请Basic或Standard，说明当前是Explorer或Test
  if (msg.includes('apply for basic') || msg.includes('apply for standard')) {
    // 如果同时提到test account，则是test级别
    if (msg.includes('test account')) {
      return 'test'
    }
    // 否则可能是explorer
    return 'explorer'
  }

  return null
}

/**
 * 通过API调用检测访问级别
 * 策略：尝试调用一个简单的API，根据响应判断访问级别
 */
export async function detectApiAccessLevel(userId: number): Promise<AccessLevelDetectionResult> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  try {
    // 获取用户的 Google Ads 凭证
    const credentials = await db.queryOne<{
      client_id: string
      client_secret: string
      developer_token: string
      refresh_token: string
      api_access_level?: string
    }>(`
      SELECT client_id, client_secret, developer_token, refresh_token, api_access_level
      FROM google_ads_credentials
      WHERE user_id = ?
    `, [userId])

    if (!credentials) {
      throw new Error('未找到 Google Ads 凭证')
    }

    // 获取Google Ads客户端
    const client = getGoogleAdsClient({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      developer_token: credentials.developer_token
    })

    // 尝试获取可访问的客户账户列表
    // 这是一个轻量级的API调用，用于检测权限
    try {
      const response = await client.listAccessibleCustomers(credentials.refresh_token)

      // listAccessibleCustomers 返回 { resource_names: ['customers/123', ...] }
      const resourceNames = response.resource_names || []

      // 如果能成功调用，说明至少有Explorer权限
      // 注意：我们无法直接从API响应中获取确切的访问级别
      // 但可以通过后续的API调用来推断

      // 默认假设是Explorer（最常见的情况）
      // 如果用户有Basic权限，通常不会有问题
      // 如果是Test权限，后续的API调用会失败并被检测到

      const currentLevel = String(credentials.api_access_level || '').toLowerCase()
      const level: ApiAccessLevel =
        currentLevel === 'basic' || currentLevel === 'standard'
          ? currentLevel
          : 'explorer'

      return {
        level,
        detectedAt: now,
        method: 'api_call',
        details: `Successfully listed ${resourceNames.length} accessible customers (resolved as ${level})`
      }
    } catch (apiError: any) {
      // 从错误消息中检测访问级别
      const errorMessage = apiError.message || String(apiError)
      const detectedLevel = detectLevelFromError(errorMessage)

      if (detectedLevel) {
        return {
          level: detectedLevel,
          detectedAt: now,
          method: 'error_pattern',
          details: errorMessage
        }
      }

      // 如果无法从错误中检测，默认返回explorer
      console.warn('无法从API错误中检测访问级别，使用默认值:', errorMessage)
      return {
        level: 'explorer',
        detectedAt: now,
        method: 'default',
        details: 'Could not detect from error, using default'
      }
    }
  } catch (error: any) {
    console.error('检测API访问级别失败:', error)

    // 尝试从错误中检测
    const errorMessage = error.message || String(error)
    const detectedLevel = detectLevelFromError(errorMessage)

    if (detectedLevel) {
      return {
        level: detectedLevel,
        detectedAt: now,
        method: 'error_pattern',
        details: errorMessage
      }
    }

    // 默认返回explorer
    return {
      level: 'explorer',
      detectedAt: now,
      method: 'default',
      details: 'Detection failed, using default'
    }
  }
}

/**
 * 更新用户的API访问级别
 */
export async function updateApiAccessLevel(
  userId: number,
  level: ApiAccessLevel,
  authType: 'oauth' | 'service_account'
): Promise<void> {
  const db = await getDatabase()

  if (authType === 'oauth') {
    await db.exec(`
      UPDATE google_ads_credentials
      SET api_access_level = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `, [level, userId])
  } else {
    const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'
    await db.exec(`
      UPDATE google_ads_service_accounts
      SET api_access_level = ?, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND ${isActiveCondition}
    `, [level, userId])
  }

  console.log(`✅ 已更新用户 ${userId} 的API访问级别: ${level}`)
}

/**
 * 自动检测并更新API访问级别
 * 在验证凭证或API调用失败时调用
 */
export async function autoDetectAndUpdateAccessLevel(
  userId: number,
  authType: 'oauth' | 'service_account'
): Promise<ApiAccessLevel> {
  const result = await detectApiAccessLevel(userId)
  await updateApiAccessLevel(userId, result.level, authType)

  console.log(`🔍 自动检测API访问级别:`, {
    userId,
    level: result.level,
    method: result.method,
    details: result.details
  })

  return result.level
}

/**
 * 从错误消息中检测并更新访问级别
 * 用于在API调用失败时快速更新
 */
export async function detectAndUpdateFromError(
  userId: number,
  authType: 'oauth' | 'service_account',
  errorMessage: string
): Promise<ApiAccessLevel | null> {
  const level = detectLevelFromError(errorMessage)

  if (level) {
    await updateApiAccessLevel(userId, level, authType)
    console.log(`🔍 从错误消息检测到API访问级别: ${level}`)
    return level
  }

  return null
}
