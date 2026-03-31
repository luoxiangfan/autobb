import { DEFAULT_PARTNERBOOST_BASE_URL } from '@/lib/affiliate-sync-config'

type ValidationResult = {
  platform: 'partnerboost' | 'yeahpromos'
  valid: boolean
  message: string
}

export type AffiliateSyncValidationInput = {
  partnerboostToken?: string | null
  partnerboostBaseUrl?: string | null
  yeahpromosToken?: string | null
  yeahpromosSiteId?: string | null
}

export type AffiliateSyncValidationSummary = {
  valid: boolean
  message: string
  results: ValidationResult[]
}

function trimValue(value: string | null | undefined): string {
  return String(value || '').trim()
}

function buildSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160)
}

async function validatePartnerboostConfig(input: AffiliateSyncValidationInput): Promise<ValidationResult> {
  const token = trimValue(input.partnerboostToken)
  const baseUrl = trimValue(input.partnerboostBaseUrl).replace(/\/+$/, '') || DEFAULT_PARTNERBOOST_BASE_URL

  try {
    const response = await fetch(`${baseUrl}/api/datafeed/get_fba_products`, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        page_size: 1,
        page: 1,
        default_filter: 0,
        country_code: 'US',
        relationship: 1,
        is_original_currency: 0,
        has_promo_code: 0,
        has_acc: 0,
        filter_sexual_wellness: 0,
      }),
      signal: AbortSignal.timeout(10000),
    })

    const text = await response.text().catch(() => '')
    if (!response.ok) {
      return {
        platform: 'partnerboost',
        valid: false,
        message: `PartnerBoost 验证失败：接口返回 ${response.status}${text ? `，${buildSnippet(text)}` : ''}`,
      }
    }

    const payload = text ? JSON.parse(text) as {
      status?: { code?: number | string; msg?: string }
      data?: { list?: unknown[] | Record<string, unknown> }
    } : {}
    const statusCode = Number(payload.status?.code)

    // Log for debugging
    console.log('[PartnerBoost validation] Response:', { statusCode, msg: payload.status?.msg, hasData: !!payload.data })

    if (!Number.isFinite(statusCode) || statusCode !== 0) {
      return {
        platform: 'partnerboost',
        valid: false,
        message: `PartnerBoost 验证失败：${payload.status?.msg || payload.status?.code || '返回状态异常'}`,
      }
    }

    const list = payload.data?.list
    const count = Array.isArray(list)
      ? list.length
      : (list && typeof list === 'object' ? Object.keys(list).length : 0)
    return {
      platform: 'partnerboost',
      valid: true,
      message: `PartnerBoost 验证成功${count > 0 ? `（接口返回 ${count} 条测试记录）` : '（接口可正常访问）'}`,
    }
  } catch (error: any) {
    return {
      platform: 'partnerboost',
      valid: false,
      message: `PartnerBoost 验证失败：${error?.message || '请求异常'}`,
    }
  }
}

async function validateYeahPromosConfig(input: AffiliateSyncValidationInput): Promise<ValidationResult> {
  const token = trimValue(input.yeahpromosToken)
  const siteId = trimValue(input.yeahpromosSiteId)

  try {
    const url = new URL('https://yeahpromos.com/index/getadvert/getadvert')
    url.searchParams.set('site_id', siteId)
    url.searchParams.set('page', '1')
    url.searchParams.set('limit', '1')

    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        token,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      signal: AbortSignal.timeout(10000),
    })

    const text = await response.text().catch(() => '')
    if (!response.ok) {
      return {
        platform: 'yeahpromos',
        valid: false,
        message: `YeahPromos 验证失败：接口返回 ${response.status}${text ? `，${buildSnippet(text)}` : ''}`,
      }
    }

    const payload = text ? JSON.parse(text) as {
      Code?: number | string
      code?: number | string
      Data?: unknown[]
      data?: unknown[]
      Msg?: string
      msg?: string
      status?: string
    } : {}

    const code = payload.Code ?? payload.code
    const codeNum = Number(code)

    // Log for debugging
    console.log('[YeahPromos validation] Response:', { code, codeNum, msg: payload.Msg || payload.msg, status: payload.status })

    // Check if code exists and is not 100000 (success code)
    // If code is undefined/null, treat as success (some responses may not include code field)
    if (code != null && codeNum !== 100000) {
      return {
        platform: 'yeahpromos',
        valid: false,
        message: `YeahPromos 验证失败：${payload.Msg || payload.msg || code}`,
      }
    }

    // Additional check: if status field exists and indicates error
    if (payload.status && String(payload.status).toUpperCase() === 'ERROR') {
      return {
        platform: 'yeahpromos',
        valid: false,
        message: `YeahPromos 验证失败：${payload.Msg || payload.msg || payload.status}`,
      }
    }

    const list = payload.Data || payload.data || []
    const count = Array.isArray(list) ? list.length : 0
    return {
      platform: 'yeahpromos',
      valid: true,
      message: `YeahPromos 验证成功${count > 0 ? `（接口返回 ${count} 条测试记录）` : '（接口可正常访问）'}`,
    }
  } catch (error: any) {
    return {
      platform: 'yeahpromos',
      valid: false,
      message: `YeahPromos 验证失败：${error?.message || '请求异常'}`,
    }
  }
}

export async function validateAffiliateSyncConfig(input: AffiliateSyncValidationInput): Promise<AffiliateSyncValidationSummary> {
  const partnerboostToken = trimValue(input.partnerboostToken)
  const yeahpromosToken = trimValue(input.yeahpromosToken)
  const yeahpromosSiteId = trimValue(input.yeahpromosSiteId)

  const issues: string[] = []
  const tasks: Promise<ValidationResult>[] = []

  if (!partnerboostToken && !yeahpromosToken && !yeahpromosSiteId) {
    return {
      valid: false,
      message: '请先至少保存一组联盟配置（PartnerBoost 或 YeahPromos）',
      results: [],
    }
  }

  if (partnerboostToken) {
    tasks.push(validatePartnerboostConfig(input))
  }

  if (yeahpromosToken || yeahpromosSiteId) {
    if (!yeahpromosToken || !yeahpromosSiteId) {
      issues.push('YeahPromos 验证失败：需要同时填写 Token 和 Site ID')
    } else {
      tasks.push(validateYeahPromosConfig(input))
    }
  }

  const results = tasks.length > 0 ? await Promise.all(tasks) : []
  const messages = [...issues, ...results.map(item => item.message)]
  const valid = issues.length === 0 && results.length > 0 && results.every(item => item.valid)

  return {
    valid,
    message: messages.join('；'),
    results,
  }
}
