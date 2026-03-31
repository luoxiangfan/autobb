/**
 * Python Google Ads Service 客户端
 * 用于服务账号模式的 Google Ads API 调用
 */
import axios from 'axios'
import { getServiceAccountConfig } from './google-ads-service-account'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'
import { logger } from './structured-logger'

const PYTHON_SERVICE_URL = process.env.PYTHON_ADS_SERVICE_URL || 'http://localhost:8001'

function getPythonRequestHeaders(userId: number, requestId?: string): Record<string, string> {
  return {
    'x-user-id': String(userId),
    ...(requestId ? { 'x-request-id': requestId } : {}),
  }
}

/**
 * 包装 Python API 调用并自动统计
 */
async function withTracking<T>(
  userId: number,
  customerId: string,
  operationType: ApiOperationType,
  endpoint: string,
  requestId: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const startTime = Date.now()
  try {
    const result = await fn()
    logger.info('python_service_call', {
      userId,
      requestId,
      endpoint,
      operationType,
      customerId,
      durationMs: Date.now() - startTime,
      ok: true,
    })
    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: true,
    })
    return result
  } catch (error: any) {
    // 🔧 修复(2025-12-29): 改进 Developer Token 权限错误的诊断信息
    let enhancedError = error
    const stringifyDetail = (detail: unknown): string => {
      if (detail == null) return ''
      if (typeof detail === 'string') return detail
      try {
        return JSON.stringify(detail)
      } catch {
        return String(detail)
      }
    }

    const truncate = (value: string, maxLen: number): string => {
      if (!value) return value
      if (value.length <= maxLen) return value
      return value.slice(0, maxLen) + `... (truncated, len=${value.length})`
    }

    // 避免把 AxiosError（含 request/config/data 等敏感字段）向上抛出
    if (error?.isAxiosError) {
      const status = error?.response?.status
      const pythonRequestId = error?.response?.headers?.['x-request-id']
      const serviceDetail = stringifyDetail(error?.response?.data?.detail) || error?.message || String(error)
      const safeMessage =
        `Python Ads Service 调用失败 (${endpoint})` +
        (status ? ` [status=${status}]` : '') +
        (pythonRequestId ? ` [x-request-id=${pythonRequestId}]` : '') +
        `: ${truncate(serviceDetail, 4000)}`

      const safeError = new Error(safeMessage)
      ;(safeError as any).status = status
      ;(safeError as any).pythonRequestId = pythonRequestId
      ;(safeError as any).endpoint = endpoint
      enhancedError = safeError
    }

    const errorMessage = enhancedError?.message || String(enhancedError)

    if (errorMessage.includes('only approved for use with test accounts')) {
      enhancedError = new Error(
        `❌ Developer Token 权限等级不足 (User #${userId}):\n\n` +
        `您的 Developer Token 仅限于测试账户，但您在访问生产账户。\n\n` +
        `⚠️ 问题: 权限等级太低\n` +
        `✅ 解决方案:\n` +
        `  1. 访问 https://ads.google.com/aw/apicenter\n` +
        `  2. 找到您的 Developer Token\n` +
        `  3. 申请升级到 "Basic" 或 "Standard" 等级\n` +
        `  4. 等待 Google 批准（通常 1-3 个工作日）\n` +
        `  5. 升级完成后系统会自动使用新的权限等级\n\n` +
        `更多信息: 请查看系统诊断文档或联系支持团队。\n\n` +
        `原始错误: ${errorMessage}`
      )
    }

    logger.error(
      'python_service_call',
      {
        userId,
        requestId,
        endpoint,
        operationType,
        customerId,
        durationMs: Date.now() - startTime,
        ok: false,
      },
      enhancedError
    )

    await trackApiUsage({
      userId,
      operationType,
      endpoint,
      customerId,
      responseTimeMs: Date.now() - startTime,
      isSuccess: false,
      errorMessage: enhancedError.message,
    })
    throw enhancedError
  }
}

interface ServiceAccountAuth {
  email: string
  private_key: string
  developer_token: string
  login_customer_id: string
}

function withUserIdInServiceAccount(serviceAccount: ServiceAccountAuth, userId: number) {
  return { ...serviceAccount, user_id: userId } as ServiceAccountAuth & { user_id: number }
}

/**
 * 格式化 Google Ads 客户 ID
 * 移除空格和横杠，确保是10位数字字符串
 */
