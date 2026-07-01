/**
 * 换链接任务执行器
 * src/lib/queue/executors/url-swap-executor.ts
 *
 * 功能：执行换链接任务
 * 解析推广链接（禁用缓存）
 * 检测URL变化
 * 更新Google Ads（如有变化）
 * 记录历史
 */

import { logger } from '@/lib/common/server'
import type { Task } from '../types'
import {
  updateTaskAfterManualAdvance,
  updateTaskAfterSwap,
  recordSwapHistory,
  setTaskError,
  getUrlSwapTaskTargets,
} from '@/lib/url-swap'
import type {
  UrlSwapTaskData,
  UrlSwapTaskTarget,
  SwapHistoryEntry,
  UrlSwapErrorType,
} from '@/lib/url-swap/url-swap-types'
import { shouldRunUrlSwapSitelinkPhase } from '@/lib/url-swap/url-swap-sitelink-updater'
import { getDatabase } from '@/lib/db'
import { initializeProxyPool } from '@/lib/offers/server'
import { assertUserExecutionAllowed } from '@/lib/campaign/server'
import { isTruthyFlag } from '@/lib/campaign/publish/publish-route-helpers'
import { isAffiliateLinkExpiredMessage } from '@/lib/affiliate'
import { validateUrlSwapDomainChange } from '@/lib/url-swap/url-swap-domain-validation'
import {
  resolveAffiliateLinkForUrlSwap,
  shouldRetryUrlSwapTargetOnSameSuffix,
} from '@/lib/url-swap/url-swap-resolve-config'
import {
  formatUrlSwapGoogleAdsError,
  isOAuthInvalidGrantError,
  isHttpUrl,
  parseUrlSwapStringArrayJson,
  recordUrlSwapHistoryWithSitelinkPhase,
  updateUrlSwapTargetsFinalUrlSuffix,
} from '@/lib/url-swap/url-swap-campaign-updater'

/**
 * 导出任务数据类型（供index.ts使用）
 */
export type { UrlSwapTaskData }

/**
 * 执行换链接任务
 */
