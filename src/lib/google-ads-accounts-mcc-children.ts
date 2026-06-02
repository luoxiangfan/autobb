import { getCustomer } from './google-ads-api'
import { trackApiUsage, ApiOperationType } from './google-ads-api-tracker'
import { extractCustomerIdFromResourceName } from './google-ads-resource-name'
import { upsertAccount } from './google-ads-accounts-cache'
import {
  EMPTY_IDENTITY_VERIFICATION,
  fetchIdentityVerificationSnapshot,
} from './google-ads-accounts-identity-verification'
import { debugLog, extractSearchResults, parseStatus } from './google-ads-accounts-sync-utils'

export type MccChildAccountsSyncContext = {
  userId: number
  credentials: {
    refresh_token?: string
    login_customer_id?: string | null
  }
  authType: 'oauth' | 'service_account'
  serviceAccountConfig: any | null
  isServiceAccount: boolean
  clientId: string
  clientSecret: string
  developerToken: string
  authScope: {
    authType: 'oauth' | 'service_account'
    serviceAccountId: string | null
  }
  accountMap: Map<string, any>
  expandedManagerIds: Set<string>
  pendingManagerIds: string[]
  recordAccount: (accountData: any, dbId: number, last_sync_at: string) => void
}

/**
 * 查询 MCC 下 level=1 子账户，写入缓存并排队嵌套 MCC。
 */