function formatCustomerId(id: string): string {
  // 移除空格和横杠，然后取前10位
  return id.replace(/[\s-]/g, '').slice(0, 10)
}

/**
 * 检查 Developer Token 是否可能是 Test-level
 *
 * 注意: 这只是启发式检查，不是确定的判断。实际权限由 Google API 决定。
 */
function validateDeveloperToken(token: string): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = []

  if (!token || typeof token !== 'string') {
    return { isValid: false, warnings: ['Developer Token 为空或类型不正确'] }
  }

  if (token.length < 15) {
    warnings.push(
      '⚠️ Developer Token 长度较短（< 15 字符），可能是 Test-level token。\n' +
      '   如果系统报告"权限等级不足"，请升级 Token 的权限等级。'
    )
  }

  // 检查是否包含 test、demo、sandbox 等关键词
  if (/test|demo|sandbox|trial/i.test(token)) {
    warnings.push(
      '⚠️ Developer Token 名称中包含测试相关关键词，可能是 Test-level token。\n' +
      '   如果系统报告"权限等级不足"，请升级 Token 的权限等级。'
    )
  }

  return { isValid: warnings.length === 0, warnings }
}

/**
 * 获取服务账号认证配置
 */
async function getServiceAccountAuth(userId: number, serviceAccountId?: string): Promise<ServiceAccountAuth> {
  const sa = await getServiceAccountConfig(userId, serviceAccountId)
  if (!sa) {
    throw new Error('Service account not found')
  }

  // 🔧 修复(2025-12-29): 验证 Developer Token 权限等级
  const tokenValidation = validateDeveloperToken(sa.developerToken)
  if (tokenValidation.warnings.length > 0) {
    logger.warn('developer_token_warning', {
      userId,
      warnings: tokenValidation.warnings,
    })
  }

  // 🔧 调试：输出 developer_token 信息（避免在默认日志里泄露敏感信息）
  const tokenPreview = sa.developerToken.substring(0, 10) + '...'
  logger.debug('service_account_loaded', {
    userId,
    developerTokenPreview: tokenPreview,
    developerTokenLength: sa.developerToken.length,
    serviceAccountEmail: sa.serviceAccountEmail,
    mccCustomerId: sa.mccCustomerId,
  })

  return {
    email: sa.serviceAccountEmail,
    private_key: sa.privateKey || '',
    developer_token: sa.developerToken,
    // 🔧 修复(2025-12-26): 格式化 login_customer_id，移除空格和横杠
    login_customer_id: formatCustomerId(sa.mccCustomerId),
  }
}

/**
 * 查询关键词历史数据（服务账号模式）
 */
export async function getKeywordHistoricalMetricsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  keywords: string[]
  language: string
  geoTargetConstants: string[]
  requestId?: string
}): Promise<any> {
  return withTracking(params.userId, params.customerId, ApiOperationType.GET_KEYWORD_IDEAS, '/api/keyword-planner/historical-metrics', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/keyword-planner/historical-metrics`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      keywords: params.keywords,
      language: params.language,
      geo_target_constants: params.geoTargetConstants,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data
  })
}

/**
 * 生成关键词建议（服务账号模式）
 */
export async function getKeywordIdeasPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  keywords: string[]
  language: string
  geoTargetConstants: string[]
  pageUrl?: string
  requestId?: string
}): Promise<any> {
  return withTracking(params.userId, params.customerId, ApiOperationType.GET_KEYWORD_IDEAS, '/api/keyword-planner/ideas', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/keyword-planner/ideas`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      keywords: params.keywords,
      language: params.language,
      geo_target_constants: params.geoTargetConstants,
      page_url: params.pageUrl,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data
  })
}

/**
 * 执行 GAQL 查询（服务账号模式）
 */
export async function executeGAQLQueryPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  query: string
  requestId?: string
}): Promise<any> {
  return withTracking(params.userId, params.customerId, ApiOperationType.SEARCH, '/api/google-ads/query', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/query`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      query: params.query,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data
  })
}

/**
 * 获取可访问的客户账户列表（服务账号模式）
 */
export async function listAccessibleCustomersPython(params: {
  userId: number
  serviceAccountId?: string
  requestId?: string
}): Promise<string[]> {
  const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)

  const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/list-accessible-customers`, {
    service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
  }, {
    headers: getPythonRequestHeaders(params.userId, params.requestId),
  })

  return response.data.resource_names
}