export async function executeUrlSwapTask(
  task: Task<UrlSwapTaskData>
): Promise<{ success: boolean; changed: boolean }> {
  const {
    taskId,
    offerId,
    affiliateLink,
    targetCountry,
    googleCustomerId,
    googleCampaignId,
    currentFinalUrl,
    currentFinalUrlSuffix,
  } = task.data

  logger.debug(`[url-swap-executor] 开始执行任务: ${taskId}, offer: ${offerId}`)
  await assertUserExecutionAllowed(task.userId, { source: `url-swap:${task.id}` })

  let effectiveCurrentFinalUrl: string | null = currentFinalUrl
  let effectiveCurrentFinalUrlSuffix: string | null = currentFinalUrlSuffix

  try {
    // 读取任务最新配置（用于方式二/以及避免队列数据过期）
    const db = await getDatabase()
    const taskRow = await db.queryOne<any>(
      `
      SELECT
        status,
        is_deleted,
        swap_mode,
        manual_affiliate_links,
        manual_suffix_cursor,
        current_final_url,
        current_final_url_suffix,
        google_customer_id,
        google_campaign_id
      FROM url_swap_tasks
      WHERE id = ?
    `,
      [taskId]
    )

    if (!taskRow) {
      throw new Error('任务不存在或已被删除')
    }

    const status = String(taskRow.status || '').toLowerCase()
    const isDeleted = isTruthyFlag(taskRow.is_deleted)
    if (isDeleted || status !== 'enabled') {
      logger.debug(
        `[url-swap-executor] 跳过执行: taskId=${taskId}, status=${status || 'unknown'}, isDeleted=${isDeleted}`
      )
      return { success: false, changed: false }
    }

    const swapMode = taskRow.swap_mode === 'manual' ? 'manual' : 'auto'
    const effectiveCustomerId = (taskRow.google_customer_id ?? googleCustomerId) as string | null
    const effectiveCampaignId = (taskRow.google_campaign_id ?? googleCampaignId) as string | null
    effectiveCurrentFinalUrl = (
      typeof taskRow.current_final_url === 'string' ? taskRow.current_final_url : currentFinalUrl
    ) as string | null
    effectiveCurrentFinalUrlSuffix = (
      typeof taskRow.current_final_url_suffix === 'string'
        ? taskRow.current_final_url_suffix
        : currentFinalUrlSuffix
    ) as string | null

    const activeTargets = await getUrlSwapTaskTargets(taskId, task.userId, { status: 'active' })
    const fallbackTargets: UrlSwapTaskTarget[] =
      !activeTargets.length && effectiveCustomerId && effectiveCampaignId
        ? [
            {
              id: '',
              task_id: taskId,
              offer_id: offerId,
              google_ads_account_id: 0,
              google_customer_id: effectiveCustomerId,
              google_campaign_id: effectiveCampaignId,
              status: 'active',
              consecutive_failures: 0,
              last_success_at: null,
              last_error: null,
              created_at: '',
              updated_at: '',
            },
          ]
        : []
    const taskTargets = activeTargets.length > 0 ? activeTargets : fallbackTargets

    // 方式二：手动轮询推广链接列表

    if (swapMode === 'manual') {
      const manualAffiliateLinks = parseUrlSwapStringArrayJson(taskRow.manual_affiliate_links)
      if (manualAffiliateLinks.length === 0) {
        throw new Error('方式二未配置推广链接列表，请在任务设置中添加至少 1 个')
      }

      const cursorRaw = taskRow.manual_suffix_cursor
      const cursor =
        typeof cursorRaw === 'number' ? cursorRaw : parseInt(String(cursorRaw ?? '0'), 10)
      const safeCursor = Number.isFinite(cursor) && cursor >= 0 ? cursor : 0

      const selectedLink = manualAffiliateLinks[safeCursor % manualAffiliateLinks.length]
      const nextCursor = (safeCursor + 1) % manualAffiliateLinks.length

      if (!isHttpUrl(selectedLink)) {
        throw new Error('推广链接格式错误（需http/https），请重新配置方式二列表')
      }

      const currentUrlFromDb =
        typeof taskRow.current_final_url === 'string' ? taskRow.current_final_url : ''
      const currentSuffixFromDb =
        typeof taskRow.current_final_url_suffix === 'string' ? taskRow.current_final_url_suffix : ''

      // 确保代理池已按该用户的设置加载
      await initializeProxyPool(task.userId, targetCountry)
      await assertUserExecutionAllowed(task.userId, {
        source: `url-swap:manual-before-resolve:${task.id}`,
      })

      logger.debug(`[url-swap-executor]（manual）解析推广链接: ${selectedLink}`)
      const resolved = await resolveAffiliateLinkForUrlSwap({
        affiliateLink: selectedLink,
        targetCountry,
        userId: task.userId,
      })

      const urlChanged =
        resolved.finalUrl !== currentUrlFromDb || resolved.finalUrlSuffix !== currentSuffixFromDb

      if (!taskTargets.length) {
        const message =
          '缺少 Customer ID 或 Campaign ID，无法更新 Google Ads Final URL suffix。\n' +
          '请在换链任务中填写正确的 Customer/Campaign ID（或先完成Campaign发布并关联到Offer），然后重新启用任务。'

        await recordSwapHistory(taskId, {
          swapped_at: new Date().toISOString(),
          previous_final_url: currentUrlFromDb,
          previous_final_url_suffix: currentSuffixFromDb,
          new_final_url: resolved.finalUrl,
          new_final_url_suffix: resolved.finalUrlSuffix,
          success: false,
          error_message: message,
        })

        await updateTaskStats(taskId, false, false)
        await setTaskError(taskId, message, 'google_ads_api')
        return { success: false, changed: false }
      }

      if (urlChanged && currentUrlFromDb) {
        const validation = validateUrlSwapDomainChange(currentUrlFromDb, resolved.finalUrl)
        if (!validation.valid) {
          console.error(`[url-swap-executor] 落地页校验失败: ${taskId} - ${validation.error}`)
          await setTaskError(taskId, validation.error!, validation.errorType ?? 'link_resolution')
          return { success: false, changed: false }
        }
      }

      const targetsToUpdate = urlChanged
        ? taskTargets
        : taskTargets.filter(shouldRetryUrlSwapTargetOnSameSuffix)

      let updateResult: { successCount: number; failureCount: number; failures: string[] } | null =
        null
      if (targetsToUpdate.length > 0) {
        logger.debug(`[url-swap-executor]（manual）更新Google Ads目标数: ${targetsToUpdate.length}`)

        let adsApiError: Error | null = null

        try {
          updateResult = await updateUrlSwapTargetsFinalUrlSuffix({
            targets: targetsToUpdate,
            finalUrlSuffix: resolved.finalUrlSuffix,
            userId: task.userId,
            db,
          })
        } catch (adsError: any) {
          const message = formatUrlSwapGoogleAdsError(adsError)
          adsApiError = message.includes('Google Ads')
            ? new Error(message)
            : new Error(`Google Ads API调用失败: ${message}`)
        }

        if (adsApiError) {
          throw adsApiError
        }
      }

      if (urlChanged) {
        const hasSuccess = (updateResult?.successCount ?? 0) > 0
        if (targetsToUpdate.length > 0 && !hasSuccess) {
          throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
        }
      } else {
        const hasUpdates = targetsToUpdate.length > 0
        const hasSuccess = (updateResult?.successCount ?? 0) > 0
        if (hasUpdates && !hasSuccess) {
          throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
        }
      }

      const historyEntry: SwapHistoryEntry = {
        swapped_at: new Date().toISOString(),
        previous_final_url: currentUrlFromDb,
        previous_final_url_suffix: currentSuffixFromDb,
        new_final_url: resolved.finalUrl,
        new_final_url_suffix: resolved.finalUrlSuffix,
        success: true,
      }
      const campaignUpdateAttempted = targetsToUpdate.length > 0
      const sitelinkPhase = await recordUrlSwapHistoryWithSitelinkPhase({
        taskId,
        offerId,
        userId: task.userId,
        targetCountry,
        db,
        entry: historyEntry,
        runSitelink: shouldRunUrlSwapSitelinkPhase({
          campaignUpdateAttempted,
          campaignUpdateSuccessCount: updateResult?.successCount ?? 0,
        }),
      })

      if (urlChanged) {
        await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix, {
          manualSuffixCursor: nextCursor,
        })
      } else {
        await updateTaskAfterManualAdvance(taskId, nextCursor)
        if (sitelinkPhase.changed) {
          const now = new Date().toISOString()
          await db.exec(
            `UPDATE url_swap_tasks SET url_changed_count = url_changed_count + 1, updated_at = ? WHERE id = ?`,
            [now, taskId]
          )
        }
      }

      const overallChanged = urlChanged || sitelinkPhase.changed
      logger.debug(
        `[url-swap-executor]（manual）换链执行完成: ${taskId}, changed=${overallChanged}`
      )
      return { success: true, changed: overallChanged }
    }

    // 方式一：自动解析推广链接

    if (!taskTargets.length) {
      const message =
        '缺少 Customer ID 或 Campaign ID，无法更新 Google Ads Final URL suffix。\n' +
        '请在换链任务中填写正确的 Customer/Campaign ID（或先完成Campaign发布并关联到Offer），然后重新启用任务。'

      await recordSwapHistory(taskId, {
        swapped_at: new Date().toISOString(),
        previous_final_url: effectiveCurrentFinalUrl || '',
        previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
        new_final_url: '',
        new_final_url_suffix: '',
        success: false,
        error_message: message,
      })

      await updateTaskStats(taskId, false, false)
      await setTaskError(taskId, message, 'google_ads_api')
      return { success: false, changed: false }
    }

    // 确保代理池已按该用户的设置加载（executor 运行在队列进程中，不能假设已初始化）
    await initializeProxyPool(task.userId, targetCountry)
    await assertUserExecutionAllowed(task.userId, {
      source: `url-swap:auto-before-resolve:${task.id}`,
    })

    // 1. 解析推广链接（禁用缓存，确保获取最新URL）
    logger.debug(`[url-swap-executor] 解析推广链接: ${affiliateLink}`)
    const resolved = await resolveAffiliateLinkForUrlSwap({
      affiliateLink,
      targetCountry,
      userId: task.userId,
    })

    logger.debug(
      `[url-swap-executor] 解析结果: finalUrl=${resolved.finalUrl}, suffix=${resolved.finalUrlSuffix}`
    )

    // 2. 对比是否发生变化
    const urlChanged =
      resolved.finalUrl !== effectiveCurrentFinalUrl ||
      resolved.finalUrlSuffix !== effectiveCurrentFinalUrlSuffix

    if (!urlChanged) {
      const retryTargets = taskTargets.filter(shouldRetryUrlSwapTargetOnSameSuffix)
      if (retryTargets.length === 0) {
        logger.debug(`[url-swap-executor] URL未变化: ${taskId}`)
        await updateTaskStats(taskId, true, false)
        return { success: true, changed: false }
      }

      logger.debug(`[url-swap-executor] URL未变化，尝试重试失败目标: ${retryTargets.length}`)
      let retryResult: { successCount: number; failureCount: number; failures: string[] } | null =
        null
      try {
        retryResult = await updateUrlSwapTargetsFinalUrlSuffix({
          targets: retryTargets,
          finalUrlSuffix: resolved.finalUrlSuffix,
          userId: task.userId,
          db,
        })
      } catch (adsError: any) {
        const message = formatUrlSwapGoogleAdsError(adsError)
        throw new Error(
          message.includes('Google Ads') ? message : `Google Ads API调用失败: ${message}`
        )
      }

      const hasSuccess = (retryResult?.successCount ?? 0) > 0
      if (!hasSuccess) {
        throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
      }

      const sitelinkPhase = await recordUrlSwapHistoryWithSitelinkPhase({
        taskId,
        offerId,
        userId: task.userId,
        targetCountry,
        db,
        entry: {
          swapped_at: new Date().toISOString(),
          previous_final_url: effectiveCurrentFinalUrl || '',
          previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
          new_final_url: resolved.finalUrl,
          new_final_url_suffix: resolved.finalUrlSuffix,
          success: true,
        },
        runSitelink: shouldRunUrlSwapSitelinkPhase({
          campaignUpdateAttempted: retryTargets.length > 0,
          campaignUpdateSuccessCount: retryResult?.successCount ?? 0,
        }),
      })
      await updateTaskStats(taskId, true, sitelinkPhase.changed)
      return { success: true, changed: sitelinkPhase.changed }
    }

    logger.debug(`[url-swap-executor] 检测到URL变化: ${taskId}`)

    // 3. 验证域名一致性（防止盗链）
    if (effectiveCurrentFinalUrl) {
      const validation = validateUrlSwapDomainChange(effectiveCurrentFinalUrl, resolved.finalUrl)
      if (!validation.valid) {
        console.error(`[url-swap-executor] 落地页校验失败: ${taskId} - ${validation.error}`)
        await setTaskError(taskId, validation.error!, validation.errorType ?? 'link_resolution')
        return { success: false, changed: false }
      }
    }

    // 4. 调用Google Ads API更新（多目标）
    const targetsToUpdate = taskTargets
    let updateResult: { successCount: number; failureCount: number; failures: string[] } | null =
      null

    if (targetsToUpdate.length > 0) {
      logger.debug(`[url-swap-executor] 更新Google Ads目标数: ${targetsToUpdate.length}`)

      try {
        updateResult = await updateUrlSwapTargetsFinalUrlSuffix({
          targets: targetsToUpdate,
          finalUrlSuffix: resolved.finalUrlSuffix,
          userId: task.userId,
          db,
        })

        logger.debug(`[url-swap-executor] Google Ads更新完成: ${taskId}`)
      } catch (adsError: any) {
        const message = formatUrlSwapGoogleAdsError(adsError)
        console.error(`[url-swap-executor] Google Ads更新失败: ${taskId}`, message)
        throw new Error(
          message.includes('Google Ads') ? message : `Google Ads API调用失败: ${message}`
        )
      }
    }

    const hasSuccess = (updateResult?.successCount ?? 0) > 0
    if (targetsToUpdate.length > 0 && !hasSuccess) {
      throw new Error('Google Ads 更新失败（所有目标均未更新成功）')
    }

    // 5. 记录换链历史 + Sitelink suffix 更新（Campaign 成功后才联动 Sitelink）
    await recordUrlSwapHistoryWithSitelinkPhase({
      taskId,
      offerId,
      userId: task.userId,
      targetCountry,
      db,
      entry: {
        swapped_at: new Date().toISOString(),
        previous_final_url: effectiveCurrentFinalUrl || '',
        previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
        new_final_url: resolved.finalUrl,
        new_final_url_suffix: resolved.finalUrlSuffix,
        success: true,
      },
      runSitelink: shouldRunUrlSwapSitelinkPhase({
        campaignUpdateAttempted: targetsToUpdate.length > 0,
        campaignUpdateSuccessCount: updateResult?.successCount ?? 0,
      }),
    })

    // 6. 更新任务状态
    await updateTaskAfterSwap(taskId, resolved.finalUrl, resolved.finalUrlSuffix)

    logger.debug(`[url-swap-executor] 换链成功: ${taskId}`)
    return { success: true, changed: true }
  } catch (error: any) {
    const rawMessage = error?.message || String(error)
    console.error(`[url-swap-executor] 执行失败: ${taskId}`, rawMessage)

    // 检测错误类型
    let errorType: UrlSwapErrorType = 'other'
    let enhancedMessage = rawMessage

    // 检测 IPRocket 代理服务商业务错误（优先级最高，需要特殊处理）
    if (
      rawMessage.includes('IPRocket') &&
      (rawMessage.includes('Business abnormality') ||
        rawMessage.includes('business error') ||
        rawMessage.includes('contact customer service'))
    ) {
      errorType = 'link_resolution'
      enhancedMessage =
        `🔴 IPRocket 代理服务商返回业务异常\n\n` +
        `可能原因：\n` +
        `1. 账户配额已用完 - 请检查 IPRocket 账户余额和流量\n` +
        `2. 账户被暂停或限制 - 请联系 IPRocket 客服确认账户状态\n` +
        `3. 触发风控限制 - 请降低请求频率或更换代理服务商\n` +
        `4. 服务商临时故障 - 请稍后重试\n\n` +
        `建议操作：\n` +
        `✓ 登录 IPRocket 控制台检查账户状态\n` +
        `✓ 考虑更换代理服务商（Oxylabs、Bright Data 等）\n` +
        `✓ 或暂时禁用部分任务，降低请求频率\n` +
        `✓ 修复后在任务详情页重新启用任务\n\n` +
        `原始错误: ${rawMessage}`
    }
    // 检测推广链接解析失败
    else if (
      isAffiliateLinkExpiredMessage(rawMessage) ||
      rawMessage.includes('resolve') ||
      rawMessage.includes('affiliate') ||
      rawMessage.includes('推广链接') ||
      rawMessage.includes('URL解析失败') ||
      rawMessage.includes('Playwright解析失败') ||
      rawMessage.includes('无法访问') ||
      rawMessage.includes('Failed to fetch') ||
      rawMessage.includes('timeout') ||
      rawMessage.includes('ENOTFOUND') ||
      rawMessage.includes('ECONNREFUSED') ||
      rawMessage.includes('network')
    ) {
      errorType = 'link_resolution'
      enhancedMessage = isAffiliateLinkExpiredMessage(rawMessage)
        ? rawMessage
        : `推广链接解析失败: ${rawMessage}`
    }
    // 检测Google Ads API失败
    else if (
      rawMessage.includes('Google Ads') ||
      rawMessage.includes('google_ads') ||
      rawMessage.includes('campaign') ||
      rawMessage.includes('Customer') ||
      rawMessage.includes('authentication') ||
      rawMessage.includes('authorization') ||
      rawMessage.includes('OAuth') ||
      rawMessage.includes('refresh_token') ||
      rawMessage.includes('quota') ||
      rawMessage.includes('API')
    ) {
      errorType = 'google_ads_api'
      const formattedMessage = formatUrlSwapGoogleAdsError(error)
      const message =
        formattedMessage && formattedMessage !== 'Google Ads API error'
          ? formattedMessage
          : rawMessage
      if (isOAuthInvalidGrantError(rawMessage)) {
        enhancedMessage =
          `Google OAuth 授权已过期或被撤销（invalid_grant），无法更新 Google Ads。\n` +
          `请前往设置页面重新授权，然后重新启用该任务。\n\n` +
          `错误详情: ${message}`
      } else {
        enhancedMessage = message.startsWith('Google Ads')
          ? message
          : `Google Ads API调用失败: ${message}`
      }
    }

    // 记录错误历史
    await recordSwapHistory(taskId, {
      swapped_at: new Date().toISOString(),
      previous_final_url: effectiveCurrentFinalUrl || '',
      previous_final_url_suffix: effectiveCurrentFinalUrlSuffix || '',
      new_final_url: '',
      new_final_url_suffix: '',
      success: false,
      error_message: enhancedMessage,
    })

    // 更新失败统计
    await updateTaskStats(taskId, false, false)

    // 设置错误状态（带错误类型分类）
    await setTaskError(taskId, enhancedMessage, errorType)

    return { success: false, changed: false }
  }
}