export async function processMccChildAccounts(
  ctx: MccChildAccountsSyncContext,
  managerId: string,
  managerCustomer?: any
): Promise<void> {
  if (!managerId || ctx.expandedManagerIds.has(managerId)) return
  ctx.expandedManagerIds.add(managerId)

  console.log(`   🔍 查询MCC ${managerId} 的子账户...`)

  const childAccountsQuery = `
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.currency_code,
        customer_client.time_zone,
        customer_client.manager,
        customer_client.test_account,
        customer_client.status,
        customer_client.level
      FROM customer_client
      WHERE customer_client.level = 1
    `

  const mccApiStartTime = Date.now()
  let mccApiSuccess = false
  let mccApiErrorMessage: string | undefined
  let mccApiRequestCount = 0

  try {
    const { executeGAQLQueryPython } = await import('@/lib/python-ads-client')

    let customerForQuery = managerCustomer
    if (!ctx.isServiceAccount) {
      if (!customerForQuery || customerForQuery._isPythonProxy) {
        customerForQuery = await getCustomer(
          managerId,
          ctx.credentials.refresh_token ?? '',
          ctx.credentials.login_customer_id ?? null,
          {
            client_id: ctx.clientId,
            client_secret: ctx.clientSecret,
            developer_token: ctx.developerToken,
          },
          ctx.userId
        )
      }
    }

    let childAccountsRaw: any
    if (ctx.isServiceAccount) {
      childAccountsRaw = await executeGAQLQueryPython({
        userId: ctx.userId,
        serviceAccountId: ctx.serviceAccountConfig?.id?.toString?.(),
        customerId: managerId,
        query: childAccountsQuery,
      })
    } else {
      mccApiRequestCount += 1
      childAccountsRaw = await customerForQuery.query(childAccountsQuery)
    }
    const childAccounts = extractSearchResults(childAccountsRaw)
    mccApiSuccess = true

    for (const child of childAccounts) {
      const childId = child.customer_client?.id?.toString()
      if (!childId) continue

      const isChildManager = child.customer_client?.manager || false
      const existingAccount = ctx.accountMap.get(childId)
      const shouldRefresh = !existingAccount || existingAccount.parent_mcc !== managerId
      if (!shouldRefresh) {
        if (isChildManager) {
          ctx.pendingManagerIds.push(childId)
        }
        continue
      }

      const rawChildStatus = child.customer_client?.status
      debugLog(`[DEBUG] Child Account ${childId} raw status:`, rawChildStatus, 'type:', typeof rawChildStatus)
      const parsedChildStatus = parseStatus(rawChildStatus)
      debugLog(`[DEBUG] Child Account ${childId} parsed status:`, parsedChildStatus)

      let childCustomer: any | null = null
      if (!ctx.isServiceAccount && !isChildManager) {
        try {
          childCustomer = await getCustomer(
            childId,
            ctx.credentials.refresh_token ?? '',
            ctx.credentials.login_customer_id ?? null,
            {
              client_id: ctx.clientId,
              client_secret: ctx.clientSecret,
              developer_token: ctx.developerToken,
            },
            ctx.userId
          )
        } catch {
          childCustomer = null
        }
      }

      const identityVerification =
        !isChildManager && parsedChildStatus === 'ENABLED'
          ? await fetchIdentityVerificationSnapshot({
              userId: ctx.userId,
              customerId: childId,
              customer: ctx.isServiceAccount ? undefined : (childCustomer ?? customerForQuery),
              authType: ctx.isServiceAccount ? 'service_account' : 'oauth',
              serviceAccountConfig: ctx.serviceAccountConfig,
            })
          : { ...EMPTY_IDENTITY_VERIFICATION }

      const effectiveChildStatus =
        parsedChildStatus === 'ENABLED' && identityVerification.overdue
          ? 'SUSPENDED'
          : parsedChildStatus
      const identityVerificationCheckedAt =
        !isChildManager && parsedChildStatus === 'ENABLED' ? new Date().toISOString() : null

      let childBalance: number | null = null
      if (!isChildManager) {
        try {
          const childBudgetQuery = `
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

          let childBudgetInfo
          if (ctx.isServiceAccount) {
            const result = await executeGAQLQueryPython({
              userId: ctx.userId,
              serviceAccountId: ctx.serviceAccountConfig?.id?.toString?.(),
              customerId: childId,
              query: childBudgetQuery,
            })
            childBudgetInfo = result.results || []
          } else if (childCustomer) {
            mccApiRequestCount += 1
            childBudgetInfo = extractSearchResults(await childCustomer.query(childBudgetQuery))
          } else {
            childBudgetInfo = []
          }

          if (childBudgetInfo && childBudgetInfo.length > 0) {
            const budget = childBudgetInfo[0].account_budget
            const budgetResourceName = budget?.resource_name || budget?.resourceName
            const billingSetupResourceName = budget?.billing_setup || budget?.billingSetup
            const budgetOwnerCustomerId = extractCustomerIdFromResourceName(budgetResourceName)
            const billingOwnerCustomerId = extractCustomerIdFromResourceName(billingSetupResourceName)

            if (billingOwnerCustomerId && billingOwnerCustomerId !== String(childId)) {
              console.log(
                `      ⚠️ ${childId} billing_setup 归属不匹配，已跳过余额计算 (billingOwner=${billingOwnerCustomerId})`
              )
            } else if (budgetOwnerCustomerId && budgetOwnerCustomerId !== String(childId)) {
              console.log(
                `      ⚠️ ${childId} 预算归属不匹配，已跳过余额计算 (budgetOwner=${budgetOwnerCustomerId})`
              )
            } else {
              const amountServed = Number(budget?.amount_served_micros || 0)
              const spendingLimit = Number(
                budget?.approved_spending_limit_micros || budget?.proposed_spending_limit_micros || 0
              )
              childBalance = spendingLimit > 0 ? spendingLimit - amountServed : null
              console.log(
                `      💰 ${childId} 余额: ${childBalance ? parseFloat((childBalance / 1000000).toFixed(2)) : 'N/A'}`
              )
            }
          }
        } catch (budgetError: any) {
          const errorMsg = budgetError?.message || String(budgetError)
          const isExpectedError =
            errorMsg.includes('CUSTOMER_NOT_ENABLED') ||
            errorMsg.includes('PERMISSION_DENIED') ||
            errorMsg.includes('not yet enabled')
          if (!isExpectedError) {
            console.log(`      ⚠️ ${childId} 无法获取预算信息: ${budgetError?.message || budgetError}`)
          }
        }
      }

      const childData = {
        customer_id: childId,
        descriptive_name: child.customer_client?.descriptive_name || `客户 ${childId}`,
        currency_code: child.customer_client?.currency_code || 'USD',
        time_zone: child.customer_client?.time_zone || 'UTC',
        manager: isChildManager,
        test_account: child.customer_client?.test_account || false,
        status: effectiveChildStatus,
        account_balance: childBalance,
        parent_mcc: managerId,
        identity_verification_program_status: identityVerification.programStatus,
        identity_verification_start_deadline_time: identityVerification.verificationStartDeadlineTime,
        identity_verification_completion_deadline_time: identityVerification.verificationCompletionDeadlineTime,
        identity_verification_overdue: identityVerification.overdue,
        identity_verification_checked_at: identityVerificationCheckedAt,
      }

      const { id: dbId, last_sync_at } = await upsertAccount(ctx.userId, childData, ctx.authScope)
      ctx.recordAccount(childData, dbId, last_sync_at)

      if (isChildManager) {
        ctx.pendingManagerIds.push(childId)
      }

      console.log(`      ↳ ${childId}: ${childData.descriptive_name}`)
    }

    console.log(`   ✓ MCC ${managerId} 共有 ${childAccounts.length} 个子账户`)
  } catch (childError: any) {
    mccApiSuccess = false
    mccApiErrorMessage = childError.message
    console.warn(`   ⚠️ 查询MCC ${managerId} 子账户失败: ${childError.message}`)
  } finally {
    await trackApiUsage({
      userId: ctx.userId,
      operationType: ApiOperationType.SEARCH,
      endpoint: 'getMccChildAccounts',
      customerId: managerId,
      requestCount: Math.max(1, mccApiRequestCount),
      responseTimeMs: Date.now() - mccApiStartTime,
      isSuccess: mccApiSuccess,
      errorMessage: mccApiErrorMessage,
    })
  }
}