/**
 * 获取身份验证信息（服务账号模式）
 */
export async function getIdentityVerificationPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  requestId?: string
}): Promise<any> {
  return withTracking(
    params.userId,
    params.customerId,
    ApiOperationType.SEARCH,
    '/api/google-ads/identity-verification',
    params.requestId,
    async () => {
      const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/identity-verification`, {
        service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
        customer_id: params.customerId,
      }, {
        headers: getPythonRequestHeaders(params.userId, params.requestId),
      })
      return response.data
    }
  )
}

/**
 * 创建广告系列预算（服务账号模式）
 */
export async function createCampaignBudgetPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  name: string
  amountMicros: number
  deliveryMethod: 'STANDARD' | 'ACCELERATED'
  requestId?: string
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign-budget/create', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign-budget/create`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      name: params.name,
      amount_micros: params.amountMicros,
      delivery_method: params.deliveryMethod,
      explicitly_shared: false,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data.resource_name
  })
}

/**
 * 创建广告系列（服务账号模式）
 */
export async function createCampaignPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  name: string
  budgetResourceName: string
  status: 'ENABLED' | 'PAUSED'
  biddingStrategyType: string
  cpcBidCeilingMicros?: number
  targetCountry?: string
  targetLanguage?: string
  startDate?: string
  endDate?: string
  finalUrlSuffix?: string
  requestId?: string
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/create', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/create`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      name: params.name,
      budget_resource_name: params.budgetResourceName,
      status: params.status,
      bidding_strategy_type: params.biddingStrategyType,
      cpc_bid_ceiling_micros: params.cpcBidCeilingMicros,
      target_country: params.targetCountry,
      target_language: params.targetLanguage,
      start_date: params.startDate,
      end_date: params.endDate,
      final_url_suffix: params.finalUrlSuffix,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data.resource_name
  })
}

/**
 * 创建广告组（服务账号模式）
 */
export async function createAdGroupPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  name: string
  status: 'ENABLED' | 'PAUSED'
  cpcBidMicros?: number
  requestId?: string
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/ad-group/create', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/ad-group/create`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      name: params.name,
      status: params.status,
      cpc_bid_micros: params.cpcBidMicros,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data.resource_name
  })
}

/**
 * 批量创建关键词（服务账号模式）
 */
export async function createKeywordsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  adGroupResourceName: string
  keywords: Array<{
    text: string
    matchType: 'BROAD' | 'PHRASE' | 'EXACT'
    status: 'ENABLED' | 'PAUSED'
    finalUrl?: string
    isNegative?: boolean
    negativeKeywordMatchType?: 'BROAD' | 'PHRASE' | 'EXACT'
  }>
  requestId?: string
}): Promise<string[]> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE_BATCH, '/api/google-ads/keywords/create', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/keywords/create`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      ad_group_resource_name: params.adGroupResourceName,
      keywords: params.keywords.map(kw => ({
        text: kw.text,
        match_type: kw.matchType,
        status: kw.status,
        final_url: kw.finalUrl,
        is_negative: kw.isNegative || false,
        negative_keyword_match_type: kw.negativeKeywordMatchType || 'EXACT',
      })),
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data.results.map((r: any) => r.resource_name)
  })
}

/**
 * 创建响应式搜索广告（服务账号模式）
 */
export async function createResponsiveSearchAdPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  adGroupResourceName: string
  headlines: string[]
  descriptions: string[]
  finalUrls: string[]
  finalUrlSuffix?: string
  path1?: string
  path2?: string
  requestId?: string
}): Promise<string> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/responsive-search-ad/create', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/responsive-search-ad/create`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      ad_group_resource_name: params.adGroupResourceName,
      headlines: params.headlines,
      descriptions: params.descriptions,
      final_urls: params.finalUrls,
      final_url_suffix: params.finalUrlSuffix,
      path1: params.path1,
      path2: params.path2,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data.resource_name
  })
}

/**
 * 更新广告系列状态（服务账号模式）
 */
export async function updateCampaignStatusPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED'
  requestId?: string
}): Promise<void> {
  const effectiveStatus = params.status === 'REMOVED' ? 'PAUSED' : params.status
  if (params.status === 'REMOVED') {
    console.warn(`⚠️ 已禁用Google Ads删除操作，改为暂停: ${params.campaignResourceName}`)
  }

  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/update-status', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/update-status`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      status: effectiveStatus,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
  })
}