/**
 * 更新任务统计
 */
async function updateTaskStats(taskId: string, success: boolean, changed: boolean): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()

  // 获取任务信息以计算下次执行时间
  const taskRow = await db.queryOne<{ swap_interval_minutes: number }>(
    `
    SELECT swap_interval_minutes FROM url_swap_tasks WHERE id = ?
  `,
    [taskId]
  )

  if (!taskRow) {
    console.error(`[url-swap-executor] 任务不存在: ${taskId}`)
    return
  }

  const { calculateNextSwapAt } = await import('@/lib/url-swap/url-swap-time')
  const nextSwapAt = calculateNextSwapAt(taskRow.swap_interval_minutes)

  if (success) {
    await db.exec(
      `
      UPDATE url_swap_tasks
      SET total_swaps = total_swaps + 1,
          ${changed ? 'url_changed_count = url_changed_count + 1,' : ''}
          success_swaps = success_swaps + 1,
          consecutive_failures = 0,
          error_message = NULL,
          error_at = NULL,
          next_swap_at = ?,
          updated_at = ?
      WHERE id = ?
    `,
      [nextSwapAt.toISOString(), now, taskId]
    )
  } else {
    await db.exec(
      `
      UPDATE url_swap_tasks
      SET total_swaps = total_swaps + 1,
          failed_swaps = failed_swaps + 1,
          updated_at = ?
      WHERE id = ?
    `,
      [now, taskId]
    )
  }
}
