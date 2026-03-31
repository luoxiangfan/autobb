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

import { Customer } from 'google-ads-api'
import { withRetry } from './retry'
import { getCustomerWithCredentials } from './google-ads-api'

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
    const msg = error.errors.map((e: any) => e?.message).filter(Boolean).join('; ')
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
}): Promise<boolean> {
  try {
    const {customerId, campaignId, authType = 'oauth'} = params

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
    const category = 'PAGE_VIEW'  // 不能用 enums.ConversionActionCategory.PAGE_VIEW (值为3)
    const origin = 'WEBSITE'      // 不能用 enums.ConversionOrigin.WEBSITE (值为2)
    const goalResourceName = `customers/${customerId}/campaignConversionGoals/${campaignId}~${category}~${origin}`

    console.log(`   Goal Resource: ${goalResourceName}`)

    // 更新 CampaignConversionGoal，将 biddable 设置为 true
    const campaignConversionGoal: any = {
      resource_name: goalResourceName,
      biddable: true  // 启用该转化目标用于竞价优化
    }

    await withRetry(
      () => customer.campaignConversionGoals.update([campaignConversionGoal]),
      {
        maxRetries: 3,
        initialDelay: 1000,
        // 🔧 性能优化：NOT_FOUND / 权限类错误通常不可通过重试恢复，避免无意义的指数退避等待
        shouldRetry: (error) => {
          if (isNotFoundLikeError(error)) return false
          if (isPermissionLikeError(error)) return false
          return true
        },
        operationName: `Set PAGE_VIEW goal for campaign ${campaignId}`
      }
    )

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

/**
 * 配置Campaign的转化目标为"网页浏览"(PAGE_VIEW)
 *
 * @param customer - Google Ads Customer 对象
 * @param campaignResourceName - Campaign 的 resource_name (格式: customers/{customer_id}/campaigns/{campaign_id})
 * @returns 配置成功返回 true
 */
export async function setCampaignPageViewGoal(
  customer: Customer,
  campaignResourceName: string
): Promise<boolean> {
  try {
    // 从 campaignResourceName 中提取 customer_id 和 campaign_id
    const match = campaignResourceName.match(/customers\/(\d+)\/campaigns\/(\d+)/)
    if (!match) {
      throw new Error(`Invalid campaignResourceName format: ${campaignResourceName}`)
    }

    const customerId = match[1]
    const campaignId = match[2]

    // 🔧 修复(2025-12-30): 使用字符串名称而非枚举数字值
    // 构建 CampaignConversionGoal 的 resource_name
    // 格式: customers/{customer_id}/campaignConversionGoals/{campaign_id}~{category}~{origin}
    const category = 'PAGE_VIEW'  // 不能用 enums.ConversionActionCategory.PAGE_VIEW (值为3)
    const origin = 'WEBSITE'      // 不能用 enums.ConversionOrigin.WEBSITE (值为2)
    const goalResourceName = `customers/${customerId}/campaignConversionGoals/${campaignId}~${category}~${origin}`

    console.log(`🎯 配置Campaign转化目标:`)
    console.log(`   Campaign: ${campaignResourceName}`)
    console.log(`   Goal: PAGE_VIEW + WEBSITE`)
    console.log(`   Resource: ${goalResourceName}`)

    // 更新 CampaignConversionGoal，将 biddable 设置为 true
    const campaignConversionGoal: any = {
      resource_name: goalResourceName,
      biddable: true  // 启用该转化目标用于竞价优化
    }

    await withRetry(
      () => customer.campaignConversionGoals.update([campaignConversionGoal]),
      {
        maxRetries: 3,
        initialDelay: 1000,
        operationName: `Set PAGE_VIEW goal for campaign ${campaignId}`
      }
    )

    console.log(`✅ Campaign转化目标配置成功`)
    return true

  } catch (error: any) {
    // 如果错误是因为 CampaignConversionGoal 不存在，可能需要先创建
    if (error.message?.includes('NOT_FOUND') || error.message?.includes('does not exist')) {
      console.warn(`⚠️ CampaignConversionGoal 不存在，可能需要等待自动创建`)
      console.warn(`   提示：Google Ads 会在 Campaign 创建后自动创建 CampaignConversionGoal`)
      console.warn(`   如果账号已有 PAGE_VIEW 转化操作，稍后会自动生效`)
    } else {
      console.error(`❌ 配置Campaign转化目标失败:`, error.message)
      console.error(`   错误详情:`, JSON.stringify(error, null, 2))
    }

    // 不抛出错误，因为这是一个可选的优化配置
    // Campaign 即使没有显式设置 PAGE_VIEW 也能正常投放
    return false
  }
}

/**
 * 配置账号级别的"网页浏览"转化目标（影响所有Campaign）
 *
 * @param customer - Google Ads Customer 对象
 * @param customerId - Customer ID
 * @returns 配置成功返回 true
 */
export async function setCustomerPageViewGoal(
  customer: Customer,
  customerId: string
): Promise<boolean> {
  try {
    // 🔧 修复(2025-12-30): 使用字符串名称而非枚举数字值
    // 构建 CustomerConversionGoal 的 resource_name
    // 格式: customers/{customer_id}/customerConversionGoals/{category}~{origin}
    const category = 'PAGE_VIEW'  // 不能用 enums.ConversionActionCategory.PAGE_VIEW (值为3)
    const origin = 'WEBSITE'      // 不能用 enums.ConversionOrigin.WEBSITE (值为2)
    const goalResourceName = `customers/${customerId}/customerConversionGoals/${category}~${origin}`

    console.log(`🎯 配置账号级别转化目标:`)
    console.log(`   Customer: ${customerId}`)
    console.log(`   Goal: PAGE_VIEW + WEBSITE`)
    console.log(`   Resource: ${goalResourceName}`)

    // 更新 CustomerConversionGoal，将 biddable 设置为 true
    const customerConversionGoal: any = {
      resource_name: goalResourceName,
      biddable: true  // 启用该转化目标用于竞价优化
    }

    await withRetry(
      () => customer.customerConversionGoals.update([customerConversionGoal]),
      {
        maxRetries: 3,
        initialDelay: 1000,
        operationName: `Set PAGE_VIEW goal for customer ${customerId}`
      }
    )

    console.log(`✅ 账号级别转化目标配置成功`)
    return true

  } catch (error: any) {
    console.error(`❌ 配置账号级别转化目标失败:`, error.message)
    console.error(`   错误详情:`, JSON.stringify(error, null, 2))

    // 不抛出错误，因为这是一个可选的优化配置
    return false
  }
}
