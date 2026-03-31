'use client'

/**
 * Step 4: Publish Summary and Confirmation
 * 汇总信息、确认发布
 *
 * v2.1 - 两列布局：左侧发布选项/按钮，右侧发布结果
 */

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Rocket, CheckCircle2, AlertCircle, Loader2, TrendingUp, Settings, Link2 } from 'lucide-react'
import { CURRENCY_SYMBOLS } from '@/lib/currency'

interface Props {
  offer: any
  selectedCreative: any
  campaignConfig: any
  selectedAccount: any
  selectedAccounts?: any[]
  onPublishComplete: () => void
  onGoBackToStep3: () => void  // 🔥 新增：返回第3步的回调函数
}

export default function Step4PublishSummary({
  offer,
  selectedCreative,
  campaignConfig,
  selectedAccount,
  selectedAccounts = [],
  onPublishComplete,
  onGoBackToStep3  // 🔥 新增：返回第3步的回调函数
}: Props) {
  const accountsToPublish = (Array.isArray(selectedAccounts) && selectedAccounts.length > 0)
    ? selectedAccounts
    : (selectedAccount ? [selectedAccount] : [])
  const primaryAccount = accountsToPublish[0] || selectedAccount

  const [pauseOldCampaigns, setPauseOldCampaigns] = useState(false)
  const [enableCampaignImmediately, setEnableCampaignImmediately] = useState(false)  // 默认不启用
  const [publishing, setPublishing] = useState(false)
  const [needsReauth, setNeedsReauth] = useState(false)
  const [reauthMessage, setReauthMessage] = useState<string>('')

  // 🔥 新增：Google Ads API 限流状态
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    retryAfter: number  // 等待秒数
    message: string
  } | null>(null)
  const [accountPublishResults, setAccountPublishResults] = useState<Array<{
    accountId: number
    customerId: string
    accountName: string
    status: 'success' | 'failed' | 'warning' | 'pending_confirmation'
    confirmationAction?: 'force_publish' | 'pause_old_campaigns'
    message: string
  }>>([])
  const [batchConfirmState, setBatchConfirmState] = useState<{
    forcePublishAccountIds: number[]
    pauseOldCampaignAccountIds: number[]
  }>({
    forcePublishAccountIds: [],
    pauseOldCampaignAccountIds: [],
  })

  const BULK_PUBLISH_CONCURRENCY = 3

  // 🔧 修复(2025-12-24): 获取正确的货币符号
  const accountCurrency = primaryAccount?.currencyCode || 'USD'
  const currencySymbol = CURRENCY_SYMBOLS[accountCurrency] || '$'

  const toNonEmptyStringArray = (value: any): string[] => {
    if (!Array.isArray(value)) return []
    return value
      .map((v: any) => (typeof v === 'string' ? v : String(v ?? '')).trim())
      .filter((v: string) => v.length > 0)
  }

  const getCalloutText = (callout: any): string => {
    if (typeof callout === 'string') return callout
    if (callout && typeof callout === 'object' && typeof callout.text === 'string') return callout.text
    return ''
  }

  const toCalloutTextArray = (value: any): string[] => {
    if (!Array.isArray(value)) return []
    return value
      .map((c: any) => getCalloutText(c).trim())
      .filter((c: string) => c.length > 0)
  }

  const toKeywordTextArray = (value: any): string[] => {
    if (!Array.isArray(value)) return []
    return value
      .map((kw: any) => {
        if (typeof kw === 'string') return kw
        if (kw && typeof kw === 'object') return kw.text || kw.keyword || ''
        return ''
      })
      .map((v: any) => String(v ?? '').trim())
      .filter((v: string) => v.length > 0)
  }

  const getSitelinkText = (sitelink: any): string => {
    if (typeof sitelink === 'string') return sitelink
    if (sitelink && typeof sitelink === 'object' && typeof sitelink.text === 'string') return sitelink.text
    return ''
  }

  const getSitelinkUrl = (sitelink: any): string => {
    if (sitelink && typeof sitelink === 'object' && typeof sitelink.url === 'string') return sitelink.url
    return ''
  }

  const getSitelinkDescription = (sitelink: any): string => {
    if (sitelink && typeof sitelink === 'object' && typeof sitelink.description === 'string') return sitelink.description
    return ''
  }

  // Step 3 配置优先：Step 4 预览应展示“实际将要发布”的内容，而不是Step 1原始创意
  const effectiveHeadlines = toNonEmptyStringArray(campaignConfig?.headlines).length > 0
    ? toNonEmptyStringArray(campaignConfig?.headlines)
    : toNonEmptyStringArray(selectedCreative?.headlines)

  const effectiveDescriptions = toNonEmptyStringArray(campaignConfig?.descriptions).length > 0
    ? toNonEmptyStringArray(campaignConfig?.descriptions)
    : toNonEmptyStringArray(selectedCreative?.descriptions)

  const effectiveKeywords = toKeywordTextArray(campaignConfig?.keywords).length > 0
    ? toKeywordTextArray(campaignConfig?.keywords)
    : toKeywordTextArray(selectedCreative?.keywords)

  const campaignConfigCallouts = toCalloutTextArray(campaignConfig?.callouts)
  const selectedCreativeCallouts = toCalloutTextArray(selectedCreative?.callouts)
  const effectiveCallouts = campaignConfigCallouts.length > 0
    ? campaignConfigCallouts
    : selectedCreativeCallouts

  const effectiveSitelinks = Array.isArray(campaignConfig?.sitelinks) && campaignConfig.sitelinks.length > 0
    ? campaignConfig.sitelinks
    : (Array.isArray(selectedCreative?.sitelinks) ? selectedCreative.sitelinks : [])

  const parseApiError = (data: any): { message: string; needsReauth: boolean; isRateLimited: boolean; retryAfter?: number } => {
    const needsReauthFlag =
      data?.needsReauth === true ||
      data?.code === 'OAUTH_TOKEN_EXPIRED' ||
      data?.error?.code === 'OAUTH_TOKEN_EXPIRED' ||
      data?.error?.code === 'GADS_4005' || // GADS_CREDENTIALS_EXPIRED
      data?.error?.code === 'GADS_4006' || // GADS_CREDENTIALS_INVALID
      data?.error?.details?.needsReauth === true

    // 🔥 新增：检测 Google Ads API 限流错误 (429)
    const isRateLimitedFlag =
      data?.error?.code === 429 ||
      data?.code === 'ERR_BAD_RESPONSE' ||
      (typeof data?.detail === 'string' && data.detail.includes('429')) ||
      (typeof data?.detail === 'string' && data.detail.includes('exhausted')) ||
      (typeof data?.detail === 'string' && data.detail.includes('Too many requests'))

    // 🔥 新增：解析重试时间（秒）
    let retryAfter: number | undefined
    if (isRateLimitedFlag) {
      // 从错误信息中提取重试时间
      const retryMatch = data?.detail?.match(/Retry in (\d+) seconds/)
      if (retryMatch) {
        retryAfter = parseInt(retryMatch[1], 10)
      } else {
        // 如果没有明确的重试时间，给一个默认值
        retryAfter = 3600 // 默认 1 小时
      }
    }

    const message =
      isRateLimitedFlag
        ? 'Google Ads API 调用次数已达今日上限，请稍后再试'
        : (typeof data?.message === 'string' && data.message) ||
          (typeof data?.error === 'string' && data.error) ||
          (typeof data?.error?.message === 'string' && data.error.message) ||
          (typeof data?.error?.error?.message === 'string' && data.error.error.message) ||
          (typeof data?.error?.details?.reason === 'string' && data.error.details.reason) ||
          '发布失败'

    return { message, needsReauth: needsReauthFlag, isRateLimited: isRateLimitedFlag, retryAfter }
  }

  // 🔥 新增：调试日志 - 追踪selectedCreative中的否定关键词
  console.log(`[Step4] selectedCreative ID: ${selectedCreative.id}`)
  console.log(`[Step4] selectedCreative.negativeKeywords存在: ${!!selectedCreative.negativeKeywords}`)
  console.log(`[Step4] selectedCreative.negativeKeywords长度: ${selectedCreative.negativeKeywords?.length || 0}`)
  console.log(`[Step4] selectedCreative.negativeKeywords示例: ${selectedCreative.negativeKeywords?.slice(0, 5).join(', ') || 'NONE'}`)

  // 🔧 修复(2026-01-05): 添加warnings字段支持
  const [publishStatus, setPublishStatus] = useState<{
    step: string
    message: string
    success: boolean
  } | null>(null)

  // 🔥 新增：发布流程步骤记录
  const [publishSteps, setPublishSteps] = useState<Array<{
    step: string
    message: string
    status: 'pending' | 'running' | 'success' | 'failed' | 'warning'
    timestamp?: Date
  }>>([])

  // 🔥 新增：发布结果模式（点击发布后切换）
  const [showPublishResult, setShowPublishResult] = useState(false)

  // 🔥 新增：用于“超时后继续检查”的Campaign IDs
  const [lastPublishCampaignIds, setLastPublishCampaignIds] = useState<number[]>([])

  // 🔥 新增(2025-12-19)：Launch Score评分结果（成功时显示）
  const [launchScoreSuccess, setLaunchScoreSuccess] = useState<{
    totalScore: number
    breakdown: any
    overallRecommendations: string[]
  } | null>(null)

  // 🔥 新增：Launch Score 阻止详情
  const [launchScoreBlockDetails, setLaunchScoreBlockDetails] = useState<{
    launchScore: number
    threshold: number
    breakdown: any
    issues: string[]
    suggestions: string[]
    overallRecommendations: string[]  // 🔧 新增：整体建议字段
    canForcePublish?: boolean  // 🔥 新增：是否可以强制发布（40-80分时为true）
  } | null>(null)

  // 🔥 新增：确认暂停对话框相关state
  const [showPauseConfirm, setShowPauseConfirm] = useState(false)
  const [existingCampaigns, setExistingCampaigns] = useState<any[]>([])
  const [pauseConfirmMessage, setPauseConfirmMessage] = useState('')

  // 🔥 新增：强制发布确认对话框
  const [showForcePublishConfirm, setShowForcePublishConfirm] = useState(false)

  // 🔥 辅助函数：添加/更新发布步骤
  const addPublishStep = (step: string, message: string, status: 'pending' | 'running' | 'success' | 'failed' | 'warning') => {
    setPublishSteps(prev => {
      const existing = prev.find(s => s.step === step)
      if (existing) {
        return prev.map(s => s.step === step ? { ...s, message, status, timestamp: new Date() } : s)
      }
      return [...prev, { step, message, status, timestamp: new Date() }]
    })
  }

  const addServerWarnings = (warnings: unknown) => {
    const warningMessages = Array.isArray(warnings)
      ? warnings.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : []

    if (warningMessages.length > 0) {
      addPublishStep('warnings', `提示: ${warningMessages.join('; ').replace(/\[警告\]\s*/g, '')}`, 'warning')
    }
  }

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

  const getPollDelayMs = (elapsedMs: number) => {
    if (elapsedMs < 15_000) return 1000
    if (elapsedMs < 60_000) return 2000
    return 5000
  }

  const pollCampaignCreationStatus = async (campaignIds: number[], opts?: { maxWaitMs?: number }) => {
    const maxWaitMs = typeof opts?.maxWaitMs === 'number' ? opts.maxWaitMs : 180_000
    const startedAt = Date.now()
    const campaignStatuses: Record<number, { status: 'success' | 'failed'; error?: string }> = {}

    while (Date.now() - startedAt < maxWaitMs) {
      const elapsedMs = Date.now() - startedAt
      await sleep(getPollDelayMs(elapsedMs))

      let hasPending = false
      for (const campaignId of campaignIds) {
        if (campaignStatuses[campaignId]) continue

        try {
          const statusRes = await fetch(`/api/offers/${offer.id}/campaigns/status?campaignId=${campaignId}`, {
            credentials: 'include',
            cache: 'no-store'
          })

          if (!statusRes.ok) {
            hasPending = true
            continue
          }

          const statusData = await statusRes.json()
          const campaign = statusData?.campaign

          if (!campaign) {
            hasPending = true
            continue
          }

          if (campaign.creation_status === 'synced') {
            campaignStatuses[campaignId] = {
              status: 'success',
              error: campaign.creation_error
            }
            continue
          }

          if (campaign.creation_status === 'failed') {
            campaignStatuses[campaignId] = {
              status: 'failed',
              error: campaign.creation_error
            }
            continue
          }

          hasPending = true
        } catch (e) {
          console.warn(`   查询Campaign ${campaignId}失败:`, e)
          hasPending = true
        }
      }

      if (!hasPending) break
    }

    const pendingIds = campaignIds.filter(id => !campaignStatuses[id])
    const failedIds = Object.entries(campaignStatuses)
      .filter(([_, s]) => s.status === 'failed')
      .map(([id]) => Number(id))
    const successIds = Object.entries(campaignStatuses)
      .filter(([_, s]) => s.status === 'success')
      .map(([id]) => Number(id))

    const failedDetails = failedIds.map((campaignId) => ({
      campaignId,
      error: campaignStatuses[campaignId]?.error,
    }))

    const warnings = Object.values(campaignStatuses)
      .filter(s => s.status === 'success' && s.error?.includes('[警告]'))
      .map(s => s.error!)
      .filter(Boolean)

    return { campaignStatuses, pendingIds, failedIds, failedDetails, successIds, warnings, elapsedMs: Date.now() - startedAt }
  }

  const addCampaignPublishFailureDetails = (
    failedDetails: Array<{ campaignId: number; error?: string }>,
    opts?: { maxDetails?: number }
  ) => {
    const maxDetails = typeof opts?.maxDetails === 'number' ? opts.maxDetails : 5
    const detailsToShow = failedDetails.slice(0, maxDetails)

    for (const detail of detailsToShow) {
      const errorText = (detail.error || '未知错误').trim()
      addPublishStep(
        `failed_campaign_${detail.campaignId}`,
        `Campaign ${detail.campaignId} 发布失败：${errorText}`,
        'failed'
      )
    }

    if (failedDetails.length > maxDetails) {
      addPublishStep(
        'failed_more',
        `还有 ${failedDetails.length - maxDetails} 个广告系列失败；可在 Campaign 列表中查看每个 Campaign 的失败原因（creation_error）。`,
        'warning'
      )
    }

    const hasPolicyViolation = failedDetails.some(d => typeof d.error === 'string' && d.error.includes('政策违规'))
    if (hasPolicyViolation) {
      addPublishStep(
        'failed_policy_hint',
        '建议：删除/替换触发政策的关键词或文案；如有相关授权/资质，请在 Google Ads 提交豁免/申诉后再重试发布。',
        'warning'
      )
    }
  }

  const getAccountLabel = (account: any) => {
    const name = account?.accountName || '广告账号'
    const id = account?.customerId || account?.id || '-'
    return `${name} (${id})`
  }

  const resolveAccountsByIds = (accountIds: number[]) => {
    const idSet = new Set(accountIds.map((id) => Number(id)))
    return accountsToPublish.filter((account: any) => idSet.has(Number(account.id)))
  }

  const upsertAccountPublishResult = (result: {
    accountId: number
    customerId: string
    accountName: string
    status: 'success' | 'failed' | 'warning' | 'pending_confirmation'
    confirmationAction?: 'force_publish' | 'pause_old_campaigns'
    message: string
  }) => {
    setAccountPublishResults(prev => {
      const idx = prev.findIndex(item => item.accountId === result.accountId)
      if (idx === -1) return [...prev, result]
      const next = [...prev]
      next[idx] = result
      return next
    })
  }

  const mapResultStatusToStepStatus = (
    status: 'success' | 'failed' | 'warning' | 'pending_confirmation'
  ): 'success' | 'failed' | 'warning' => {
    if (status === 'success') return 'success'
    if (status === 'failed') return 'failed'
    return 'warning'
  }

  const buildBatchSummary = (results: Array<{
    accountId: number
    status: 'success' | 'failed' | 'warning' | 'pending_confirmation'
    confirmationAction?: 'force_publish' | 'pause_old_campaigns'
  }>) => {
    const successCount = results.filter(item => item.status === 'success').length
    const warningCount = results.filter(item => item.status === 'warning').length
    const failedCount = results.filter(item => item.status === 'failed').length
    const forcePublishAccountIds = results
      .filter(item => item.status === 'pending_confirmation' && item.confirmationAction === 'force_publish')
      .map(item => item.accountId as number)
    const pauseOldCampaignAccountIds = results
      .filter(item => item.status === 'pending_confirmation' && item.confirmationAction === 'pause_old_campaigns')
      .map(item => item.accountId as number)
    const pendingConfirmCount = forcePublishAccountIds.length + pauseOldCampaignAccountIds.length

    return {
      successCount,
      warningCount,
      failedCount,
      forcePublishAccountIds,
      pauseOldCampaignAccountIds,
      pendingConfirmCount,
    }
  }

  const publishSingleAccount = async (
    account: any,
    opts?: { forcePublish?: boolean; pauseOldCampaignsOverride?: boolean }
  ): Promise<{
    accountId: number
    customerId: string
    accountName: string
    status: 'success' | 'failed' | 'warning' | 'pending_confirmation'
    confirmationAction?: 'force_publish' | 'pause_old_campaigns'
    message: string
  }> => {
    const accountId = Number(account?.id)
    const customerId = String(account?.customerId || '')
    const accountName = String(account?.accountName || '广告账号')

    try {
      const forcePublish = opts?.forcePublish === true
      const pauseOldCampaignsValue =
        typeof opts?.pauseOldCampaignsOverride === 'boolean'
          ? opts.pauseOldCampaignsOverride
          : pauseOldCampaigns

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: accountId,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: pauseOldCampaignsValue,
          enableCampaignImmediately: enableCampaignImmediately,
          forcePublish,
        })
      })

      const data = await response.json()
      const apiError = parseApiError(data)

      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        const threshold = Number(data?.details?.threshold || 40)
        return { accountId, customerId, accountName, status: 'failed', message: `投放评分过低，需要≥${threshold}分` }
      }

      if (response.status === 422 && data.action === 'LAUNCH_SCORE_WARNING') {
        if (!forcePublish) {
          return {
            accountId,
            customerId,
            accountName,
            status: 'pending_confirmation',
            confirmationAction: 'force_publish',
            message: '投放评分偏低，待确认是否强制发布'
          }
        }
        return { accountId, customerId, accountName, status: 'failed', message: '投放评分偏低且无法强制发布' }
      }

      if (response.status === 422 && data.action === 'CONFIRM_PAUSE_OLD_CAMPAIGNS') {
        if (!pauseOldCampaignsValue && !forcePublish) {
          return {
            accountId,
            customerId,
            accountName,
            status: 'pending_confirmation',
            confirmationAction: 'pause_old_campaigns',
            message: '检测到旧广告系列，待确认是否暂停后发布'
          }
        }
        return {
          accountId,
          customerId,
          accountName,
          status: 'failed',
          message: '检测到旧广告系列，需先勾选“暂停所有旧广告系列”后重试'
        }
      }

      if (response.status === 409) {
        const errorMessage = data.message || data.error?.error?.message || 'Ads账号冲突'
        return { accountId, customerId, accountName, status: 'failed', message: errorMessage }
      }

      if (!response.ok) {
        if (apiError.needsReauth || response.status === 401) {
          return { accountId, customerId, accountName, status: 'failed', message: 'Google Ads 授权已过期，请重新授权后重试' }
        }
        if (apiError.isRateLimited) {
          setIsRateLimited(true)
          setRateLimitInfo({
            retryAfter: apiError.retryAfter || 3600,
            message: apiError.message
          })
          return { accountId, customerId, accountName, status: 'warning', message: apiError.message }
        }
        return { accountId, customerId, accountName, status: 'failed', message: apiError.message }
      }

      if (response.status === 202) {
        addServerWarnings(data.warnings)

        const campaignIds: number[] = data.campaigns?.map((c: any) => c.id) || []
        if (campaignIds.length === 0) {
          return { accountId, customerId, accountName, status: 'warning', message: '任务已提交，但未返回Campaign列表' }
        }

        const { pendingIds, failedIds, failedDetails, successIds, warnings } = await pollCampaignCreationStatus(campaignIds)

        if (failedIds.length > 0) {
          const firstFailedMessage = failedDetails[0]?.error || '未知错误'
          return {
            accountId,
            customerId,
            accountName,
            status: 'failed',
            message: `${failedIds.length} 个Campaign失败：${firstFailedMessage}`
          }
        }

        if (pendingIds.length > 0) {
          return {
            accountId,
            customerId,
            accountName,
            status: 'warning',
            message: `同步超时，已完成 ${successIds.length}/${campaignIds.length}`
          }
        }

        if (warnings.length > 0) {
          return {
            accountId,
            customerId,
            accountName,
            status: 'warning',
            message: `发布成功（含警告）：${warnings.join('; ').replace(/\[警告\]\s*/g, '')}`
          }
        }
      }

      return { accountId, customerId, accountName, status: 'success', message: '发布成功' }
    } catch (error: any) {
      return { accountId, customerId, accountName, status: 'failed', message: error.message || '发布失败' }
    }
  }

  const executeBatchPublish = async (
    targetAccounts: any[],
    opts?: { forcePublish?: boolean; pauseOldCampaignsOverride?: boolean }
  ) => {
    const results: Array<{
      accountId: number
      customerId: string
      accountName: string
      status: 'success' | 'failed' | 'warning' | 'pending_confirmation'
      confirmationAction?: 'force_publish' | 'pause_old_campaigns'
      message: string
    }> = []

    const total = targetAccounts.length
    const concurrency = Math.max(1, Math.min(BULK_PUBLISH_CONCURRENCY, total))
    let nextIndex = 0

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const currentIndex = nextIndex
        nextIndex += 1
        if (currentIndex >= total) break

        const account = targetAccounts[currentIndex]
        const accountLabel = getAccountLabel(account)
        const stepKey = `account_${account.id}`
        addPublishStep(stepKey, `正在发布：${accountLabel}`, 'running')

        const result = await publishSingleAccount(account, opts)
        results.push(result)
        upsertAccountPublishResult(result)
        addPublishStep(stepKey, `${accountLabel}：${result.message}`, mapResultStatusToStepStatus(result.status))
      }
    })

    await Promise.all(workers)
    return results
  }

  const finalizeBatchPublishStatus = (results: Array<{
    accountId: number
    customerId: string
    accountName: string
    status: 'success' | 'failed' | 'warning' | 'pending_confirmation'
    confirmationAction?: 'force_publish' | 'pause_old_campaigns'
    message: string
  }>) => {
    const summary = buildBatchSummary(results)
    const preparingStepStatus: 'success' | 'warning' | 'failed' =
      summary.failedCount === accountsToPublish.length
        ? 'failed'
        : (summary.failedCount > 0 || summary.pendingConfirmCount > 0)
          ? 'warning'
          : 'success'

    addPublishStep('preparing', `发布准备完成（${accountsToPublish.length} 个账号）`, preparingStepStatus)

    setBatchConfirmState({
      forcePublishAccountIds: summary.forcePublishAccountIds,
      pauseOldCampaignAccountIds: summary.pauseOldCampaignAccountIds,
    })

    addPublishStep(
      'summary',
      `发布完成：成功 ${summary.successCount}，警告 ${summary.warningCount}，失败 ${summary.failedCount}，待确认 ${summary.pendingConfirmCount}`,
      (summary.failedCount > 0 || summary.pendingConfirmCount > 0) ? 'warning' : 'success'
    )

    if (
      summary.failedCount === 0
      && summary.pendingConfirmCount === 0
      && (summary.successCount + summary.warningCount) === accountsToPublish.length
    ) {
      const completedMessage = summary.warningCount > 0
        ? `全部 ${accountsToPublish.length} 个账号发布完成（${summary.warningCount} 个账号含警告）`
        : `全部 ${summary.successCount} 个账号发布成功`
      setPublishStatus({
        step: 'completed',
        message: completedMessage,
        success: true
      })
      onPublishComplete()
      return
    }

    if (summary.successCount === 0 && summary.warningCount === 0 && summary.pendingConfirmCount === 0) {
      setPublishStatus({
        step: 'failed',
        message: `全部 ${summary.failedCount} 个账号发布失败`,
        success: false
      })
      return
    }

    const pendingParts: string[] = []
    if (summary.forcePublishAccountIds.length > 0) pendingParts.push(`低分待强制 ${summary.forcePublishAccountIds.length}`)
    if (summary.pauseOldCampaignAccountIds.length > 0) pendingParts.push(`旧系列待确认 ${summary.pauseOldCampaignAccountIds.length}`)

    setPublishStatus({
      step: 'partial',
      message: `部分成功：成功 ${summary.successCount}，警告 ${summary.warningCount}，失败 ${summary.failedCount}${pendingParts.length > 0 ? `，${pendingParts.join('，')}` : ''}`,
      success: false
    })

    if (summary.successCount > 0) {
      onPublishComplete()
    }
  }

  const handleMultiAccountPublish = async () => {
    try {
      setPublishing(true)
      setShowPublishResult(true)
      setPublishSteps([])
      setAccountPublishResults([])
      setBatchConfirmState({
        forcePublishAccountIds: [],
        pauseOldCampaignAccountIds: [],
      })
      setLaunchScoreBlockDetails(null)
      setNeedsReauth(false)
      setIsRateLimited(false)
      setRateLimitInfo(null)

      addPublishStep('preparing', `准备发布到 ${accountsToPublish.length} 个账号...`, 'running')
      setPublishStatus({
        step: 'preparing',
        message: `准备发布到 ${accountsToPublish.length} 个账号...`,
        success: false
      })

      const results = await executeBatchPublish(accountsToPublish)
      finalizeBatchPublishStatus(results)
    } finally {
      setPublishing(false)
    }
  }

  const handleBatchConfirmForcePublish = async () => {
    const targets = resolveAccountsByIds(batchConfirmState.forcePublishAccountIds)
    if (targets.length === 0) return

    try {
      setPublishing(true)
      addPublishStep('batch_confirm_force', `正在强制发布 ${targets.length} 个低分账号...`, 'running')
      const results = await executeBatchPublish(targets, {
        forcePublish: true,
      })
      addPublishStep('batch_confirm_force', `低分账号重试完成（${results.length}个）`, 'success')
      const mergedResults = accountPublishResults
        .filter(item => !batchConfirmState.forcePublishAccountIds.includes(item.accountId))
        .concat(results)
      finalizeBatchPublishStatus(mergedResults)
    } finally {
      setPublishing(false)
    }
  }

  const handleBatchConfirmPauseOldCampaigns = async () => {
    const targets = resolveAccountsByIds(batchConfirmState.pauseOldCampaignAccountIds)
    if (targets.length === 0) return

    try {
      setPublishing(true)
      addPublishStep('batch_confirm_pause', `正在暂停旧广告并发布 ${targets.length} 个账号...`, 'running')
      const results = await executeBatchPublish(targets, {
        pauseOldCampaignsOverride: true,
      })
      addPublishStep('batch_confirm_pause', `旧广告暂停确认后重试完成（${results.length}个）`, 'success')
      const mergedResults = accountPublishResults
        .filter(item => !batchConfirmState.pauseOldCampaignAccountIds.includes(item.accountId))
        .concat(results)
      finalizeBatchPublishStatus(mergedResults)
    } finally {
      setPublishing(false)
    }
  }

  // 🔥 新增：重置发布状态（用于"返回修改"）- 现在会直接跳转到第3步
  const resetPublishState = () => {
    // 直接跳转到第3步，让用户修改广告配置
    onGoBackToStep3()
  }

  // 🔥 新增：强制发布处理函数（用于40-80分警告时）
  const handleForcePublish = async () => {
    try {
      setShowForcePublishConfirm(false)
      setPublishing(true)
      setShowPublishResult(true)
      setPublishSteps([])
      setLaunchScoreBlockDetails(null)

      addPublishStep('creating', '创建广告系列结构...', 'running')
      setPublishStatus({
        step: 'creating',
        message: '创建广告系列结构...',
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: primaryAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: pauseOldCampaigns,
          enableCampaignImmediately: enableCampaignImmediately,
          forcePublish: true,  // 🔥 关键：强制发布标志
        })
      })

      const data = await response.json()
      const apiError = parseApiError(data)

      // 处理可能的错误
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低（无法强制发布）:', data)
        const details = data.details || {}

        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 40,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []
        })

        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，无法强制发布`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 40}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      if (response.status === 422) {
        console.error('❌ 422错误:', data)
        setPublishing(false)
        addPublishStep('creating', apiError.message, 'failed')
        setPublishStatus({
          step: 'failed',
          message: apiError.message,
          success: false
        })
        return
      }

      if (!response.ok) {
        if (apiError.needsReauth || response.status === 401) {
          setNeedsReauth(true)
          setReauthMessage(apiError.message || 'Google Ads 授权已过期或被撤销，请重新授权后再发布')
          addPublishStep('creating', 'Google Ads 授权已过期，请重新授权', 'failed')
          setPublishStatus({
            step: 'failed',
            message: 'Google Ads 授权已过期，请先前往设置重新授权后再发布',
            success: false
          })
          setPublishing(false)
          return
        }
        throw new Error(apiError.message)
      }

      // 🔥 修复：202 Accepted 表示后台异步队列，必须轮询 DB 状态确认
      if (response.status === 202) {
        addPublishStep('creating', '创建广告系列结构', 'success')
        addPublishStep('syncing', '同步到Google Ads...(轮询中)', 'running')
        setPublishStatus({ step: 'syncing', message: '正在后台处理，请稍候...', success: false })
        addServerWarnings(data.warnings)

        const campaignIds: number[] = data.campaigns?.map((c: any) => c.id) || []
        setLastPublishCampaignIds(campaignIds)
        if (campaignIds.length === 0) {
          addPublishStep('syncing', '发布任务已提交，但未返回Campaign列表，请稍后刷新查看结果', 'warning')
          setPublishStatus({ step: 'timeout', message: '发布任务已提交，但返回的Campaign列表为空；请稍后刷新页面或在Google Ads中确认结果。', success: false })
          setPublishing(false)
          return
        }

        const { pendingIds, failedIds, failedDetails, successIds, warnings } = await pollCampaignCreationStatus(campaignIds)
        if (failedIds.length > 0) {
          const errorMsg = `${failedIds.length}个广告系列发布失败`
          addPublishStep('syncing', errorMsg, 'failed')
          addCampaignPublishFailureDetails(failedDetails)
          setPublishStatus({ step: 'failed', message: errorMsg, success: false })
          setPublishing(false)
          return
        }

        if (pendingIds.length > 0) {
          addPublishStep('syncing', `同步耗时较长：已完成 ${successIds.length}/${campaignIds.length}，仍在后台处理中`, 'warning')
          setPublishStatus({ step: 'timeout', message: '处理耗时较长但后台仍在继续发布；请稍后点击“继续检查状态”或刷新页面查看最终结果。', success: false })
          setPublishing(false)
          return
        }

        addPublishStep('syncing', '同步完成', 'success')
        addPublishStep('completed', `${successIds.length}个广告系列已成功发布到Google Ads`, 'success')
        if (warnings.length > 0) {
          addPublishStep('warnings', `提示: ${warnings.join('; ').replace('[警告] ', '')}`, 'warning')
        }
        setPublishStatus({ step: 'completed', message: '发布成功！广告系列已上线', success: true })
        setLastPublishCampaignIds([])
        onPublishComplete()
        return
      }

      // 非异步：发布成功（兼容旧返回）
      addPublishStep('creating', '创建广告系列结构', 'success')
      addPublishStep('completed', '广告系列已成功发布到Google Ads', 'success')
      setPublishStatus({ step: 'completed', message: '发布成功！广告系列已上线', success: true })
      setLastPublishCampaignIds([])
      onPublishComplete()
    } catch (error: any) {
      addPublishStep('error', error.message || '发布失败', 'failed')
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
    } finally {
      setPublishing(false)
    }
  }

  const handlePublish = async () => {
    try {
      setBatchConfirmState({
        forcePublishAccountIds: [],
        pauseOldCampaignAccountIds: [],
      })

      if (!primaryAccount) {
        setPublishStatus({ step: 'failed', message: '未找到可用的Google Ads账号', success: false })
        return
      }

      const normalizedCurrencies = Array.from(new Set(
        accountsToPublish
          .map((account: any) => String(account?.currencyCode || '').trim().toUpperCase())
          .filter((currencyCode: string) => currencyCode.length > 0)
      ))
      const hasUnknownCurrency = accountsToPublish.some(
        (account: any) => String(account?.currencyCode || '').trim().length === 0
      )
      if (accountsToPublish.length > 1 && (normalizedCurrencies.length > 1 || hasUnknownCurrency)) {
        setShowPublishResult(true)
        setPublishSteps([])
        addPublishStep(
          'currency_guard',
          `账号货币不一致（${normalizedCurrencies.join(', ') || '未知'}），请仅保留同一货币账号后再发布`,
          'failed'
        )
        setPublishStatus({
          step: 'failed',
          message: '多账号同步发布仅支持同币种账号，请返回第2步调整选择',
          success: false
        })
        return
      }

      if (accountsToPublish.length > 1) {
        await handleMultiAccountPublish()
        return
      }

      setPublishing(true)
      setShowPublishResult(true)  // 🔥 切换到发布结果模式
      setPublishSteps([])  // 清空之前的步骤
      setLaunchScoreBlockDetails(null)  // 清空之前的阻止详情

      addPublishStep('preparing', '准备发布数据...', 'running')
      setPublishStatus({
        step: 'preparing',
        message: '准备发布数据...',
        success: false
      })

      // Step 1: Pause old campaigns if requested
      addPublishStep('preparing', '准备发布数据', 'success')

      // ⚠️ 注意：旧广告系列暂停由 /api/campaigns/publish 在服务端基于“真实Google Ads状态”执行，
      // 避免依赖本地DB状态导致误显示“已暂停0个广告系列”。
      if (pauseOldCampaigns) {
        addPublishStep('pausing', '检测并暂停已激活的旧广告系列...', 'running')
        setPublishStatus({
          step: 'pausing',
          message: '检测并暂停已激活的旧广告系列...',
          success: false
        })
      }

      // Step 2: Create campaign structure
      addPublishStep('creating', '创建广告系列结构...', 'running')
      setPublishStatus({
        step: 'creating',
        message: '创建广告系列结构...',
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: primaryAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: pauseOldCampaigns,
          enableCampaignImmediately: enableCampaignImmediately,
          forcePublish: false,
        })
      })

      const data = await response.json()
      const apiError = parseApiError(data)

      // 🔥 处理Launch Score过低的情况（422状态码）- 在卡片中显示而不是toast
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低:', data)
        const details = data.details || {}

        // 存储Launch Score阻止详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 40,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []  // 🔧 新增：整体建议
        })

        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，发布被阻止`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 40}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 处理Launch Score警告的情况（422状态码）- 显示建议但不阻止发布
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_WARNING') {
        console.warn('⚠️ Launch Score偏低:', data)
        const details = data.details || {}

        // 存储Launch Score警告详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 80,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || [],  // 🔧 新增：整体建议
          canForcePublish: details.canForcePublish === true  // 🔥 新增：标记可以强制发布
        })

        addPublishStep('creating', `投放评分偏低 (${details.launchScore || 0}分)，建议优化`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分偏低，建议≥${details.threshold || 80}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 处理需要确认暂停的情况（422状态码）- 使用新的数据结构
      if (response.status === 422 && data.action === 'CONFIRM_PAUSE_OLD_CAMPAIGNS') {
        console.log('⚠️ 需要用户确认是否暂停旧Campaign:', data)

        // 🔥 新数据结构：区分系统创建和用户手动创建的广告系列
        const ownCampaigns = data.existingCampaigns?.own || []
        const manualCampaigns = data.existingCampaigns?.manual || []

        // 合并所有需要暂停的广告系列
        const allCampaignsToPause = [...ownCampaigns, ...manualCampaigns]
        setExistingCampaigns(allCampaignsToPause)

        // 构建详细消息
        const totalCount = data.total?.all || allCampaignsToPause.length
        const ownCount = data.total?.own || ownCampaigns.length
        const manualCount = data.total?.manual || manualCampaigns.length

        const details = data.details || {}
        const detailText = details.own || details.manual
          ? `\n${details.own || ''}${details.own && details.manual ? '\n' : ''}${details.manual || ''}`
          : ''

        setPauseConfirmMessage(`${data.message || ''}${detailText}`)
        setShowPauseConfirm(true)
        setShowPublishResult(false)  // 退出发布结果模式
        setPublishing(false)
        return
      }

      // 🔥 处理Ads账号被其他Offer占用的情况（409状态码）- 在卡片中显示而不是toast
      if (response.status === 409) {
        console.error('❌ Ads账号冲突:', data)
        const errorMessage = data.message || data.error?.error?.message || 'Ads账号已被其他Offer占用'
        const suggestion = data.suggestion || '请选择其他Ads账号'
        addPublishStep('creating', `账号冲突: ${errorMessage}`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `${errorMessage}\n${suggestion}`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 新增(2025-12-18)：422通用处理（兜底） - 处理任何422错误，即使action不匹配
      // 这确保即使后端返回意外的422状态和action值，前端也能正确处理而不会卡在加载中
      if (response.status === 422) {
        console.error('❌ 422错误（未识别的action或其他422错误）:', data)
        setPublishing(false)  // 🔥 关键：停止加载动画
        addPublishStep('creating', apiError.message, 'failed')
        setPublishStatus({
          step: 'failed',
          message: apiError.message,
          success: false
        })
        return
      }

      if (!response.ok) {
        if (apiError.needsReauth || response.status === 401) {
          setNeedsReauth(true)
          setReauthMessage(apiError.message || 'Google Ads 授权已过期或被撤销，请重新授权后再发布')
          addPublishStep('creating', 'Google Ads 授权已过期，请重新授权', 'failed')
          setPublishStatus({
            step: 'failed',
            message: 'Google Ads 授权已过期，请先前往设置重新授权后再发布',
            success: false
          })
          setPublishing(false)
          return
        }

        // 🔥 新增：处理 Google Ads API 限流错误 (429)
        if (apiError.isRateLimited) {
          setIsRateLimited(true)
          setRateLimitInfo({
            retryAfter: apiError.retryAfter || 3600,
            message: apiError.message
          })
          addPublishStep('creating', 'Google Ads API 限流，请稍后再试', 'failed')
          setPublishStatus({
            step: 'failed',
            message: apiError.message,
            success: false
          })
          setPublishing(false)
          return
        }

        throw new Error(apiError.message)
      }

      // 🔥 修复(2025-12-19): 202 Accepted表示任务已提交到后台队列
      // 不能立即认为成功，必须轮询campaign.creation_status直到synced或failed
      if (response.status === 202) {
        console.log('📦 任务已提交到后台队列，开始轮询状态...')

        // 🔥 暂停旧广告系列结果（由后端返回）
        if (pauseOldCampaigns) {
          const pausedCount =
            typeof data?.pausedOldCampaigns?.pausedCount === 'number'
              ? data.pausedOldCampaigns.pausedCount
              : (typeof data?.pausedOldCampaigns?.attemptedCount === 'number'
                ? data.pausedOldCampaigns.attemptedCount
                : undefined)

          addPublishStep(
            'pausing',
            typeof pausedCount === 'number'
              ? (pausedCount > 0 ? `已暂停 ${pausedCount} 个广告系列` : '未检测到需要暂停的广告系列')
              : '旧广告系列暂停完成',
            'success'
          )
        }

        // 🔥 新增(2025-12-19)：保存Launch Score评分结果
        if (data.launchScore) {
          setLaunchScoreSuccess({
            totalScore: data.launchScore.totalScore,
            breakdown: data.launchScore.breakdown,
            overallRecommendations: data.launchScore.overallRecommendations || []
          })
          console.log(`📊 Launch Score评分: ${data.launchScore.totalScore}分`)
        }

        addPublishStep('creating', '创建广告系列结构', 'success')
        addPublishStep('syncing', '同步到Google Ads...(轮询中)', 'running')
        setPublishStatus({
          step: 'syncing',
          message: '正在后台处理，请稍候...',
          success: false
        })
        addServerWarnings(data.warnings)

        const campaignIds: number[] = data.campaigns?.map((c: any) => c.id) || []
        setLastPublishCampaignIds(campaignIds)
        console.log(`📊 需要轮询的Campaign数量: ${campaignIds.length}`)

        if (campaignIds.length === 0) {
          addPublishStep('syncing', '发布任务已提交，但未返回Campaign列表，请稍后刷新查看结果', 'warning')
          setPublishStatus({
            step: 'timeout',
            message: '发布任务已提交，但返回的Campaign列表为空；请稍后刷新页面或在Google Ads中确认结果。',
            success: false
          })
          setPublishing(false)
          return
        }

        const { pendingIds, failedIds, failedDetails, successIds, warnings } = await pollCampaignCreationStatus(campaignIds)

        if (failedIds.length > 0) {
          const errorMsg = `${failedIds.length}个广告系列发布失败`
          console.error(`❌ ${errorMsg}`)
          addPublishStep('syncing', errorMsg, 'failed')
          addCampaignPublishFailureDetails(failedDetails)
          setPublishStatus({ step: 'failed', message: errorMsg, success: false })
          setPublishing(false)
          return
        }

        if (pendingIds.length > 0) {
          addPublishStep('syncing', `同步耗时较长：已完成 ${successIds.length}/${campaignIds.length}，仍在后台处理中`, 'warning')
          setPublishStatus({
            step: 'timeout',
            message: '处理耗时较长但后台仍在继续发布；请稍后点击“继续检查状态”或刷新页面查看最终结果。',
            success: false
          })
          setPublishing(false)
          return
        }

        addPublishStep('syncing', '同步完成', 'success')
        addPublishStep('completed', `${successIds.length}个广告系列已成功发布到Google Ads`, 'success')
        if (warnings.length > 0) {
          addPublishStep('warnings', `提示: ${warnings.join('; ').replace('[警告] ', '')}`, 'warning')
        }
        setPublishStatus({ step: 'completed', message: '发布成功！广告系列已上线', success: true })
        setLastPublishCampaignIds([])
        onPublishComplete()
        return
      }
    } catch (error: any) {
      // 发布失败 - 在卡片中显示而不是toast
      addPublishStep('error', error.message || '发布失败', 'failed')
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
    } finally {
      setPublishing(false)
    }
  }

  // 🔥 新增：用户确认暂停并发布
  const handleConfirmPauseAndPublish = async () => {
    try {
      setShowPauseConfirm(false)
      setPublishing(true)
      setShowPublishResult(true)  // 🔥 切换到发布结果模式
      setPublishSteps([])  // 清空之前的步骤
      setLaunchScoreBlockDetails(null)  // 清空之前的阻止详情

      addPublishStep('pausing', `正在暂停${existingCampaigns.length}个旧广告系列...`, 'running')
      setPublishStatus({
        step: 'pausing',
        message: `正在暂停${existingCampaigns.length}个旧广告系列...`,
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: primaryAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: true, // 用户确认暂停
          enableCampaignImmediately: enableCampaignImmediately,  // 是否立即启用Campaign
          forcePublish: false,
        })
      })

      const data = await response.json()
      const apiError = parseApiError(data)

      // 🔥 处理Launch Score过低的情况 - 在卡片中显示而不是toast (handleConfirmPauseAndPublish)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低:', data)
        const details = data.details || {}

        // 存储Launch Score阻止详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 40,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []  // 🔧 新增：整体建议
        })

        addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，发布被阻止`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 40}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 处理Launch Score警告的情况 - 显示建议但不阻止发布 (handleConfirmPauseAndPublish)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_WARNING') {
        console.warn('⚠️ Launch Score偏低:', data)
        const details = data.details || {}

        // 存储Launch Score警告详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 80,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || [],  // 🔧 新增：整体建议
          canForcePublish: details.canForcePublish === true  // 🔥 新增：标记可以强制发布
        })

        addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
        addPublishStep('creating', `投放评分偏低 (${details.launchScore || 0}分)，建议优化`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分偏低，建议≥${details.threshold || 80}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 新增(2025-12-18)：422通用处理（兜底）- 在handleConfirmPauseAndPublish中也需要
      if (response.status === 422) {
        console.error('❌ 422错误（未识别的action或其他422错误）:', data)
        setPublishing(false)  // 🔥 关键：停止加载动画
        addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
        addPublishStep('creating', apiError.message, 'failed')
        setPublishStatus({
          step: 'failed',
          message: apiError.message,
          success: false
        })
        return
      }

      if (!response.ok) {
        if (apiError.needsReauth || response.status === 401) {
          setNeedsReauth(true)
          setReauthMessage(apiError.message || 'Google Ads 授权已过期或被撤销，请重新授权后再发布')
          addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
          addPublishStep('creating', 'Google Ads 授权已过期，请重新授权', 'failed')
          setPublishStatus({
            step: 'failed',
            message: 'Google Ads 授权已过期，请先前往设置重新授权后再发布',
            success: false
          })
          setPublishing(false)
          return
        }
        throw new Error(apiError.message)
      }

      if (response.status === 202) {
        addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
        addPublishStep('creating', '创建广告系列结构', 'success')
        addPublishStep('syncing', '同步到Google Ads...(轮询中)', 'running')
        setPublishStatus({ step: 'syncing', message: '正在后台处理，请稍候...', success: false })
        addServerWarnings(data.warnings)

        const campaignIds: number[] = data.campaigns?.map((c: any) => c.id) || []
        setLastPublishCampaignIds(campaignIds)
        if (campaignIds.length === 0) {
          addPublishStep('syncing', '发布任务已提交，但未返回Campaign列表，请稍后刷新查看结果', 'warning')
          setPublishStatus({ step: 'timeout', message: '发布任务已提交，但返回的Campaign列表为空；请稍后刷新页面或在Google Ads中确认结果。', success: false })
          setPublishing(false)
          return
        }

        const { pendingIds, failedIds, failedDetails, successIds, warnings } = await pollCampaignCreationStatus(campaignIds)
        if (failedIds.length > 0) {
          const errorMsg = `${failedIds.length}个广告系列发布失败`
          addPublishStep('syncing', errorMsg, 'failed')
          addCampaignPublishFailureDetails(failedDetails)
          setPublishStatus({ step: 'failed', message: errorMsg, success: false })
          setPublishing(false)
          return
        }

        if (pendingIds.length > 0) {
          addPublishStep('syncing', `同步耗时较长：已完成 ${successIds.length}/${campaignIds.length}，仍在后台处理中`, 'warning')
          setPublishStatus({ step: 'timeout', message: '处理耗时较长但后台仍在继续发布；请稍后点击“继续检查状态”或刷新页面查看最终结果。', success: false })
          setPublishing(false)
          return
        }

        addPublishStep('syncing', '同步完成', 'success')
        addPublishStep('completed', `${successIds.length}个广告系列已成功发布到Google Ads`, 'success')
        if (warnings.length > 0) {
          addPublishStep('warnings', `提示: ${warnings.join('; ').replace('[警告] ', '')}`, 'warning')
        }
        setPublishStatus({ step: 'completed', message: '发布成功！广告系列已上线', success: true })
        setLastPublishCampaignIds([])
        onPublishComplete()
        return
      }

      addPublishStep('pausing', `已暂停${existingCampaigns.length}个旧广告系列`, 'success')
      addPublishStep('creating', '创建广告系列结构', 'success')
      addPublishStep('completed', '新广告已创建', 'success')
      setPublishStatus({ step: 'completed', message: '发布成功！广告系列已上线', success: true })
      setLastPublishCampaignIds([])
      onPublishComplete()
    } catch (error: any) {
      // 发布失败 - 在卡片中显示而不是toast
      addPublishStep('error', error.message || '发布失败', 'failed')
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
    } finally {
      setPublishing(false)
    }
  }

  // 🔥 新增：用户选择直接发布（A/B测试模式）
  const handlePublishTogether = async () => {
    try {
      setShowPauseConfirm(false)
      setPublishing(true)
      setShowPublishResult(true)  // 🔥 切换到发布结果模式
      setPublishSteps([])  // 清空之前的步骤
      setLaunchScoreBlockDetails(null)  // 清空之前的阻止详情

      addPublishStep('creating', '创建新广告（A/B测试模式）...', 'running')
      setPublishStatus({
        step: 'creating',
        message: '创建新广告（A/B测试模式）...',
        success: false
      })

      const response = await fetch('/api/campaigns/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          offerId: offer.id,
          adCreativeId: selectedCreative.id,
          googleAdsAccountId: primaryAccount.id,
          campaignConfig: campaignConfig,
          pauseOldCampaigns: false, // 不暂停
          enableCampaignImmediately: enableCampaignImmediately,  // 是否立即启用Campaign
          forcePublish: true, // 强制发布（跳过确认）
        })
      })

      const data = await response.json()
      const apiError = parseApiError(data)

      // 🔥 处理Launch Score过低的情况 - 在卡片中显示而不是toast (handlePublishTogether)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_BLOCKED') {
        console.error('❌ Launch Score过低:', data)
        const details = data.details || {}

        // 存储Launch Score阻止详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 40,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || []  // 🔧 新增：整体建议
        })

        addPublishStep('creating', `投放评分过低 (${details.launchScore || 0}分)，发布被阻止`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分过低，需要≥${details.threshold || 40}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 处理Launch Score警告的情况 - 显示建议但不阻止发布 (handlePublishTogether)
      if (response.status === 422 && data.action === 'LAUNCH_SCORE_WARNING') {
        console.warn('⚠️ Launch Score偏低:', data)
        const details = data.details || {}

        // 存储Launch Score警告详情，在卡片中显示
        setLaunchScoreBlockDetails({
          launchScore: details.launchScore || 0,
          threshold: details.threshold || 80,
          breakdown: details.breakdown || {},
          issues: details.issues || [],
          suggestions: details.suggestions || [],
          overallRecommendations: details.overallRecommendations || [],  // 🔧 新增：整体建议
          canForcePublish: details.canForcePublish === true  // 🔥 新增：标记可以强制发布
        })

        addPublishStep('creating', `投放评分偏低 (${details.launchScore || 0}分)，建议优化`, 'failed')
        setPublishStatus({
          step: 'failed',
          message: `投放评分偏低，建议≥${details.threshold || 80}分`,
          success: false
        })
        setPublishing(false)
        return
      }

      // 🔥 新增(2025-12-18)：422通用处理（兜底）- 在handlePublishTogether中也需要
      if (response.status === 422) {
        console.error('❌ 422错误（未识别的action或其他422错误）:', data)
        setPublishing(false)  // 🔥 关键：停止加载动画
        addPublishStep('creating', apiError.message, 'failed')
        setPublishStatus({
          step: 'failed',
          message: apiError.message,
          success: false
        })
        return
      }

      if (!response.ok) {
        if (apiError.needsReauth || response.status === 401) {
          setNeedsReauth(true)
          setReauthMessage(apiError.message || 'Google Ads 授权已过期或被撤销，请重新授权后再发布')
          addPublishStep('creating', 'Google Ads 授权已过期，请重新授权', 'failed')
          setPublishStatus({
            step: 'failed',
            message: 'Google Ads 授权已过期，请先前往设置重新授权后再发布',
            success: false
          })
          setPublishing(false)
          return
        }
        throw new Error(apiError.message)
      }

      if (response.status === 202) {
        addPublishStep('creating', '创建广告系列结构', 'success')
        addPublishStep('syncing', '同步到Google Ads...(轮询中)', 'running')
        setPublishStatus({ step: 'syncing', message: '正在后台处理，请稍候...', success: false })
        addServerWarnings(data.warnings)

        const campaignIds: number[] = data.campaigns?.map((c: any) => c.id) || []
        setLastPublishCampaignIds(campaignIds)
        if (campaignIds.length === 0) {
          addPublishStep('syncing', '发布任务已提交，但未返回Campaign列表，请稍后刷新查看结果', 'warning')
          setPublishStatus({ step: 'timeout', message: '发布任务已提交，但返回的Campaign列表为空；请稍后刷新页面或在Google Ads中确认结果。', success: false })
          setPublishing(false)
          return
        }

        const { pendingIds, failedIds, failedDetails, successIds, warnings } = await pollCampaignCreationStatus(campaignIds)
        if (failedIds.length > 0) {
          const errorMsg = `${failedIds.length}个广告系列发布失败`
          addPublishStep('syncing', errorMsg, 'failed')
          addCampaignPublishFailureDetails(failedDetails)
          setPublishStatus({ step: 'failed', message: errorMsg, success: false })
          setPublishing(false)
          return
        }

        if (pendingIds.length > 0) {
          addPublishStep('syncing', `同步耗时较长：已完成 ${successIds.length}/${campaignIds.length}，仍在后台处理中`, 'warning')
          setPublishStatus({ step: 'timeout', message: '处理耗时较长但后台仍在继续发布；请稍后点击“继续检查状态”或刷新页面查看最终结果。', success: false })
          setPublishing(false)
          return
        }

        addPublishStep('syncing', '同步完成', 'success')
        addPublishStep('completed', `${successIds.length}个广告系列已成功发布到Google Ads`, 'success')
        if (warnings.length > 0) {
          addPublishStep('warnings', `提示: ${warnings.join('; ').replace('[警告] ', '')}`, 'warning')
        }
        setPublishStatus({ step: 'completed', message: '发布成功！新旧广告同时运行', success: true })
        setLastPublishCampaignIds([])
        onPublishComplete()
        return
      }

      addPublishStep('creating', '创建广告系列结构', 'success')
      addPublishStep('completed', '新广告已创建，旧广告继续运行（A/B测试模式）', 'success')
      setPublishStatus({ step: 'completed', message: '发布成功！新旧广告同时运行', success: true })
      setLastPublishCampaignIds([])
      onPublishComplete()
    } catch (error: any) {
      // 发布失败 - 在卡片中显示而不是toast
      addPublishStep('error', error.message || '发布失败', 'failed')
      setPublishStatus({
        step: 'failed',
        message: error.message || '发布失败',
        success: false
      })
    } finally {
      setPublishing(false)
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600'
    if (score >= 60) return 'text-yellow-600'
    return 'text-red-600'
  }

  return (
    <div className="space-y-6">
      {/* Header Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-orange-600" />
            确认发布
          </CardTitle>
          <CardDescription>
            请仔细检查以下配置信息，确认无误后点击"发布广告"按钮
          </CardDescription>
        </CardHeader>
      </Card>

      {/* 🚀 两列布局：左侧发布选项，右侧发布结果 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 左列：Publish Options & Button */}
        <Card className="border-2 border-blue-200 bg-blue-50/50 lg:h-[400px] flex flex-col">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Rocket className="w-4 h-4 text-blue-600" />
              发布选项
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              {/* Options */}
              <div className="space-y-3">
                <div className="flex items-start space-x-3 p-3 bg-white rounded-lg border hover:border-blue-300 transition-colors">
                  <Checkbox
                    id="enableImmediately"
                    checked={enableCampaignImmediately}
                    onCheckedChange={(checked) => setEnableCampaignImmediately(checked as boolean)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="enableImmediately"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2"
                    >
                      立即启用新广告系列
                      <Badge variant={enableCampaignImmediately ? "default" : "outline"} className="text-xs">
                        {enableCampaignImmediately ? '立即投放' : '暂停状态'}
                      </Badge>
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      {enableCampaignImmediately ? '发布后立即开始投放广告' : '发布后保持暂停，可在Google Ads后台手动启用'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start space-x-3 p-3 bg-white rounded-lg border hover:border-blue-300 transition-colors">
                  <Checkbox
                    id="pauseOld"
                    checked={pauseOldCampaigns}
                    onCheckedChange={(checked) => setPauseOldCampaigns(checked as boolean)}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <Label
                      htmlFor="pauseOld"
                      className="text-sm font-medium cursor-pointer flex items-center gap-2"
                    >
                      暂停所有旧广告系列
                      <Badge variant={pauseOldCampaigns ? "destructive" : "outline"} className="text-xs">
                        {pauseOldCampaigns ? '将暂停' : '保持运行'}
                      </Badge>
                    </Label>
                    <p className="text-xs text-gray-500 mt-1">
                      {pauseOldCampaigns ? '发布新广告前，先暂停该Offer的所有旧广告系列' : '新旧广告同时运行（A/B测试模式）'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Publish Button */}
              <Button
                onClick={handlePublish}
                disabled={publishing}
                size="lg"
                className="w-full h-12 text-base font-semibold"
              >
                {publishing ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    {accountsToPublish.length > 1 ? `批量发布中 (${accountsToPublish.length}个账号)...` : '发布中...'}
                  </>
                ) : (
                  <>
                    <Rocket className="w-5 h-5 mr-2" />
                    {accountsToPublish.length > 1 ? `发布到 ${accountsToPublish.length} 个账号` : '发布广告'}
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* 右列：发布结果卡片 - 始终显示 */}
        <Card className={`border-2 lg:h-[400px] flex flex-col ${
          publishStatus?.success
            ? 'border-green-200 bg-green-50/30'
            : publishStatus?.step === 'failed'
            ? 'border-red-200 bg-red-50/30'
            : publishStatus?.step === 'partial'
            ? 'border-amber-200 bg-amber-50/30'
            : publishStatus?.step === 'timeout'
            ? 'border-amber-200 bg-amber-50/30'
            : showPublishResult
            ? 'border-blue-200 bg-blue-50/30'
            : 'border-gray-200 bg-gray-50/30'
        }`}>
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-base flex items-center gap-2">
              {publishStatus?.success ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : publishStatus?.step === 'failed' ? (
                <AlertCircle className="w-4 h-4 text-red-600" />
              ) : publishStatus?.step === 'partial' ? (
                <AlertCircle className="w-4 h-4 text-amber-600" />
              ) : publishStatus?.step === 'timeout' ? (
                <AlertCircle className="w-4 h-4 text-amber-600" />
              ) : showPublishResult ? (
                <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
              ) : (
                <AlertCircle className="w-4 h-4 text-gray-400" />
              )}
              发布结果
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              {needsReauth && (
                <Alert className="border-red-200 bg-red-50">
                  <AlertDescription className="space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                      <div className="text-sm text-red-800">
                        <div className="font-semibold">Google Ads 授权已过期</div>
                        <div className="text-red-700 mt-1">
                          {reauthMessage || 'refresh token 已过期或被撤销，请重新授权后再发布。'}
                        </div>
                        <div className="text-red-700 mt-2">
                          前往 <a className="underline font-medium" href="/settings">设置</a> 完成重新授权，然后回到此页面重试。
                        </div>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* 🔥 新增：Google Ads API 限流友好提示 */}
              {isRateLimited && rateLimitInfo && (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertDescription className="space-y-3">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5" />
                      <div className="text-sm text-amber-800">
                        <div className="font-semibold">API 调用次数已达上限</div>
                        <div className="text-amber-700 mt-1">
                          {rateLimitInfo.message}
                        </div>
                        <div className="text-amber-700 mt-2">
                          <div className="flex items-center gap-2">
                            <span>预计需要等待:</span>
                            <span className="font-mono font-semibold bg-amber-100 px-2 py-0.5 rounded">
                              {Math.floor(rateLimitInfo.retryAfter / 3600)} 小时 {Math.floor((rateLimitInfo.retryAfter % 3600) / 60)} 分钟
                            </span>
                          </div>
                        </div>
                        <div className="text-amber-700 mt-3 pt-3 border-t border-amber-200">
                          <div className="text-xs font-medium mb-1">💡 建议：</div>
                          <ul className="text-xs space-y-1 text-amber-700 list-disc list-inside">
                            <li>Google Ads API 有每日调用次数限制</li>
                            <li>建议稍后（{Math.ceil(rateLimitInfo.retryAfter / 60)} 分钟后）再尝试发布</li>
                            <li>如需更高配额，可访问 <a href="https://support.google.com/google-ads/contact/quotas" target="_blank" rel="noopener noreferrer" className="underline">Google Ads API 配额申请</a></li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {(batchConfirmState.forcePublishAccountIds.length > 0 || batchConfirmState.pauseOldCampaignAccountIds.length > 0) && (
                <Alert className="border-blue-200 bg-blue-50">
                  <AlertDescription className="space-y-3">
                    <div className="text-sm text-blue-900 font-semibold">检测到待确认账号操作</div>
                    <div className="text-xs text-blue-800 space-y-1">
                      {batchConfirmState.forcePublishAccountIds.length > 0 && (
                        <div>低分待强制发布：{batchConfirmState.forcePublishAccountIds.length} 个账号</div>
                      )}
                      {batchConfirmState.pauseOldCampaignAccountIds.length > 0 && (
                        <div>待确认暂停旧系列：{batchConfirmState.pauseOldCampaignAccountIds.length} 个账号</div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {batchConfirmState.forcePublishAccountIds.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={publishing}
                          onClick={handleBatchConfirmForcePublish}
                        >
                          确认强制发布低分账号
                        </Button>
                      )}
                      {batchConfirmState.pauseOldCampaignAccountIds.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={publishing}
                          onClick={handleBatchConfirmPauseOldCampaigns}
                        >
                          确认暂停旧系列后发布
                        </Button>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* 等待发布状态 - 显示准备信息 */}
              {!showPublishResult && publishSteps.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full py-8">
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
                      <Rocket className="w-8 h-8 text-gray-400" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-700 mb-2">准备发布数据</div>
                      <div className="text-xs text-gray-500 space-y-1">
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>已生成广告创意</span>
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>已关联Google Ads账号</span>
                        </div>
                        <div className="flex items-center justify-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                          <span>已配置广告系列参数</span>
                        </div>
                      </div>
                    </div>
                    <div className="pt-4 border-t border-gray-200 w-full">
                      <div className="text-xs text-gray-500 text-center">
                        {pauseOldCampaigns ? '发布时将自动检测并暂停旧广告系列' : '旧广告系列将保持运行'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* 发布中/已发布状态 - 显示步骤列表 */}
              {(showPublishResult || publishSteps.length > 0) && (
                <>
                  {publishStatus?.step === 'timeout' && lastPublishCampaignIds.length > 0 && (
                    <Alert className="border-amber-200 bg-amber-50">
                      <AlertDescription className="space-y-2">
                        <div className="flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5" />
                          <div className="text-sm text-amber-800">
                            <div className="font-semibold">后台仍在发布中</div>
                            <div className="text-amber-700 mt-1">处理耗时较长不代表失败；你可以稍后继续检查发布结果。</div>
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={async () => {
                                  try {
                                    setPublishing(true)
                                    addPublishStep('syncing', '重新检查同步状态...(轮询中)', 'running')
                                    setPublishStatus({ step: 'syncing', message: '正在重新检查发布状态...', success: false })

                                    const { pendingIds, failedIds, failedDetails, successIds, warnings } = await pollCampaignCreationStatus(lastPublishCampaignIds, { maxWaitMs: 120_000 })

                                    if (failedIds.length > 0) {
                                      const errorMsg = `${failedIds.length}个广告系列发布失败`
                                      addPublishStep('syncing', errorMsg, 'failed')
                                      addCampaignPublishFailureDetails(failedDetails)
                                      setPublishStatus({ step: 'failed', message: errorMsg, success: false })
                                      return
                                    }

                                    if (pendingIds.length > 0) {
                                      addPublishStep('syncing', `仍在后台处理中：已完成 ${successIds.length}/${lastPublishCampaignIds.length}`, 'warning')
                                      setPublishStatus({ step: 'timeout', message: '处理仍在继续；请稍后再检查或刷新页面。', success: false })
                                      return
                                    }

                                    addPublishStep('syncing', '同步完成', 'success')
                                    addPublishStep('completed', `${successIds.length}个广告系列已成功发布到Google Ads`, 'success')
                                    if (warnings.length > 0) {
                                      addPublishStep('warnings', `提示: ${warnings.join('; ').replace('[警告] ', '')}`, 'warning')
                                    }
                                    setPublishStatus({ step: 'completed', message: '发布成功！广告系列已上线', success: true })
                                    setLastPublishCampaignIds([])
                                    onPublishComplete()
                                  } finally {
                                    setPublishing(false)
                                  }
                                }}
                                disabled={publishing}
                              >
                                继续检查状态
                              </Button>
                            </div>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* 发布步骤列表 */}
                  <div className="space-y-2">
                  {publishSteps.map((step, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-2 bg-white rounded border">
                      {step.status === 'running' ? (
                        <Loader2 className="w-4 h-4 text-blue-600 animate-spin flex-shrink-0" />
                      ) : step.status === 'success' ? (
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
                      ) : step.status === 'warning' ? (
                        <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      ) : step.status === 'failed' ? (
                        <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex-shrink-0" />
                      )}
                      <span className={`text-sm ${
                        step.status === 'failed'
                          ? 'text-red-700'
                          : step.status === 'warning'
                          ? 'text-amber-700'
                          : step.status === 'success'
                          ? 'text-green-700'
                          : 'text-gray-700'
                      }`}>
                        {step.message}
                      </span>
                    </div>
                  ))}
                  </div>

                {accountPublishResults.length > 0 && (
                  <div className="mt-3 rounded-lg border bg-white">
                    <div className="px-3 py-2 border-b text-sm font-medium">账号发布明细</div>
                    <Table className="[&_thead_th]:bg-white">
                      <TableHeader>
                        <TableRow>
                          <TableHead>账号</TableHead>
                          <TableHead>账号ID</TableHead>
                          <TableHead>结果</TableHead>
                          <TableHead>说明</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {accountPublishResults.map((result) => (
                          <TableRow key={result.accountId}>
                            <TableCell className="font-medium">{result.accountName}</TableCell>
                            <TableCell className="font-mono text-xs">{result.customerId}</TableCell>
                            <TableCell>
                              {result.status === 'success' && (
                                <Badge className="bg-green-100 text-green-800 border-green-300">成功</Badge>
                              )}
                              {result.status === 'warning' && (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-300">警告</Badge>
                              )}
                              {result.status === 'failed' && (
                                <Badge className="bg-red-100 text-red-800 border-red-300">失败</Badge>
                              )}
                              {result.status === 'pending_confirmation' && (
                                <Badge className="bg-blue-100 text-blue-800 border-blue-300">待确认</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-sm">{result.message}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* 投放评分阻止详情 */}
                {launchScoreBlockDetails && (
                  <div className="mt-4 p-4 bg-red-50 rounded-lg border border-red-200">
                    {/* 标题和总分 */}
                    <div className="flex items-center justify-between mb-4 pb-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-5 h-5 text-red-600" />
                        <span className="text-sm font-semibold text-red-800">
                          投放评分不足
                        </span>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-red-600">
                          {launchScoreBlockDetails.launchScore}
                          <span className="text-sm font-normal text-gray-500">分</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          最低要求 {launchScoreBlockDetails.threshold} 分
                        </div>
                      </div>
                    </div>

                    {/* 🔧 优化：操作按钮移到卡片顶部，用户一眼就能看到 */}
                    <div className="mb-4 pb-4 border-b border-red-200 space-y-3">
                      {/* 🔥 新增：强制发布按钮（仅在40-80分警告时显示）- 优先显示 */}
                      {launchScoreBlockDetails.canForcePublish && (
                        <Button
                          variant="destructive"
                          size="lg"
                          onClick={() => setShowForcePublishConfirm(true)}
                          className="w-full h-11 font-semibold"
                        >
                          强制发布（已确认风险）
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="lg"
                        onClick={resetPublishState}
                        className="w-full h-11"
                      >
                        返回修改配置
                      </Button>
                    </div>

                    {/* 各维度得分 */}
                    {launchScoreBlockDetails.breakdown && Object.keys(launchScoreBlockDetails.breakdown).length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">各维度得分</div>
                        <div className="grid grid-cols-2 gap-2">
                          {launchScoreBlockDetails.breakdown.launchViability && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">投放可行性</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.launchViability.score}/{launchScoreBlockDetails.breakdown.launchViability.max}
                              </span>
                            </div>
                          )}
                          {launchScoreBlockDetails.breakdown.adQuality && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">广告质量</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.adQuality.score}/{launchScoreBlockDetails.breakdown.adQuality.max}
                              </span>
                            </div>
                          )}
                          {launchScoreBlockDetails.breakdown.keywordStrategy && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">关键词策略</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.keywordStrategy.score}/{launchScoreBlockDetails.breakdown.keywordStrategy.max}
                              </span>
                            </div>
                          )}
                          {launchScoreBlockDetails.breakdown.basicConfig && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">基础配置</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreBlockDetails.breakdown.basicConfig.score}/{launchScoreBlockDetails.breakdown.basicConfig.max}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 主要问题 - 🔥 添加中英文翻译 */}
                    {launchScoreBlockDetails.issues && launchScoreBlockDetails.issues.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-amber-500" />
                          主要问题
                        </div>
                        <ul className="space-y-1">
                          {launchScoreBlockDetails.issues.slice(0, 5).map((issue, idx) => (
                            <li key={idx} className="text-xs text-gray-600 flex items-start gap-2 p-1.5 bg-white rounded">
                              <span className="text-amber-500 mt-0.5">•</span>
                              <span>{issue}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 改进建议 */}
                    {launchScoreBlockDetails.suggestions && launchScoreBlockDetails.suggestions.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          改进建议
                        </div>
                        <ul className="space-y-1">
                          {launchScoreBlockDetails.suggestions.slice(0, 5).map((suggestion, idx) => (
                            <li key={idx} className="text-xs text-gray-600 flex items-start gap-2 p-1.5 bg-white rounded">
                              <span className="text-green-500 mt-0.5">•</span>
                              <span>{suggestion}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 🔧 新增：整体建议 */}
                    {launchScoreBlockDetails.overallRecommendations && launchScoreBlockDetails.overallRecommendations.length > 0 && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <div className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-blue-600" />
                          整体优化建议
                        </div>
                        <ul className="space-y-1">
                          {launchScoreBlockDetails.overallRecommendations.slice(0, 3).map((rec, idx) => (
                            <li key={idx} className="text-xs text-blue-700 flex items-start gap-2">
                              <span className="text-blue-500 mt-0.5">•</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 🔥 新增(2025-12-19)：Launch Score评分结果（成功时显示） */}
                {launchScoreSuccess && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    {/* 标题和总分 */}
                    <div className="flex items-center justify-between mb-3 pb-3 border-b border-blue-200">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-blue-600" />
                        <span className="text-sm font-semibold text-blue-800">
                          投放评分
                        </span>
                      </div>
                      <div className="text-right">
                        <div className={`text-2xl font-bold ${getScoreColor(launchScoreSuccess.totalScore)}`}>
                          {launchScoreSuccess.totalScore}
                          <span className="text-sm font-normal text-gray-500">分</span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {launchScoreSuccess.totalScore >= 80 ? '优秀' : '良好'}
                        </div>
                      </div>
                    </div>

                    {/* 各维度得分 */}
                    {launchScoreSuccess.breakdown && Object.keys(launchScoreSuccess.breakdown).length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold text-gray-700 mb-2">各维度得分</div>
                        <div className="grid grid-cols-2 gap-2">
                          {launchScoreSuccess.breakdown.launchViability && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">投放可行性</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.launchViability.score}/{launchScoreSuccess.breakdown.launchViability.max}
                              </span>
                            </div>
                          )}
                          {launchScoreSuccess.breakdown.adQuality && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">广告质量</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.adQuality.score}/{launchScoreSuccess.breakdown.adQuality.max}
                              </span>
                            </div>
                          )}
                          {launchScoreSuccess.breakdown.keywordStrategy && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">关键词策略</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.keywordStrategy.score}/{launchScoreSuccess.breakdown.keywordStrategy.max}
                              </span>
                            </div>
                          )}
                          {launchScoreSuccess.breakdown.basicConfig && (
                            <div className="flex items-center justify-between p-2 bg-white rounded border">
                              <span className="text-xs text-gray-600">基础配置</span>
                              <span className="text-xs font-semibold text-gray-800">
                                {launchScoreSuccess.breakdown.basicConfig.score}/{launchScoreSuccess.breakdown.basicConfig.max}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 优化建议（如果有） */}
                    {launchScoreSuccess.overallRecommendations && launchScoreSuccess.overallRecommendations.length > 0 && (
                      <div className="mt-3 p-3 bg-white rounded-lg border">
                        <div className="text-xs font-semibold text-blue-800 mb-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3 text-blue-600" />
                          优化建议
                        </div>
                        <ul className="space-y-1">
                          {launchScoreSuccess.overallRecommendations.slice(0, 3).map((rec, idx) => (
                            <li key={idx} className="text-xs text-blue-700 flex items-start gap-2">
                              <span className="text-blue-500 mt-0.5">•</span>
                              <span>{rec}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* 成功后的提示 */}
                {publishStatus?.success && (
                  <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                      <span className="text-sm text-green-800">
                        广告系列已成功发布
                      </span>
                    </div>
                  </div>
                )}
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Publish Status - 仅在非发布结果模式下显示 */}
      {!showPublishResult && publishStatus && (
        <Alert
          className={
            publishStatus.success
              ? 'bg-green-50 border-green-200'
              : publishStatus.step === 'failed'
              ? 'bg-red-50 border-red-200'
              : publishStatus.step === 'timeout'
              ? 'bg-amber-50 border-amber-200'
              : 'bg-blue-50 border-blue-200'
          }
        >
          {publishStatus.success ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : publishStatus.step === 'failed' ? (
            <AlertCircle className="h-4 w-4 text-red-600" />
          ) : publishStatus.step === 'timeout' ? (
            <AlertCircle className="h-4 w-4 text-amber-600" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          )}
          <AlertDescription
            className={
              publishStatus.success
                ? 'text-green-900'
                : publishStatus.step === 'failed'
                ? 'text-red-900'
                : publishStatus.step === 'timeout'
                ? 'text-amber-900'
                : 'text-blue-900'
            }
          >
            {publishStatus.message}
          </AlertDescription>
        </Alert>
      )}

      {/* Ad Creative Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-purple-600" />
            广告创意
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Score Display - 使用7维度新评分系统 */}
          <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
            <div>
              <div className="text-sm text-gray-600 mb-1">综合评分</div>
              <div className={`text-3xl font-bold ${getScoreColor(selectedCreative.score)}`}>
                {selectedCreative.score.toFixed(1)}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {/* 显示7个维度 */}
              {selectedCreative.adStrength?.dimensions ? (
                <>
                  <div>
                    <span className="text-gray-600">相关性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.relevance.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">质量:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.quality.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">吸引力:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.completeness.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">多样性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.diversity.score}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">合规性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.adStrength.dimensions.compliance.score}</span>
                  </div>
                  {selectedCreative.adStrength.dimensions.brandSearchVolume && (
                    <div>
                      <span className="text-gray-600">品牌影响力:</span>{' '}
                      <span className="font-semibold">{selectedCreative.adStrength.dimensions.brandSearchVolume.score}</span>
                    </div>
                  )}
                  {selectedCreative.adStrength.dimensions.competitivePositioning && (
                    <div>
                      <span className="text-gray-600">竞争定位:</span>{' '}
                      <span className="font-semibold">{selectedCreative.adStrength.dimensions.competitivePositioning.score}</span>
                    </div>
                  )}
                </>
              ) : (
                /* 降级到旧的5维度显示（包含clarity） */
                <>
                  <div>
                    <span className="text-gray-600">相关性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.scoreBreakdown.relevance}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">质量:</span>{' '}
                    <span className="font-semibold">{selectedCreative.scoreBreakdown.quality}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">吸引力:</span>{' '}
                    <span className="font-semibold">{selectedCreative.scoreBreakdown.engagement}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">多样性:</span>{' '}
                    <span className="font-semibold">{selectedCreative.scoreBreakdown.diversity}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">清晰度:</span>{' '}
                    <span className="font-semibold">{selectedCreative.scoreBreakdown.clarity}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <Separator />

          {/* Creative Details */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">
                标题 ({effectiveHeadlines.length})
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {effectiveHeadlines.slice(0, 5).map((h: string, i: number) => (
                  <div key={i}>• {h}</div>
                ))}
                {effectiveHeadlines.length > 5 && (
                  <div className="text-gray-400">
                    +{effectiveHeadlines.length - 5} 更多...
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">
                描述 ({effectiveDescriptions.length})
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {effectiveDescriptions.map((d: string, i: number) => (
                  <div key={i}>• {d}</div>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">
              关键词 ({effectiveKeywords.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {effectiveKeywords.slice(0, 10).map((k: string, i: number) => (
                <Badge key={i} variant="outline" className="text-xs">
                  {k}
                </Badge>
              ))}
              {effectiveKeywords.length > 10 && (
                <Badge variant="outline" className="text-xs">
                  +{effectiveKeywords.length - 10}
                </Badge>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">
                Callouts ({effectiveCallouts.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {effectiveCallouts.slice(0, 8).map((c: string, i: number) => (
                  <Badge key={i} variant="outline" className="text-xs">
                    {c}
                  </Badge>
                ))}
                {effectiveCallouts.length > 8 && (
                  <Badge variant="outline" className="text-xs">
                    +{effectiveCallouts.length - 8}
                  </Badge>
                )}
              </div>
            </div>

            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">
                Sitelinks ({effectiveSitelinks.length})
              </div>
              <div className="space-y-1 text-sm text-gray-600">
                {effectiveSitelinks.slice(0, 4).map((sl: any, i: number) => (
                  <div key={i}>
                    • {getSitelinkText(sl) || '-'}
                    {getSitelinkUrl(sl) ? <span className="text-gray-400"> ({getSitelinkUrl(sl)})</span> : null}
                    {getSitelinkDescription(sl) ? <span className="text-gray-400"> - {getSitelinkDescription(sl)}</span> : null}
                  </div>
                ))}
                {effectiveSitelinks.length > 4 && (
                  <div className="text-gray-400">
                    +{effectiveSitelinks.length - 4} 更多...
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaign Configuration Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-600" />
            广告系列配置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-3">
              <div>
                <span className="text-gray-600">广告系列名称:</span>
                <div className="font-semibold mt-1">{campaignConfig.campaignName}</div>
              </div>
              <div>
                <span className="text-gray-600">预算:</span>
                <div className="font-semibold mt-1">
                  {currencySymbol}{campaignConfig.budgetAmount.toFixed(2)} /{' '}
                  {campaignConfig.budgetType === 'DAILY' ? '每日' : '总计'}
                </div>
              </div>
              <div>
                <span className="text-gray-600">目标国家/语言:</span>
                <div className="font-semibold mt-1">
                  {campaignConfig.targetCountry} / {campaignConfig.targetLanguage}
                </div>
              </div>
              <div>
                <span className="text-gray-600">出价策略:</span>
                <div className="font-semibold mt-1">{campaignConfig.biddingStrategy}</div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-gray-600">广告组名称:</span>
                <div className="font-semibold mt-1">{campaignConfig.adGroupName}</div>
              </div>
              <div>
                <span className="text-gray-600">最大CPC出价:</span>
                <div className="font-semibold mt-1">{currencySymbol}{campaignConfig.maxCpcBid.toFixed(2)}</div>
              </div>
              <div>
                <span className="text-gray-600">关键词数量:</span>
                <div className="font-semibold mt-1">{campaignConfig.keywords.length} 个</div>
              </div>
              <div>
                <span className="text-gray-600">否定关键词:</span>
                <div className="font-semibold mt-1">{campaignConfig.negativeKeywords.length} 个</div>
              </div>
            </div>
          </div>

          {campaignConfig.finalUrlSuffix && (
            <>
              <Separator className="my-4" />
              <div>
                <span className="text-sm text-gray-600">最终网址后缀:</span>
                <div className="text-sm font-mono bg-gray-50 p-2 rounded mt-1 break-all whitespace-pre-wrap">
                  {campaignConfig.finalUrlSuffix}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Google Ads Account Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Link2 className="w-5 h-5 text-green-600" />
            Google Ads账号（{accountsToPublish.length}）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {accountsToPublish.map((account: any) => (
              <div key={account.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="font-semibold">{account.accountName || '广告账号'}</div>
                  <div className="text-sm text-gray-600 font-mono mt-1">
                    {account.customerId}
                  </div>
                </div>
                <Badge variant="secondary" className="bg-gray-100 text-gray-800 border-gray-300">
                  {String(account.status || 'UNKNOWN').toUpperCase()}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Info Alert */}
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          <strong>发布须知</strong>
          <ul className="list-disc list-inside mt-2 space-y-1 text-sm">
            <li>广告发布后将进入Google Ads审核流程，通常需要1-2个工作日</li>
            <li>审核通过后广告将自动开始投放</li>
            <li>您可以随时在Google Ads后台查看和管理广告系列</li>
            <li>建议发布后密切关注广告表现，及时优化</li>
          </ul>
        </AlertDescription>
      </Alert>

      {/* 🔥 暂停确认对话框 */}
      <Dialog open={showPauseConfirm} onOpenChange={setShowPauseConfirm}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>检测到已激活的广告系列</DialogTitle>
            <DialogDescription>
              {pauseConfirmMessage}
            </DialogDescription>
          </DialogHeader>

          {existingCampaigns.length > 0 && (
            <div className="my-4">
              <h4 className="text-sm font-medium mb-2">当前激活的广告系列：</h4>
              <Table className="[&_thead_th]:bg-white">
                <TableHeader>
                  <TableRow>
                    <TableHead>广告系列名称</TableHead>
                    <TableHead>类型</TableHead>
                    <TableHead>预算</TableHead>
                    <TableHead>Campaign ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {existingCampaigns.map((camp: any) => (
                    <TableRow key={camp.id}>
                      <TableCell className="font-medium">{camp.name || '-'}</TableCell>
                      <TableCell>{camp.type || '-'}</TableCell>
                      <TableCell>{typeof camp.budget === 'number' ? `${currencySymbol}${camp.budget}` : '-'}</TableCell>
                      <TableCell className="font-mono text-xs">{camp.id}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogFooter className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setShowPauseConfirm(false)}
              disabled={publishing}
            >
              取消
            </Button>
            <Button
              variant="default"
              onClick={handlePublishTogether}
              disabled={publishing}
            >
              {publishing ? '发布中...' : '直接发布（A/B测试）'}
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmPauseAndPublish}
              disabled={publishing}
            >
              {publishing ? '暂停并发布中...' : '暂停旧系列并发布'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 🔥 新增：强制发布确认对话框（40-80分警告时）*/}
      <Dialog open={showForcePublishConfirm} onOpenChange={setShowForcePublishConfirm}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              确认强制发布
            </DialogTitle>
            <DialogDescription>
              该Offer的投放评分为 {launchScoreBlockDetails?.launchScore}分，低于建议值{launchScoreBlockDetails?.threshold}分
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
              <h4 className="text-sm font-semibold text-amber-900 mb-2">⚠️ 风险提示：</h4>
              <ul className="text-xs text-amber-800 space-y-1">
                <li>• 投放评分较低可能导致广告表现不佳</li>
                <li>• 建议先优化创意或配置后再发布</li>
                <li>• 强制发布需要自行承担风险</li>
              </ul>
            </div>

            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
              <h4 className="text-sm font-semibold text-blue-900 mb-2">💡 建议：</h4>
              <ul className="text-xs text-blue-800 space-y-1">
                {launchScoreBlockDetails?.suggestions?.slice(0, 3).map((suggestion: string, idx: number) => (
                  <li key={idx}>• {suggestion}</li>
                ))}
              </ul>
            </div>
          </div>

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowForcePublishConfirm(false)}
              disabled={publishing}
            >
              返回修改
            </Button>
            <Button
              variant="destructive"
              onClick={handleForcePublish}
              disabled={publishing}
            >
              {publishing ? '发布中...' : '确认强制发布'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
