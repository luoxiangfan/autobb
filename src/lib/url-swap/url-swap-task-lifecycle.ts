/**
 * Url-swap task lifecycle: create, update, enable/disable, execution state.
 */
import { logger } from '@/lib/common/server'
import { getDatabase, toDbJsonObjectField } from '@/lib/db'
import { resolveAffiliateLink } from '@/lib/scraping'
import { calculateNextSwapAt } from './url-swap-time'
import { validateUrlSwapTask, validateTaskConfig } from './url-swap-validator'
import { suspendUrlSwapTaskExecution } from './queue-cleanup'
import { isAffiliateLinkExpiredMessage } from '@/lib/affiliate'
import {
  resolveUrlSwapUrgentRiskAlertsForOffer,
  syncUrlSwapUrgentRiskAlert,
} from './alerts/urgent-alerts'
import type {
  UrlSwapTask,
  UrlSwapTaskStatus,
  UrlSwapMode,
  CreateUrlSwapTaskRequest,
  UpdateUrlSwapTaskRequest,
  SwapHistoryEntry,
  UrlSwapErrorType,
} from './url-swap-types'
import {
  normalizeManualAffiliateLinks,
  normalizeNullableString,
  normalizeUrlSwapMode,
} from './url-swap-row'
import {
  findGoogleAdsAccountIdByCustomerId,
  getOfferById,
  getOfferCampaignTargets,
} from './url-swap-offer-lookup'
import { ensureUrlSwapTaskTargets, getUrlSwapTaskTargets } from './url-swap-targets'
import { getUrlSwapTaskById } from './url-swap-queries'
import { syncStoreSitelinkTargetsForOffer } from './sync-store-sitelink-targets'
import { resumeUrlSwapSitelinkTargetsByTaskId } from './url-swap-sitelink-targets'

const INITIAL_URL_RESOLVE_TIMEOUT_MS = 8000

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }) as Promise<T>
}

async function resolveInitialUrlForTaskCreation(
  swapMode: UrlSwapMode,
  offer: any,
  userId: number
): Promise<{ finalUrl: string | null; finalUrlSuffix: string | null }> {
  if (swapMode !== 'auto') {
    return {
      finalUrl: offer.final_url || null,
      finalUrlSuffix: offer.final_url_suffix || null,
    }
  }

  try {
    return await withTimeout(
      resolveAffiliateLink(offer.affiliate_link, {
        targetCountry: offer.target_country,
        userId,
        skipCache: true,
      }),
      INITIAL_URL_RESOLVE_TIMEOUT_MS,
      'initial URL resolve'
    )
  } catch (error: any) {
    // 任务创建应优先成功，首次解析失败或超时由调度执行阶段兜底重试
    console.warn('[url-swap] 初始化URL解析失败，降级为使用Offer缓存URL:', error?.message || error)
    return {
      finalUrl: offer.final_url || null,
      finalUrlSuffix: offer.final_url_suffix || null,
    }
  }
}

