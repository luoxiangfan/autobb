/**
 * Google Ads 转化目标配置模块
 *
 * 🎯 功能：配置Campaign级别的转化目标
 * 📋 场景：在创建Campaign后，需要将"网页浏览"(PAGE_VIEW)设置为可竞价(biddable: true)
 *
 * 重要说明：
 * - 默认情况下，PAGE_VIEW + WEBSITE origin 的 biddable = false
 * - 需要手动设置为 true 才能让Campaign优化该转化目标
 */

import { withRetry } from './retry'
import {
  getCustomerWithCredentials,
  resolveAuthTypeForGoogleAdsApiCall,
  type OAuthApiCredentialsFields,
} from './google-ads-api'

function getErrorText(error: any): string {
  if (!error) return ''
  if (typeof error?.message === 'string' && error.message.trim()) return error.message
  try {
    const asString = String(error)
    if (asString && asString !== '[object Object]') return asString
  } catch {
    // ignore
  }
  if (Array.isArray(error?.errors) && error.errors.length > 0) {
    const msg = error.errors
      .map((e: any) => e?.message)
      .filter(Boolean)
      .join('; ')
    if (msg) return msg
  }
  return ''
}

function isNotFoundLikeError(error: any): boolean {
  const text = getErrorText(error).toLowerCase()
  if (!text) return false
  if (text.includes('not_found')) return true
  if (text.includes('does not exist')) return true
  if (text.includes('resource was not found')) return true
  if (text.includes('not found')) return true
  return false
}

function isPermissionLikeError(error: any): boolean {
  const text = getErrorText(error).toLowerCase()
  if (!text) return false
  if (text.includes('permission_denied')) return true
  if (text.includes('permission')) return true
  if (text.includes('not authorized')) return true
  return false
}

/**
 * 配置Campaign的转化目标为"网页浏览"(PAGE_VIEW) - 使用 credentials
 *
 * @param params - 包含 customerId, refreshToken, campaignId 等参数
 * @returns 配置成功返回 true
 */
export async function setCampaignPageViewGoalWithCredentials(params: {
  customerId: string
  refreshToken: string
  campaignId: string
  userId: number
  loginCustomerId?: string
  authType?: 'oauth' | 'service_account'
  serviceAccountId?: string
  credentials?: OAuthApiCredentialsFields
  authContext?: import('./google-ads-auth-context').GoogleAdsAuthContext
}): Promise<boolean> {
  try {
    const { customerId, campaignId } = params
    const authType = await resolveAuthTypeForGoogleAdsApiCall(params)

    console.log(`🎯 配置Campaign转化目标为"网页浏览":`)
    console.log(`   Customer ID: ${customerId}`)
    console.log(`   Campaign ID: ${campaignId}`)
    console.log(`   Auth Type: ${authType}`)

    // 🚫 服务账号模式暂不支持（需要Python服务实现）
    if (authType === 'service_account') {
      console.warn(`⚠️  服务账号模式暂不支持转化目标配置`)
      console.warn(`   提示：可在 Google Ads UI 中手动配置`)
      return false
    }

    // OAuth 模式：使用 getCustomerWithCredentials
    const customer = await getCustomerWithCredentials(params)

    // 🔧 修复(2025-12-30): 使用字符串名称而非枚举数字值
    // 构建 CampaignConversionGoal 的 resource_name
    // 格式: customers/{customer_id}/campaignConversionGoals/{campaign_id}~{category}~{origin}
    // 注意：category 和 origin 必须使用字符串名称，不能使用枚举数字
    const category = 'PAGE_VIEW' // 不能用 enums.ConversionActionCategory.PAGE_VIEW (值为3)
    const origin = 'WEBSITE' // 不能用 enums.ConversionOrigin.WEBSITE (值为2)
    const goalResourceName = `customers/${customerId}/campaignConversionGoals/${campaignId}~${category}~${origin}`

    console.log(`   Goal Resource: ${goalResourceName}`)

    // 更新 CampaignConversionGoal，将 biddable 设置为 true
    const campaignConversionGoal: any = {
      resource_name: goalResourceName,
      biddable: true, // 启用该转化目标用于竞价优化
    }

    await withRetry(() => customer.campaignConversionGoals.update([campaignConversionGoal]), {
      maxRetries: 3,
      initialDelay: 1000,
      // 🔧 性能优化：NOT_FOUND / 权限类错误通常不可通过重试恢复，避免无意义的指数退避等待
      shouldRetry: (error) => {
        if (isNotFoundLikeError(error)) return false
        if (isPermissionLikeError(error)) return false
        return true
      },
      operationName: `Set PAGE_VIEW goal for campaign ${campaignId}`,
    })

    console.log(`✅ Campaign转化目标配置成功 (网页浏览)`)
    return true
  } catch (error: any) {
    // 如果错误是因为 CampaignConversionGoal 不存在
    if (isNotFoundLikeError(error)) {
      console.warn(`⚠️  CampaignConversionGoal 不存在`)
      console.warn(`   原因：账号可能未启用"网页浏览"转化操作`)
      console.warn(`   影响：Campaign 仍可正常投放，但不会优化该转化目标`)
    } else {
      console.error(`❌ 配置Campaign转化目标失败:`, getErrorText(error) || '(unknown error)')
      if (error.errors && Array.isArray(error.errors)) {
        error.errors.forEach((err: any) => {
          console.error(`   - ${err.message}`)
        })
      }
    }

    // 不抛出错误，因为这是一个可选的优化配置
    return false
  }
}
