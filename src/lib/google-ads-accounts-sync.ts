/**
 * 从 Google Ads API 同步可访问账号到数据库
 */
import { getGoogleAdsClient, getCustomer } from './google-ads-api'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'
import { extractCustomerIdFromResourceName } from './google-ads-resource-name'
import { deactivateMissingAccounts, upsertAccount } from './google-ads-accounts-cache'
import {
  EMPTY_IDENTITY_VERIFICATION,
  fetchIdentityVerificationSnapshot,
} from './google-ads-accounts-identity-verification'
import {
  processMccChildAccounts,
  type MccChildAccountsSyncContext,
} from './google-ads-accounts-mcc-children'
import {
  debugLog,
  extractSearchResults,
  formatErrorMessage,
  parseStatus,
} from './google-ads-accounts-sync-utils'
import { assertGoogleAdsAuthReadyForApi } from './google-ads-auth-context'

export async function syncAccountsFromAPI(
  userId: number,
  credentials: any,
  authType: 'oauth' | 'service_account' = 'oauth',
  serviceAccountConfig: any = null
): Promise<any[]> {
  await assertGoogleAdsAuthReadyForApi(userId)

  console.log(`🔄 从 Google Ads API 同步账号...`)
  console.log(`   认证方式: ${authType}`)

  const isServiceAccount = authType === 'service_account' && serviceAccountConfig

  // 🔧 修复(2025-12-12): 独立账号模式 - 每个用户必须有自己的完整凭证
  // 不再回退到管理员配置，确保用户数据完全隔离
  const clientId = credentials.client_id
  const clientSecret = credentials.client_secret
  const developerToken = credentials.developer_token

  if (!clientId || !clientSecret || !developerToken) {
    throw new Error('缺少 Google Ads API 凭证配置，请在设置中完成配置')
  }

  // 创建客户端
  const client = getGoogleAdsClient({
    client_id: clientId,
    client_secret: clientSecret,
    developer_token: developerToken,
  })

  // 🔧 修复(2025-12-26): 服务账号模式使用 Python 服务
  let resourceNames: string[]
  if (isServiceAccount) {
    // 服务账号模式：使用 Python 服务
    console.log(`   🔑 服务账号模式：使用 Python 服务进行认证`)

    try {
      const { listAccessibleCustomersPython } = await import('@/lib/python-ads-client')
      resourceNames = await listAccessibleCustomersPython({
        userId,
        serviceAccountId: serviceAccountConfig.id.toString(),
      })
      console.log(`   ✅ 服务账号认证成功，获取到 ${resourceNames.length} 个账户`)
    } catch (error: unknown) {
      const { formatPythonAdsServiceUnavailableError } = await import('@/lib/python-ads-client')
      const serviceUnavailable = formatPythonAdsServiceUnavailableError(error)
      if (serviceUnavailable) {
        throw new Error(serviceUnavailable)
      }
      console.error(`   ❌ 服务账号认证失败:`, error instanceof Error ? error.message : error)
      const detail = error instanceof Error ? error.message : String(error)
      throw new Error(
        `服务账号认证失败: ${detail}。` +
          `请确保：1) 服务账号邮箱已被添加到 Google Ads MCC 的"访问权限和安全"中；` +
          `2) GCP 项目中已启用 Google Ads API。` +
          `服务账号邮箱: ${serviceAccountConfig.serviceAccountEmail}`
      )
    }
  } else {
    // OAuth 认证模式：使用 google-ads-api
    const response = await client.listAccessibleCustomers(credentials.refresh_token)
    resourceNames = response.resource_names || []
  }

  const customerIds = resourceNames.map((resourceName: string) => {
    const parts = resourceName.split('/')
    return parts[parts.length - 1]
  })

  console.log(`   🔍 API响应: ${resourceNames.length} 个账户`)
  console.log(`   🔍 Resource Names: ${resourceNames.join(', ')}`)
  console.log(`   ✅ 直接可访问账户 (${customerIds.length}个): ${customerIds.join(', ')}`)

  const mccCustomerId = isServiceAccount
    ? serviceAccountConfig.mccCustomerId
    : credentials.login_customer_id
  console.log(`   🔑 Login Customer ID (MCC): ${mccCustomerId || '未设置'}`)

  const accountMap = new Map<string, any>()
  const processedIds = new Set<string>()
  const expandedManagerIds = new Set<string>()
  const pendingManagerIds: string[] = []
  const authScope = {
    authType,
    serviceAccountId:
      authType === 'service_account' ? serviceAccountConfig?.id?.toString?.() || null : null,
  }

  const recordAccount = (accountData: any, dbId: number, last_sync_at: string) => {
    accountMap.set(accountData.customer_id, { ...accountData, db_account_id: dbId, last_sync_at })
    processedIds.add(accountData.customer_id)
  }

  const mccCtx: MccChildAccountsSyncContext = {
    userId,
    credentials,
    authType,
    serviceAccountConfig,
    isServiceAccount: Boolean(isServiceAccount),
    clientId,
    clientSecret,
    developerToken,
    authScope,
    accountMap,
    expandedManagerIds,
    pendingManagerIds,
    recordAccount,
  }

  for (const customerId of customerIds) {
    if (processedIds.has(customerId)) continue

    // API追踪设置
    const apiStartTime = Date.now()
    let apiSuccess = false
    let apiErrorMessage: string | undefined
    let apiRequestCount = 0

    try {
      const basicAccountInfoQuery = `
        SELECT
          customer.id,
          customer.descriptive_name,
          customer.currency_code,
          customer.time_zone,
          customer.manager,
          customer.test_account
        FROM customer
        WHERE customer.id = ${customerId}
      `

      // 🔧 修复(2025-12-25): 服务账号模式自动降级login_customer_id
      // 策略：MCC ID → 子账户ID → null(省略login_customer_id)
      // 原因：根据Google Ads API文档，当直接访问账户(非通过管理账户)时，
      //       login_customer_id应该省略或设置为账户自己的ID
      const loginCustomerIds = isServiceAccount
        ? [serviceAccountConfig.mccCustomerId, customerId, null] // MCC → 子账户 → null
        : [credentials.login_customer_id, customerId, null]

      let customer: any
      let preloadedAccountInfo: any[] | null = null

      // 🔧 修复(2025-12-25): 尝试多个login_customer_id直到成功
      // 重点：每次尝试都需要重新创建客户端，因为@htdangkhoa/google-ads在实例化时固化了login_customer_id
      const loginAttempts: Array<{
        loginCustomerId: string | null
        error: string | null
        success: boolean
      }> = []

      for (const lcId of loginCustomerIds) {
        const lcIdDisplay = lcId || 'null(省略)'
        console.log(`   🔍 尝试使用 login_customer_id: ${lcIdDisplay} 访问账户 ${customerId}`)

        try {
          if (isServiceAccount) {
            // 🔧 修复(2025-12-26): 使用 Python 服务执行 GAQL 查询
            const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
            const testQuery = `SELECT customer.id FROM customer WHERE customer.id = ${customerId} LIMIT 1`

            await executeGAQLQueryPython({
              userId,
              serviceAccountId: serviceAccountConfig.id.toString(),
              customerId: customerId,
              query: testQuery,
            })

            // 如果执行成功，创建一个占位customer对象（后续查询会继续使用Python服务）
            customer = { _isPythonProxy: true, _customerId: customerId }
          } else {
            // OAuth模式：仅创建Customer实例不代表可访问（login_customer_id 不正确时，真正的请求会 PERMISSION_DENIED）
            // 这里用一次轻量 GAQL 查询来验证访问性，并确保后续（含身份验证查询）使用正确的 login_customer_id
            const candidateCustomer = await getCustomer(
              customerId,
              credentials.refresh_token,
              lcId,
              {
                client_id: clientId,
                client_secret: clientSecret,
                developer_token: developerToken,
              },
              userId
            )

            apiRequestCount += 1
            const searchResult = await candidateCustomer.query(basicAccountInfoQuery)
            const results = extractSearchResults(searchResult)
            if (!results || results.length === 0) {
              throw new Error('账户基本信息查询返回空结果')
            }

            customer = candidateCustomer
            preloadedAccountInfo = results
          }

          // 如果执行到这行代码没有抛出异常，说明成功
          loginAttempts.push({ loginCustomerId: lcId, error: null, success: true })
          console.log(`   ✅ 使用 login_customer_id: ${lcIdDisplay} 成功访问账户 ${customerId}`)
          break
        } catch (error: any) {
          void error
          const errorMessage = formatErrorMessage(error) || '未知错误'
          loginAttempts.push({
            loginCustomerId: lcId,
            error: errorMessage,
            success: false,
          })
          console.warn(`   ⚠️ 使用 login_customer_id: ${lcIdDisplay} 失败: ${errorMessage}`)

          // 🆕 检测是否为PERMISSION_DENIED错误
          if (errorMessage.includes('PERMISSION_DENIED')) {
            console.warn(`   🔍 检测到权限错误，记录详细信息用于前端提示`)
          }

          continue // 尝试下一个login_customer_id
        }
      }

      // 如果所有login_customer_id都失败，构建详细的错误信息
      if (!customer) {
        const hasPermissionDenied = loginAttempts.some(
          (attempt) => attempt.error && attempt.error.includes('PERMISSION_DENIED')
        )

        // 🆕 构建用户友好的错误信息
        let friendlyErrorMessage = '无法访问该账户。'

        if (hasPermissionDenied && isServiceAccount) {
          const mccId = isServiceAccount
            ? serviceAccountConfig.mccCustomerId
            : credentials.login_customer_id
          friendlyErrorMessage =
            `服务账号权限不足。\n\n` +
            `问题诊断：\n` +
            `1. 尝试使用MCC账户(${mccId})访问失败 - PERMISSION_DENIED\n` +
            `2. 尝试直接访问子账户(${customerId})也失败\n\n` +
            `可能的原因：\n` +
            `• 服务账号只被添加到子账户，但未添加到MCC账户\n` +
            `• 服务账号在MCC账户中权限不足（需要"标准访问"或"管理员"）\n\n` +
            `解决方案：\n` +
            `1. 登录 Google Ads UI (https://ads.google.com)\n` +
            `2. 切换到MCC账户 ${mccId}\n` +
            `3. 进入"管理" → "访问权限和安全"\n` +
            `4. 添加服务账号邮箱: ${serviceAccountConfig.serviceAccountEmail}\n` +
            `5. 选择权限级别："标准访问"或"管理员"\n` +
            `6. 保存后等待几分钟，然后刷新此页面`
        }

        const enhancedError = new Error(friendlyErrorMessage)
        ;(enhancedError as any).loginAttempts = loginAttempts
        ;(enhancedError as any).isPermissionError = hasPermissionDenied
        ;(enhancedError as any).serviceAccountEmail = isServiceAccount
          ? serviceAccountConfig.serviceAccountEmail
          : null
        ;(enhancedError as any).mccCustomerId = isServiceAccount
          ? serviceAccountConfig.mccCustomerId
          : credentials.login_customer_id

        throw enhancedError
      }

      // 🔧 修复(2025-12-25): 分步查询，先查基本信息，再查 status
      // 有些账户的 status 字段可能有权限问题导致 field_violations 错误
      // 🔧 修复(2025-12-25): 增加详细的错误捕获，处理 field_violations 等解析错误
      // 🔧 修复(2025-12-25): @htdangkhoa/google-ads库的search方法返回结构可能是 { results: [...] }
      let accountInfo: any[]
      let rawStatus: any = 'UNKNOWN'

      try {
        // 先查询基本信息（不包含 status，避免权限问题）
        // 🔧 修复(2025-12-26): 服务账号模式调用Python服务，OAuth模式使用query()
        if (!isServiceAccount && preloadedAccountInfo) {
          accountInfo = preloadedAccountInfo
        } else {
          let searchResult
          if (isServiceAccount) {
            const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
            searchResult = await executeGAQLQueryPython({
              userId,
              serviceAccountId: serviceAccountConfig.id.toString(),
              customerId: customerId,
              query: basicAccountInfoQuery,
            })
          } else {
            apiRequestCount += 1
            searchResult = await customer.query(basicAccountInfoQuery)
          }

          accountInfo = extractSearchResults(searchResult)
        }

        if (accountInfo && accountInfo.length > 0) {
          // 尝试单独查询 status（如果失败也不影响基本信息）
          try {
            const statusQuery = `
              SELECT customer.status
              FROM customer
              WHERE customer.id = ${customerId}
            `
            let statusResult
            if (isServiceAccount) {
              const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
              statusResult = await executeGAQLQueryPython({
                userId,
                serviceAccountId: serviceAccountConfig.id.toString(),
                customerId: customerId,
                query: statusQuery,
              })
            } else {
              apiRequestCount += 1
              statusResult = await customer.query(statusQuery)
            }
            const statusInfo = extractSearchResults(statusResult)
            if (statusInfo && statusInfo.length > 0) {
              rawStatus = statusInfo[0].customer?.status
            }
          } catch (_statusError: any) {
            console.warn(
              `   ⚠️ 账户 ${customerId} status 字段查询失败（权限不足或账户状态异常），使用默认值 UNKNOWN`
            )
          }
        }

        apiSuccess = true // Account query succeeded
      } catch (searchError: any) {
        // 捕获 "No data type found for field_violations.description" 等库解析错误
        console.warn(`   ⚠️ 账户 ${customerId} 基本信息查询失败（可能是账户状态异常或API版本问题）`)
        console.warn(`      原始错误: ${searchError.message}`)

        // 抛出错误让外层 catch 处理，保存为UNKNOWN状态
        throw new Error(`账户查询失败: ${searchError.message || '未知错误'}`)
      }

      if (accountInfo && accountInfo.length > 0) {
        const account = accountInfo[0]
        // rawStatus 已经在上面的 try-catch 中查询并赋值了
        debugLog(`[DEBUG] Account ${customerId} raw status:`, rawStatus, 'type:', typeof rawStatus)
        const parsedStatus = parseStatus(rawStatus)
        debugLog(`[DEBUG] Account ${customerId} parsed status:`, parsedStatus)

        // 查询账户预算信息获取余额
        let accountBalance: number | null = null
        try {
          const budgetQuery = `
            SELECT
              account_budget.resource_name,
              account_budget.billing_setup,
              account_budget.amount_served_micros,
              account_budget.approved_spending_limit_micros,
              account_budget.proposed_spending_limit_micros
            FROM account_budget
            WHERE account_budget.status = 'APPROVED'
            ORDER BY account_budget.id DESC
            LIMIT 1
          `
          // 🔧 修复(2025-12-26): 服务账号模式使用 executeGAQLQueryPython，而不是错误的 customer.search()
          const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')
          const budgetResult = isServiceAccount
            ? await executeGAQLQueryPython({
                userId,
                serviceAccountId: serviceAccountConfig.id.toString(),
                customerId,
                query: budgetQuery,
              })
            : await (async () => {
                apiRequestCount += 1
                return await customer.query(budgetQuery)
              })()
          const budgetInfo = extractSearchResults(budgetResult)
          if (budgetInfo && budgetInfo.length > 0) {
            const budget = budgetInfo[0].account_budget
            const budgetResourceName = budget?.resource_name || budget?.resourceName
            const billingSetupResourceName = budget?.billing_setup || budget?.billingSetup
            const budgetOwnerCustomerId = extractCustomerIdFromResourceName(budgetResourceName)
            const billingOwnerCustomerId =
              extractCustomerIdFromResourceName(billingSetupResourceName)

            // ✅ 更严格的“合并/代付账单”识别：
            // - budget.resource_name 可能仍显示为子账户 customer（导致误判为“每个子账户都有相同余额”）
            // - billing_setup 归属通常能反映真实付款主体（paying manager / consolidated billing）
            if (billingOwnerCustomerId && billingOwnerCustomerId !== String(customerId)) {
              console.log(
                `   ⚠️ ${customerId} billing_setup 归属不匹配，已跳过余额计算 (billingOwner=${billingOwnerCustomerId})`
              )
            } else if (budgetOwnerCustomerId && budgetOwnerCustomerId !== String(customerId)) {
              // 在“Paying manager / consolidated billing”场景下，子账户可能会返回付款管理账号的预算。
              // 这种预算不应被展示为“每个子账户的余额”，否则会出现多个账号显示同一个余额的误导。
              console.log(
                `   ⚠️ ${customerId} 预算归属不匹配，已跳过余额计算 (budgetOwner=${budgetOwnerCustomerId})`
              )
            } else {
              const amountServed = Number(budget?.amount_served_micros || 0)
              const spendingLimit = Number(
                budget?.approved_spending_limit_micros ||
                  budget?.proposed_spending_limit_micros ||
                  0
              )
              // 余额 = 预算 - 已使用
              accountBalance = spendingLimit > 0 ? spendingLimit - amountServed : null
              console.log(
                `   💰 ${customerId} 余额: ${accountBalance ? parseFloat((accountBalance / 1000000).toFixed(2)) : 'N/A'}`
              )
            }
          }
        } catch (_budgetError) {
          console.log(`   ⚠️ ${customerId} 无法获取预算信息（可能账户无预算设置）`)
        }

        // 🔧 修复(2025-12-18): 计算parent_mcc字段
        // 默认使用登录的MCC账户ID；在MCC层级遍历中会更新为真实父级
        const isManagerAccount = account.customer?.manager || false
        const parentMcc = isManagerAccount
          ? null
          : isServiceAccount
            ? serviceAccountConfig.mccCustomerId
            : credentials.login_customer_id

        // 🆕 身份验证（广告主验证）状态：用于识别“因未完成验证导致暂停但 customer.status 仍为 ENABLED”的情况
        const identityVerification =
          !isManagerAccount && parsedStatus === 'ENABLED'
            ? await fetchIdentityVerificationSnapshot({
                userId,
                customerId,
                customer: isServiceAccount ? undefined : customer,
                authType: isServiceAccount ? 'service_account' : 'oauth',
                serviceAccountConfig,
              })
            : { ...EMPTY_IDENTITY_VERIFICATION }

        const effectiveStatus =
          parsedStatus === 'ENABLED' && identityVerification.overdue ? 'SUSPENDED' : parsedStatus
        const identityVerificationCheckedAt =
          !isManagerAccount && parsedStatus === 'ENABLED' ? new Date().toISOString() : null

        const accountData = {
          customer_id: customerId,
          descriptive_name: account.customer?.descriptive_name || `客户 ${customerId}`,
          currency_code: account.customer?.currency_code || 'USD',
          time_zone: account.customer?.time_zone || 'UTC',
          manager: isManagerAccount,
          test_account: account.customer?.test_account || false,
          status: effectiveStatus,
          account_balance: accountBalance,
          parent_mcc: parentMcc, // 🆕 设置parent_mcc：子账户的parent_mcc是MCC账户ID，MCC账户的parent_mcc为null
          identity_verification_program_status: identityVerification.programStatus,
          identity_verification_start_deadline_time:
            identityVerification.verificationStartDeadlineTime,
          identity_verification_completion_deadline_time:
            identityVerification.verificationCompletionDeadlineTime,
          identity_verification_overdue: identityVerification.overdue,
          identity_verification_checked_at: identityVerificationCheckedAt,
        }

        const { id: dbId, last_sync_at } = await upsertAccount(userId, accountData, authScope)
        recordAccount(accountData, dbId, last_sync_at)

        console.log(
          `   ✓ ${customerId}: ${accountData.descriptive_name} (MCC: ${accountData.manager})`
        )

        // 如果是MCC账户，查询其管理的子账户
        if (accountData.manager) {
          await processMccChildAccounts(mccCtx, customerId, customer)
        }
      }
    } catch (accountError: any) {
      apiSuccess = false
      apiErrorMessage = accountError.message || JSON.stringify(accountError)
      console.warn(`   ⚠️ 获取账户 ${customerId} 信息失败:`)
      console.warn(`      错误类型: ${accountError.constructor?.name || typeof accountError}`)
      console.warn(`      错误信息: ${accountError.message || 'No message'}`)
      console.warn(`      错误代码: ${accountError.code || accountError.error_code || 'No code'}`)
      if (accountError.errors && Array.isArray(accountError.errors)) {
        console.warn(`      详细错误 (${accountError.errors.length}个):`)
        accountError.errors.forEach((err: any, idx: number) => {
          console.warn(`        [${idx + 1}] ${err.message || JSON.stringify(err)}`)
        })
      }
      if (accountError.stack) {
        console.warn(`      堆栈: ${accountError.stack.split('\n').slice(0, 3).join('\n      ')}`)
      }

      const fallbackData = {
        customer_id: customerId,
        descriptive_name: `客户 ${customerId}`,
        currency_code: 'USD',
        time_zone: 'UTC',
        manager: false,
        test_account: false,
        status: 'UNKNOWN',
      }
      const { id: dbId, last_sync_at } = await upsertAccount(userId, fallbackData, authScope)
      recordAccount(fallbackData, dbId, last_sync_at)
    } finally {
      // 记录账户查询API使用
      await trackApiUsage({
        userId,
        operationType: ApiOperationType.SEARCH,
        endpoint: 'getAccountInfo',
        customerId,
        requestCount: Math.max(1, apiRequestCount),
        responseTimeMs: Date.now() - apiStartTime,
        isSuccess: apiSuccess,
        errorMessage: apiErrorMessage,
      })
    }
  }

  while (pendingManagerIds.length > 0) {
    const managerId = pendingManagerIds.shift()
    if (!managerId || expandedManagerIds.has(managerId)) continue
    await processMccChildAccounts(mccCtx, managerId)
  }

  // 🔥 清理：如果用户在MCC中解除部分账号关联，API不会返回这些账号
  // 这里将“本次没再出现”的账号标记为 is_active=false，避免继续展示/使用。
  await deactivateMissingAccounts({
    userId,
    authType,
    serviceAccountId: authScope.serviceAccountId,
    seenCustomerIds: processedIds,
  })

  const allAccounts = Array.from(accountMap.values())
  console.log(`✅ 同步完成，共 ${allAccounts.length} 个账户`)
  return allAccounts
}