/**
 * 删除广告系列（服务账号模式）
 */
export async function removeCampaignPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  requestId?: string
}): Promise<void> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/remove', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/remove`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
  })
}

/**
 * 更新广告系列预算（服务账号模式）
 */
export async function updateCampaignBudgetPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  budgetAmountMicros: number
  requestId?: string
}): Promise<void> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/update-budget', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/update-budget`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      budget_amount_micros: params.budgetAmountMicros,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
  })
}

/**
 * 更新广告系列 Final URL Suffix（服务账号模式）
 * 🆕 新增(2025-01-03): 用于换链接任务系统自动更新Campaign的追踪参数
 */
export async function updateCampaignFinalUrlSuffixPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  finalUrlSuffix: string
  requestId?: string
}): Promise<void> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/update-final-url-suffix', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/update-final-url-suffix`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      final_url_suffix: params.finalUrlSuffix,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
  })
}

/**
 * 创建附加宣传信息（服务账号模式）
 */
export async function createCalloutExtensionsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  calloutTexts: string[]
  requestId?: string
}): Promise<string[]> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE_BATCH, '/api/google-ads/callout-extensions/create', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/callout-extensions/create`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      callout_texts: params.calloutTexts,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data.asset_resource_names
  })
}

/**
 * 创建附加链接（服务账号模式）
 */
export async function createSitelinkExtensionsPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  sitelinks: Array<{
    linkText: string
    finalUrl: string
    description1?: string
    description2?: string
  }>
  requestId?: string
}): Promise<string[]> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE_BATCH, '/api/google-ads/sitelink-extensions/create', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    const response = await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/sitelink-extensions/create`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      sitelinks: params.sitelinks.map(sl => ({
        link_text: sl.linkText,
        final_url: sl.finalUrl,
        description1: sl.description1,
        description2: sl.description2,
      })),
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
    return response.data.asset_resource_names
  })
}

// ==================== Conversion Goal Functions Removed ====================
//
// 🔧 移除说明 (2025-12-26):
// - ensureConversionGoalPython: 确保转化目标存在（服务账号模式）
// - updateCampaignConversionGoalPython: 更新CampaignConversionGoal的biddable状态
//
// 原因: 对应的Node.js函数ensureAccountConversionGoal已移除，这些函数不再使用

// ==================== Campaign Update Functions ====================

/**
 * 更新广告系列（服务账号模式）
 * 🔧 新增(2025-12-26): 支持更新任意字段，通过 update_mask 指定
 */
export async function updateCampaignPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  campaignResourceName: string
  // 可选更新字段
  cpcBidMicros?: number  // 手动CPC出价
  maxCpcBidMicros?: number  // Maximize Clicks 最大CPC限制
  targetCpaMicros?: number  // 目标CPA
  status?: 'ENABLED' | 'PAUSED'  // 状态
  requestId?: string
}): Promise<void> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/campaign/update', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/campaign/update`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      campaign_resource_name: params.campaignResourceName,
      cpc_bid_micros: params.cpcBidMicros,
      max_cpc_bid_micros: params.maxCpcBidMicros,
      target_cpa_micros: params.targetCpaMicros,
      status: params.status,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
  })
}

/**
 * 更新广告组（服务账号模式）
 * 🔧 新增(2025-12-26): 支持更新 adgroup 的 cpc_bid_micros
 */
export async function updateAdGroupPython(params: {
  userId: number
  serviceAccountId?: string
  customerId: string
  adGroupResourceName: string
  cpcBidMicros?: number  // 手动CPC出价
  requestId?: string
}): Promise<void> {
  return withTracking(params.userId, params.customerId, ApiOperationType.MUTATE, '/api/google-ads/adgroup/update', params.requestId, async () => {
    const serviceAccount = await getServiceAccountAuth(params.userId, params.serviceAccountId)
    await axios.post(`${PYTHON_SERVICE_URL}/api/google-ads/adgroup/update`, {
      service_account: withUserIdInServiceAccount(serviceAccount, params.userId),
      customer_id: params.customerId,
      ad_group_resource_name: params.adGroupResourceName,
      cpc_bid_micros: params.cpcBidMicros,
    }, {
      headers: getPythonRequestHeaders(params.userId, params.requestId),
    })
  })
}