export async function createUrlSwapTask(
  userId: number,
  input: CreateUrlSwapTaskRequest
): Promise<UrlSwapTask> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  const swapMode: UrlSwapMode = normalizeUrlSwapMode(input.swap_mode)
  const manualAffiliateLinks =
    swapMode === 'manual' ? normalizeManualAffiliateLinks(input.manual_affiliate_links) : []

  if (swapMode === 'manual' && manualAffiliateLinks.length === 0) {
    throw new Error('方式二需要至少配置 1 个推广链接')
  }

  // 1. 验证任务配置
  const intervalMinutes = input.swap_interval_minutes ?? 60
  const durationDays = input.duration_days ?? 7
  const configValidation = validateTaskConfig(intervalMinutes, durationDays)
  if (!configValidation.valid) {
    throw new Error(configValidation.error)
  }

  // 2. 获取Offer信息
  const offer = await getOfferById(input.offer_id)
  if (!offer) {
    throw new Error('Offer不存在或已被删除')
  }

  if (swapMode === 'auto') {
    if (!offer.affiliate_link) {
      throw new Error('Offer未配置联盟推广链接，无法创建换链任务')
    }
  }

  // 3. 验证代理配置（方式一/方式二均需要）
  if (swapMode === 'auto' || swapMode === 'manual') {
    const validation = await validateUrlSwapTask(input.offer_id)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  // 4. 初始化当前URL（首次解析超时/失败时使用Offer已有URL，避免阻塞创建请求）
  const resolved = await resolveInitialUrlForTaskCreation(swapMode, offer, userId)

  // 5. 获取关联的Campaign目标（支持多账号）
  const normalizedCustomerId = normalizeNullableString(input.google_customer_id)
  const normalizedCampaignId = normalizeNullableString(input.google_campaign_id)

  let targets = await getOfferCampaignTargets(input.offer_id, userId)

  if (normalizedCampaignId) {
    targets = targets.filter(
      (t) =>
        t.google_campaign_id === normalizedCampaignId &&
        (!normalizedCustomerId || t.google_customer_id === normalizedCustomerId)
    )
  } else if (normalizedCustomerId) {
    targets = targets.filter((t) => t.google_customer_id === normalizedCustomerId)
  }

  if (targets.length === 0 && normalizedCustomerId && normalizedCampaignId) {
    const accountId = await findGoogleAdsAccountIdByCustomerId(normalizedCustomerId, userId)
    if (accountId) {
      targets = [
        {
          google_ads_account_id: accountId,
          google_customer_id: normalizedCustomerId,
          google_campaign_id: normalizedCampaignId,
        },
      ]
    }
  }

  if (targets.length === 0) {
    throw new Error(
      '缺少 Customer ID 或 Campaign ID，无法创建换链任务（请先完成Campaign发布并关联到Offer）'
    )
  }

  const primaryTarget = targets[0]
  const googleCustomerId = primaryTarget.google_customer_id
  const googleCampaignId = primaryTarget.google_campaign_id

  // 6. 生成任务ID
  const taskId = crypto.randomUUID().toLowerCase()

  // 7. 计算首次执行时间
  const nextSwapAt = calculateNextSwapAt(intervalMinutes)

  // 手动模式：推广链接列表从头开始轮询
  let manualSuffixCursor = 0

  // 8. 创建任务
  await db.exec(
    `
    INSERT INTO url_swap_tasks (
      id, user_id, offer_id,
      swap_interval_minutes, enabled, duration_days,
      swap_mode, manual_affiliate_links, manual_suffix_cursor,
      google_customer_id, google_campaign_id,
      current_final_url, current_final_url_suffix,
      progress, total_swaps, success_swaps, failed_swaps, url_changed_count,
      swap_history,
      status, started_at, next_swap_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      taskId,
      userId,
      input.offer_id,
      intervalMinutes,
      true, // enabled
      durationDays,
      swapMode,
      toDbJsonObjectField(manualAffiliateLinks, []),
      manualSuffixCursor,
      googleCustomerId,
      googleCampaignId,
      resolved.finalUrl,
      resolved.finalUrlSuffix,
      0,
      0,
      0,
      0,
      0,
      toDbJsonObjectField([], []), // 空历史
      'enabled',
      now,
      nextSwapAt.toISOString(),
      now,
      now,
    ]
  )

  await ensureUrlSwapTaskTargets(taskId, input.offer_id, userId, targets)

  logger.debug(`[url-swap] 创建换链接任务成功: ${taskId}`)

  // Store Offer：Campaign 已发布 Sitelink 时，发布阶段因尚无换链任务会跳过映射，创建后异步回填
  void syncStoreSitelinkTargetsForOffer(input.offer_id, userId).catch((syncError: unknown) => {
    const message = syncError instanceof Error ? syncError.message : String(syncError)
    console.warn(`[url-swap] 创建任务后 Sitelink 映射同步失败（非致命）: ${message}`)
  })

  const task = await getUrlSwapTaskById(taskId, userId)
  if (!task) {
    throw new Error('任务创建失败')
  }
  task.targets = await getUrlSwapTaskTargets(taskId, userId)
  return task
}
export async function updateUrlSwapTask(
  id: string,
  userId: number,
  updates: UpdateUrlSwapTaskRequest
): Promise<UrlSwapTask> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  const existingTask = await getUrlSwapTaskById(id, userId)
  if (!existingTask) {
    throw new Error('任务不存在')
  }

  const normalizedGoogleCustomerId =
    updates.google_customer_id === '' ? null : updates.google_customer_id
  const normalizedGoogleCampaignId =
    updates.google_campaign_id === '' ? null : updates.google_campaign_id

  const swapModeAfter: UrlSwapMode =
    updates.swap_mode !== undefined
      ? normalizeUrlSwapMode(updates.swap_mode)
      : existingTask.swap_mode

  const manualAffiliateLinksAfter =
    updates.manual_affiliate_links !== undefined
      ? normalizeManualAffiliateLinks(updates.manual_affiliate_links)
      : existingTask.manual_affiliate_links

  if (swapModeAfter === 'manual' && manualAffiliateLinksAfter.length === 0) {
    throw new Error('方式二需要至少配置 1 个推广链接')
  }

  // 验证更新字段（用“更新后”的配置进行验证，避免仅更新单字段时误用默认值）
  if (updates.swap_interval_minutes !== undefined || updates.duration_days !== undefined) {
    const interval = updates.swap_interval_minutes ?? existingTask.swap_interval_minutes
    const duration = updates.duration_days ?? existingTask.duration_days
    const validation = validateTaskConfig(interval, duration)
    if (!validation.valid) {
      throw new Error(validation.error)
    }
  }

  const fields: string[] = []
  const values: any[] = []

  if (updates.swap_interval_minutes !== undefined) {
    fields.push('swap_interval_minutes = ?')
    values.push(updates.swap_interval_minutes)
  }

  if (updates.duration_days !== undefined) {
    fields.push('duration_days = ?')
    values.push(updates.duration_days)
  }

  if (updates.google_customer_id !== undefined) {
    fields.push('google_customer_id = ?')
    values.push(normalizedGoogleCustomerId)
  }

  if (updates.google_campaign_id !== undefined) {
    fields.push('google_campaign_id = ?')
    values.push(normalizedGoogleCampaignId)
  }

  if (updates.swap_mode !== undefined) {
    fields.push('swap_mode = ?')
    values.push(swapModeAfter)
  }

  if (updates.manual_affiliate_links !== undefined) {
    fields.push('manual_affiliate_links = ?')
    values.push(toDbJsonObjectField(manualAffiliateLinksAfter, []))
  }

  // 手动模式：当切换模式或更新列表时，重置游标（从头开始轮询）
  if (
    swapModeAfter === 'manual' &&
    (updates.swap_mode !== undefined || updates.manual_affiliate_links !== undefined)
  ) {
    fields.push('manual_suffix_cursor = ?')
    values.push(0)
  }

  // 从 error 状态编辑更新，视为用户已干预：清理错误并恢复为 enabled
  // （disabled/completed 不自动恢复，仍需用户显式启用）
  const intervalAfterUpdate = updates.swap_interval_minutes ?? existingTask.swap_interval_minutes
  if (existingTask.status === 'error') {
    fields.push('status = ?')
    values.push('enabled')
    fields.push('consecutive_failures = ?')
    values.push(0)
    fields.push('error_message = NULL')
    fields.push('error_at = NULL')
    fields.push('next_swap_at = ?')
    values.push(calculateNextSwapAt(intervalAfterUpdate).toISOString())
  } else if (existingTask.status === 'enabled' && updates.swap_interval_minutes !== undefined) {
    // 已启用任务修改间隔：重新计算下一次执行时间，立即生效
    fields.push('next_swap_at = ?')
    values.push(calculateNextSwapAt(intervalAfterUpdate).toISOString())
  }

  if (fields.length === 0) {
    return existingTask
  }

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id, userId)

  await db.exec(
    `
    UPDATE url_swap_tasks
    SET ${fields.join(', ')}
    WHERE id = ? AND user_id = ?
  `,
    values
  )

  logger.debug(`[url-swap] 更新任务配置: ${id}`)

  return (await getUrlSwapTaskById(id, userId))!
}

/**
 * 禁用任务
 */
export async function disableUrlSwapTask(id: string, userId: number): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  await db.exec(
    `
    UPDATE url_swap_tasks
    SET status = 'disabled', updated_at = ?
    WHERE id = ? AND user_id = ?
  `,
    [now, id, userId]
  )

  try {
    await suspendUrlSwapTaskExecution(id, userId)
  } catch (error) {
    console.warn(`[url-swap] 禁用任务后暂停子目标/清理队列失败: ${id}`, error)
  }

  const task = await getUrlSwapTaskById(id, userId)
  if (task) {
    try {
      await resolveUrlSwapUrgentRiskAlertsForOffer(userId, task.offer_id, '换链接任务已禁用')
    } catch (error: any) {
      console.warn(`[url-swap] 清理换链风险告警失败: ${id}`, error?.message || error)
    }
  }

  logger.debug(`[url-swap] 禁用任务: ${id}`)
}

/**
 * 启用任务
 */
export async function enableUrlSwapTask(id: string, userId: number): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const task = await getUrlSwapTaskById(id, userId)

  if (!task) {
    throw new Error('任务不存在')
  }

  // 计算下次执行时间
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)

  await db.exec(
    `
    UPDATE url_swap_tasks
    SET status = 'enabled', next_swap_at = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `,
    [nextSwapAt.toISOString(), now, id, userId]
  )

  // 同步恢复所有目标（除已移除/无效）
  await db.exec(
    `
    UPDATE url_swap_task_targets
    SET status = 'active', consecutive_failures = 0, last_error = NULL, updated_at = ?
    WHERE task_id = ? AND status NOT IN ('removed', 'invalid')
  `,
    [now, id]
  )

  await resumeUrlSwapSitelinkTargetsByTaskId(id)

  try {
    await resolveUrlSwapUrgentRiskAlertsForOffer(userId, task.offer_id)
  } catch (error: any) {
    console.warn(`[url-swap] 清理换链风险告警失败: ${id}`, error?.message || error)
  }

  logger.debug(`[url-swap] 启用任务: ${id}`)
}

const URL_SWAP_ERROR_THRESHOLD = 3

/**
 * 设置任务错误状态
 */
export async function setTaskError(
  id: string,
  errorMessage: string,
  errorType: UrlSwapErrorType = 'other'
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  // 1. 查询当前任务状态
  const task = await db.queryOne<{
    consecutive_failures: number
    failed_swaps: number
    total_swaps: number
    swap_interval_minutes: number
    user_id: number
    offer_id: number
    offer_name: string
  }>(
    `
    SELECT
      t.consecutive_failures,
      t.failed_swaps,
      t.total_swaps,
      t.swap_interval_minutes,
      t.user_id,
      t.offer_id,
      o.offer_name
    FROM url_swap_tasks t
    INNER JOIN offers o ON t.offer_id = o.id
    WHERE t.id = ?
  `,
    [id]
  )

  if (!task) {
    console.error(`[url-swap] 任务不存在: ${id}`)
    return
  }

  // 2. 计算新的连续失败次数
  const newConsecutiveFailures = task.consecutive_failures + 1

  const errorTypeLabel =
    errorType === 'link_resolution'
      ? '推广链接解析失败'
      : errorType === 'google_ads_api'
        ? 'Google Ads API调用失败'
        : '任务执行失败'

  // 3. 确定新状态和错误信息（单次失败不进入 error，继续 enabled 等下次时间点）
  const shouldMarkError = newConsecutiveFailures >= URL_SWAP_ERROR_THRESHOLD
  const newStatus: UrlSwapTaskStatus = shouldMarkError ? 'error' : 'enabled'

  const linkResolutionSuggestions = isAffiliateLinkExpiredMessage(errorMessage)
    ? `1. 在浏览器中直接访问推广链接，确认是否正常跳转到商品页\n` +
      `2. 若联盟平台显示 Invalid Link，请重新生成推广链接并更新 Offer\n` +
      `3. 更新后在任务详情页重新启用任务`
    : `1. 检查推广链接是否有效\n` +
      `2. 检查代理可用性/Playwright 资源是否足够\n` +
      `3. 修复后在任务详情页重新启用任务`

  const enhancedMessage = shouldMarkError
    ? `🔴 ${errorTypeLabel}连续失败 ${newConsecutiveFailures} 次，任务已标记为错误状态。\n\n` +
      `错误详情: ${errorMessage}\n\n` +
      `建议操作：\n` +
      `${
        errorType === 'link_resolution'
          ? linkResolutionSuggestions
          : errorType === 'google_ads_api'
            ? `1. 检查Google Ads账号权限/配额\n2. 确认OAuth/服务账号配置有效\n3. 修复后在任务详情页重新启用任务`
            : `1. 查看日志定位具体失败原因\n2. 修复后在任务详情页重新启用任务`
      }`
    : `⚠️ ${errorTypeLabel}（连续失败 ${newConsecutiveFailures}/${URL_SWAP_ERROR_THRESHOLD}）。\n\n` +
      `错误详情: ${errorMessage}\n\n` +
      `系统将在下一个执行时间点继续尝试。连续失败${URL_SWAP_ERROR_THRESHOLD}次后将标记为错误状态。`

  if (shouldMarkError) {
    console.warn(`[url-swap] ⚠️ 任务进入错误状态（连续失败${newConsecutiveFailures}次）: ${id}`)
    try {
      await suspendUrlSwapTaskExecution(id, task.user_id)
    } catch (suspendError: unknown) {
      const message = suspendError instanceof Error ? suspendError.message : String(suspendError)
      console.warn(`[url-swap] 任务错误后暂停子目标/清理队列失败: ${id}`, message)
    }
  } else {
    console.warn(
      `[url-swap] ⚠️ 任务失败但保持启用（连续失败${newConsecutiveFailures}/${URL_SWAP_ERROR_THRESHOLD}）: ${id}`
    )
  }

  // 4. 计算下次执行时间（即使失败也要推进时间，避免任务卡住）
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)

  // 5. 更新数据库
  await db.exec(
    `
    UPDATE url_swap_tasks
    SET
      status = ?,
      error_message = ?,
      error_at = ?,
      consecutive_failures = ?,
      next_swap_at = ?,
      updated_at = ?
    WHERE id = ?
  `,
    [newStatus, enhancedMessage, now, newConsecutiveFailures, nextSwapAt.toISOString(), now, id]
  )

  logger.debug(
    `[url-swap] 任务错误已记录: ${id} (连续失败: ${newConsecutiveFailures}, 状态: ${newStatus})`
  )

  if (shouldMarkError) {
    try {
      await syncUrlSwapUrgentRiskAlert({
        taskId: id,
        userId: task.user_id,
        offerId: task.offer_id,
        offerName: task.offer_name,
        errorMessage,
        errorType,
      })
    } catch (error: any) {
      console.warn(`[url-swap] 同步换链紧急告警失败: ${id}`, error?.message || error)
    }
  }
}

/**
 * 更新任务状态
 */
export async function updateTaskStatus(
  id: string,
  status: UrlSwapTaskStatus,
  nextSwapAt?: string
): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  if (nextSwapAt) {
    await db.exec(
      `
      UPDATE url_swap_tasks
      SET status = ?, next_swap_at = ?, updated_at = ?
      WHERE id = ?
    `,
      [status, nextSwapAt, now, id]
    )
  } else {
    await db.exec(
      `
      UPDATE url_swap_tasks
      SET status = ?, updated_at = ?
      WHERE id = ?
    `,
      [status, now, id]
    )
  }
}

/**
 * 记录换链历史
 */
export async function recordSwapHistory(taskId: string, entry: SwapHistoryEntry): Promise<void> {
  const db = await getDatabase()
  const task = await getUrlSwapTaskById(taskId, 0) // 使用userId=0避免权限检查

  if (!task) return

  const existingHistory = task.swap_history || []
  existingHistory.push(entry)

  // 只保留最近100条记录
  if (existingHistory.length > 100) {
    existingHistory.splice(0, existingHistory.length - 100)
  }

  await db.exec(
    `
    UPDATE url_swap_tasks
    SET swap_history = ?, updated_at = ?
    WHERE id = ?
  `,
    [toDbJsonObjectField(existingHistory, []), new Date().toISOString(), taskId]
  )
}

/**
 * 换链成功后更新任务
 */
export async function updateTaskAfterSwap(
  taskId: string,
  newFinalUrl: string | null,
  newFinalUrlSuffix: string,
  options?: {
    manualSuffixCursor?: number
  }
): Promise<void> {
  const db = await getDatabase()
  const task = await getUrlSwapTaskById(taskId, 0)
  if (!task) return

  const now = new Date().toISOString()
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)

  const extraFields: string[] = []
  const extraValues: any[] = []
  if (options?.manualSuffixCursor !== undefined) {
    extraFields.push('manual_suffix_cursor = ?')
    extraValues.push(options.manualSuffixCursor)
  }

  await db.exec(
    `
    UPDATE url_swap_tasks
    SET current_final_url = COALESCE(?, current_final_url),
        current_final_url_suffix = ?,
        total_swaps = total_swaps + 1,
        success_swaps = success_swaps + 1,
        url_changed_count = url_changed_count + 1,
        consecutive_failures = 0,
        error_message = NULL,
        error_at = NULL,
        ${extraFields.length > 0 ? `${extraFields.join(', ')},` : ''}
        next_swap_at = ?,
        updated_at = ?
    WHERE id = ?
  `,
    [newFinalUrl, newFinalUrlSuffix, ...extraValues, nextSwapAt.toISOString(), now, taskId]
  )

  logger.debug(`[url-swap] 换链成功更新: ${taskId}`)
}

/**
 * 手动模式：执行成功但suffix未变化（仍需前进游标）
 */
export async function updateTaskAfterManualAdvance(
  taskId: string,
  nextCursor: number
): Promise<void> {
  const db = await getDatabase()
  const task = await getUrlSwapTaskById(taskId, 0)
  if (!task) return

  const now = new Date().toISOString()
  const nextSwapAt = calculateNextSwapAt(task.swap_interval_minutes)

  await db.exec(
    `
    UPDATE url_swap_tasks
    SET total_swaps = total_swaps + 1,
        success_swaps = success_swaps + 1,
        consecutive_failures = 0,
        error_message = NULL,
        error_at = NULL,
        manual_suffix_cursor = ?,
        next_swap_at = ?,
        updated_at = ?
    WHERE id = ?
  `,
    [nextCursor, nextSwapAt.toISOString(), now, taskId]
  )
}
