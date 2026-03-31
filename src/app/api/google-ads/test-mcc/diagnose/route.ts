import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getGoogleAdsTestCredentials } from '@/lib/google-ads-test-credentials'
import { getGoogleAdsClient } from '@/lib/google-ads-api'
import { formatAndValidateLoginCustomerId } from '@/lib/google-ads-oauth'

export const dynamic = 'force-dynamic'

type DiagnoseRequestBody = {
  probeCustomerId?: string
  maxCustomers?: number
}

function normalizeCustomerId(input: string): string {
  return String(input || '').replace(/[\s-]/g, '')
}

function extractSearchResults(searchResult: any): any[] {
  if (!searchResult) return []
  if (Array.isArray(searchResult)) return searchResult
  if (Array.isArray(searchResult.results)) return searchResult.results
  if (Array.isArray(searchResult.response?.results)) return searchResult.response.results
  return []
}

function classifyErrorMessage(message: string): { code: string; hint?: string } {
  const msg = (message || '').toLowerCase()

  if (msg.includes('developer token is not allowed with project')) {
    return { code: 'DEVELOPER_TOKEN_PROJECT_MISMATCH', hint: 'Developer Token 与 OAuth Client 所属 GCP Project 不匹配' }
  }
  if (msg.includes('developer_token_not_approved') || msg.includes('not approved')) {
    return { code: 'DEVELOPER_TOKEN_NOT_APPROVED', hint: 'Developer Token 可能仍处于测试权限（Test access）或未通过审核' }
  }
  if (msg.includes('permission_denied')) {
    return { code: 'PERMISSION_DENIED', hint: '权限不足（测试权限的 Token 只能访问测试账号，或MCC/客户未授权）' }
  }
  if (msg.includes('invalid_grant')) {
    return { code: 'INVALID_GRANT', hint: 'Refresh Token 失效（需要重新授权）' }
  }
  if (msg.includes('invalid_client')) {
    return { code: 'INVALID_CLIENT', hint: 'Client ID/Secret 无效或不匹配' }
  }
  return { code: 'UNKNOWN' }
}

async function queryCustomerBasicInfo(params: {
  client: any
  refreshToken: string
  customerId: string
  loginCustomerId: string
}): Promise<{
  usedLoginCustomerId: string | null
  row?: any
  error?: { message: string; code: string; hint?: string }
}> {
  const { client, refreshToken, customerId, loginCustomerId } = params

  const query = `
    SELECT
      customer.id,
      customer.descriptive_name,
      customer.manager,
      customer.test_account
    FROM customer
    WHERE customer.id = ${customerId}
  `

  const attempts: Array<string | null> = [loginCustomerId, customerId, null]
  let lastError: any = null

  for (const lcId of attempts) {
    try {
      const customer = lcId
        ? client.Customer({ customer_id: customerId, refresh_token: refreshToken, login_customer_id: lcId })
        : client.Customer({ customer_id: customerId, refresh_token: refreshToken })

      const searchResult = await customer.query(query)
      const rows = extractSearchResults(searchResult)
      return { usedLoginCustomerId: lcId, row: rows[0] }
    } catch (err: any) {
      lastError = err
    }
  }

  const message = lastError?.message || String(lastError)
  const classified = classifyErrorMessage(message)
  return {
    usedLoginCustomerId: null,
    error: { message, code: classified.code, hint: classified.hint }
  }
}

/**
 * POST /api/google-ads/test-mcc/diagnose
 * 使用“测试权限/Test access” MCC 凭证执行只读诊断，不写入 google_ads_accounts / 不影响现有OAuth
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权访问' }, { status: 401 })
    }

    const userId = authResult.user.userId

    let body: DiagnoseRequestBody = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }

    const maxCustomers = Math.min(Math.max(Number(body.maxCustomers || 20), 1), 100)
    const probeCustomerId = body.probeCustomerId ? normalizeCustomerId(body.probeCustomerId) : undefined

    const testCredentials = await getGoogleAdsTestCredentials(userId)
    if (!testCredentials) {
      return NextResponse.json({
        error: '未配置测试OAuth凭证',
        message: '请先在设置页面完成“测试OAuth授权”',
        code: 'TEST_CREDENTIALS_NOT_CONFIGURED'
      }, { status: 404 })
    }

    if (!testCredentials.refresh_token) {
      return NextResponse.json({
        error: '未找到测试Refresh Token',
        message: '请先完成“测试OAuth授权”',
        code: 'TEST_REFRESH_TOKEN_MISSING'
      }, { status: 400 })
    }

    const loginCustomerId = testCredentials.login_customer_id
      ? formatAndValidateLoginCustomerId(testCredentials.login_customer_id, 'test_login_customer_id')
      : ''

    if (!loginCustomerId) {
      return NextResponse.json({
        error: '缺少测试 Login Customer ID',
        message: '请先在设置页面填写 test_login_customer_id 并重新完成测试OAuth授权',
        code: 'TEST_LOGIN_CUSTOMER_ID_MISSING'
      }, { status: 400 })
    }

    const client = getGoogleAdsClient({
      client_id: testCredentials.client_id,
      client_secret: testCredentials.client_secret,
      developer_token: testCredentials.developer_token,
    })

    // 1) listAccessibleCustomers
    const listResp = await client.listAccessibleCustomers(testCredentials.refresh_token)
    const resourceNames: string[] = listResp?.resource_names || []
    const customerIds = resourceNames
      .map(rn => rn.split('/').pop() || '')
      .filter(Boolean)

    // 2) 对可访问客户做只读 GAQL 探测
    const sampledCustomerIds = customerIds.slice(0, maxCustomers)
    const customers: any[] = []

    for (const customerId of sampledCustomerIds) {
      const result = await queryCustomerBasicInfo({
        client,
        refreshToken: testCredentials.refresh_token,
        customerId,
        loginCustomerId,
      })

      if (result.error) {
        customers.push({
          customerId,
          ok: false,
          usedLoginCustomerId: result.usedLoginCustomerId,
          error: result.error,
        })
        continue
      }

      const customer = result.row?.customer
      customers.push({
        customerId,
        ok: true,
        usedLoginCustomerId: result.usedLoginCustomerId,
        descriptiveName: customer?.descriptive_name || null,
        manager: customer?.manager ?? null,
        testAccount: customer?.test_account ?? null,
      })
    }

    const testAccountTrue = customers.filter(c => c.ok && c.testAccount === true).length
    const testAccountFalse = customers.filter(c => c.ok && c.testAccount === false).length
    const okCount = customers.filter(c => c.ok).length
    const errorCount = customers.length - okCount

    // 3) 可选：对用户提供的 probeCustomerId 做一次探测（预期在 test-only token 下可能失败）
    let probe: any = null
    if (probeCustomerId) {
      probe = await queryCustomerBasicInfo({
        client,
        refreshToken: testCredentials.refresh_token,
        customerId: probeCustomerId,
        loginCustomerId,
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        loginCustomerId,
        accessibleCustomers: customerIds,
        sampledCount: customers.length,
        customers,
        probeCustomerId: probeCustomerId || null,
        probe,
        summary: {
          totalAccessible: customerIds.length,
          okCount,
          errorCount,
          testAccountTrue,
          testAccountFalse,
        }
      }
    })
  } catch (error: any) {
    const message = error.message || '未知错误'
    const classified = classifyErrorMessage(message)
    return NextResponse.json(
      {
        error: '测试MCC诊断失败',
        message,
        code: classified.code,
        hint: classified.hint
      },
      { status: 500 }
    )
  }
}

