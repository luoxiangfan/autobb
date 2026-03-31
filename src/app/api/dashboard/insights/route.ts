import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

/**
 * 智能洞察
 */
interface Insight {
  id: string
  type: 'warning' | 'success' | 'info' | 'error'
  priority: 'high' | 'medium' | 'low'
  title: string
  message: string
  recommendation: string
  relatedCampaign?: {
    id: number
    name: string
  }
  relatedOffer?: {
    id: number
    name: string
    url: string
  }
  metrics?: {
    current: number
    benchmark: number
    change: number
  }
  createdAt: string
}

/**
 * GET /api/dashboard/insights
 * 基于规则引擎生成智能洞察
 * Query参数：
 * - days: 分析天数（默认7）
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证用户身份
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const userId = authResult.user.userId

    // 获取查询参数
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '7', 10)

    // 计算日期范围（使用本地时区，days=7 表示含今天在内的7天窗口）
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days + 1)

    console.log(`[Insights API] days=${days}, startDate=${formatDate(startDate)}, endDate=${formatDate(endDate)}`)

    const db = await getDatabase()

    const insights: Insight[] = []

    // 规则1: 检查CTR异常低的Campaign
    const lowCtrQuery = `
      SELECT
        c.id,
        c.campaign_name,
        SUM(cp.impressions) as impressions,
        SUM(cp.clicks) as clicks,
        ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) as ctr
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
      GROUP BY c.id, c.campaign_name
      HAVING SUM(cp.impressions) > 100 AND ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) < 1.0
      ORDER BY ctr ASC
      LIMIT 3
    `

    const lowCtrCampaigns = await db.query(
      lowCtrQuery,
      [userId, formatDate(startDate), formatDate(endDate)]
    ) as Array<{
      id: number
      campaign_name: string
      impressions: number
      clicks: number
      ctr: number
    }>

    lowCtrCampaigns.forEach((campaign) => {
      insights.push({
        id: `ctr-low-${campaign.id}`,
        type: 'warning',
        priority: 'high',
        title: 'CTR过低需要优化',
        message: `Campaign "${campaign.campaign_name}" 的CTR仅为 ${campaign.ctr}%，低于行业均值（1-2%）`,
        recommendation:
          '建议：1) 优化广告创意文案，2) 调整关键词匹配类型，3) 提升广告质量评分',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.ctr,
          benchmark: 1.5,
          change: campaign.ctr - 1.5,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则2: 检查花费超标的Campaign
    const highCostQuery = `
      SELECT
        c.id,
        c.campaign_name,
        c.budget_amount,
        SUM(cp.cost) as total_cost,
        ROUND(SUM(cp.cost) / NULLIF(c.budget_amount, 0) / ? * 100, 2) as spend_rate
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
        AND c.budget_amount > 0
      GROUP BY c.id, c.campaign_name, c.budget_amount
      HAVING ROUND(SUM(cp.cost) / NULLIF(c.budget_amount, 0) / ? * 100, 2) > 120
      ORDER BY spend_rate DESC
      LIMIT 3
    `

    const highCostCampaigns = await db.query(
      highCostQuery,
      [days, userId, formatDate(startDate), formatDate(endDate), days]
    ) as Array<{
      id: number
      campaign_name: string
      budget_amount: number
      total_cost: number
      spend_rate: number
    }>

    highCostCampaigns.forEach((campaign) => {
      insights.push({
        id: `cost-high-${campaign.id}`,
        type: 'error',
        priority: 'high',
        title: '花费超出预算',
        message: `Campaign "${campaign.campaign_name}" 实际花费已达预算的 ${campaign.spend_rate}%`,
        recommendation:
          '建议：1) 检查预算设置，2) 暂停低效关键词，3) 调整出价策略',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.total_cost,
          benchmark: campaign.budget_amount,
          change: ((campaign.spend_rate - 100) / 100) * campaign.budget_amount,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则3: 检查转化率低的Campaign
    const lowConversionQuery = `
      SELECT
        c.id,
        c.campaign_name,
        SUM(cp.clicks) as clicks,
        SUM(cp.conversions) as conversions,
        ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) as conversion_rate
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
      GROUP BY c.id, c.campaign_name
      HAVING SUM(cp.clicks) > 50 AND ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) < 2.0
      ORDER BY conversion_rate ASC
      LIMIT 3
    `

    const lowConversionCampaigns = await db.query(
      lowConversionQuery,
      [userId, formatDate(startDate), formatDate(endDate)]
    ) as Array<{
      id: number
      campaign_name: string
      clicks: number
      conversions: number
      conversion_rate: number
    }>

    lowConversionCampaigns.forEach((campaign) => {
      insights.push({
        id: `conversion-low-${campaign.id}`,
        type: 'warning',
        priority: 'medium',
        title: '转化率偏低',
        message: `Campaign "${campaign.campaign_name}" 的转化率为 ${campaign.conversion_rate}%，低于行业基准（2-5%）`,
        recommendation:
          '建议：1) 优化着陆页体验，2) 检查转化追踪设置，3) 调整目标受众定位',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.conversion_rate,
          benchmark: 3.0,
          change: campaign.conversion_rate - 3.0,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则4: 检查表现优异的Campaign
    const topPerformingQuery = `
      SELECT
        c.id,
        c.campaign_name,
        SUM(cp.impressions) as impressions,
        SUM(cp.clicks) as clicks,
        SUM(cp.conversions) as conversions,
        ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) as ctr,
        ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) as conversion_rate
      FROM campaigns c
      INNER JOIN campaign_performance cp ON c.id = cp.campaign_id
      WHERE c.user_id = ?
        AND cp.date >= ?
        AND cp.date <= ?
      GROUP BY c.id, c.campaign_name
      HAVING SUM(cp.impressions) > 100
        AND ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) > 3.0
        AND ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2) > 5.0
      ORDER BY (ROUND(CAST(SUM(cp.clicks) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.impressions), 0), 2) + ROUND(CAST(SUM(cp.conversions) AS NUMERIC) * 100.0 / NULLIF(SUM(cp.clicks), 0), 2)) DESC
      LIMIT 2
    `

    const topCampaigns = await db.query(
      topPerformingQuery,
      [userId, formatDate(startDate), formatDate(endDate)]
    ) as Array<{
      id: number
      campaign_name: string
      impressions: number
      clicks: number
      conversions: number
      ctr: number
      conversion_rate: number
    }>

    topCampaigns.forEach((campaign) => {
      insights.push({
        id: `performance-top-${campaign.id}`,
        type: 'success',
        priority: 'low',
        title: '表现优异',
        message: `Campaign "${campaign.campaign_name}" 表现出色！CTR ${campaign.ctr}%，转化率 ${campaign.conversion_rate}%`,
        recommendation:
          '建议：1) 增加该Campaign预算，2) 分析成功要素并复用到其他Campaign，3) 持续优化保持优势',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        metrics: {
          current: campaign.ctr + campaign.conversion_rate,
          benchmark: 5.0,
          change: campaign.ctr + campaign.conversion_rate - 5.0,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则5: 检查长期未更新的Campaign
    // 使用数据库兼容的日期计算方式
    const staleQuery = db.type === 'postgres'
      ? `
        SELECT
          c.id,
          c.campaign_name,
          c.updated_at,
          EXTRACT(DAY FROM (CURRENT_TIMESTAMP - c.updated_at::timestamp)) as days_since_update
        FROM campaigns c
        WHERE c.user_id = ?
          AND c.status IN ('ENABLED', 'ACTIVE')
          AND EXTRACT(DAY FROM (CURRENT_TIMESTAMP - c.updated_at::timestamp)) > 30
        ORDER BY days_since_update DESC
        LIMIT 2
      `
      : `
        SELECT
          c.id,
          c.campaign_name,
          c.updated_at,
          julianday('now') - julianday(c.updated_at) as days_since_update
        FROM campaigns c
        WHERE c.user_id = ?
          AND c.status IN ('ENABLED', 'ACTIVE')
          AND days_since_update > 30
        ORDER BY days_since_update DESC
        LIMIT 2
      `

    const staleCampaigns = await db.query(staleQuery, [userId]) as Array<{
      id: number
      campaign_name: string
      updated_at: string
      days_since_update: number
    }>

    staleCampaigns.forEach((campaign) => {
      insights.push({
        id: `stale-${campaign.id}`,
        type: 'info',
        priority: 'low',
        title: '建议定期优化',
        message: `Campaign "${campaign.campaign_name}" 已 ${Math.floor(campaign.days_since_update)} 天未更新`,
        recommendation:
          '建议：1) 检查性能数据，2) 测试新的广告创意，3) 调整关键词和出价',
        relatedCampaign: {
          id: campaign.id,
          name: campaign.campaign_name,
        },
        createdAt: new Date().toISOString(),
      })
    })

    // 规则6: 检查每日链接检查结果
    // 获取最近24小时内的链接检查结果，只显示有问题的链接
    // 注意：PostgreSQL中 is_accessible, brand_found, content_valid 是 INTEGER 类型 (0/1)
    const linkCheckQuery = db.type === 'postgres'
      ? `
        SELECT
          lch.id,
          lch.offer_id,
          o.offer_name,
          o.url as product_url,
          lch.is_accessible,
          lch.http_status_code,
          lch.brand_found,
          lch.content_valid,
          lch.validation_message,
          lch.error_message,
          lch.checked_at
        FROM link_check_history lch
        INNER JOIN offers o ON lch.offer_id = o.id
        WHERE o.user_id = ?
          AND lch.checked_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
          AND (
            lch.is_accessible = 0
            OR lch.brand_found = 0
            OR lch.content_valid = 0
          )
        ORDER BY lch.checked_at DESC
        LIMIT 5
      `
      : `
        SELECT
          lch.id,
          lch.offer_id,
          o.offer_name,
          o.url as product_url,
          lch.is_accessible,
          lch.http_status_code,
          lch.brand_found,
          lch.content_valid,
          lch.validation_message,
          lch.error_message,
          lch.checked_at
        FROM link_check_history lch
        INNER JOIN offers o ON lch.offer_id = o.id
        WHERE o.user_id = ?
          AND lch.checked_at >= datetime('now', '-24 hours')
          AND (
            lch.is_accessible = 0
            OR lch.brand_found = 0
            OR lch.content_valid = 0
          )
        ORDER BY lch.checked_at DESC
        LIMIT 5
      `

    const linkCheckResults = await db.query(linkCheckQuery, [userId]) as Array<{
      id: number
      offer_id: number
      offer_name: string
      product_url: string
      is_accessible: number
      http_status_code: number | null
      brand_found: number | null
      content_valid: number | null
      validation_message: string | null
      error_message: string | null
      checked_at: string
    }>

    linkCheckResults.forEach((result) => {
      // 确定问题类型和优先级
      let type: 'error' | 'warning' = 'warning'
      let priority: 'high' | 'medium' | 'low' = 'medium'
      let title = ''
      let message = ''
      let recommendation = ''

      if (result.is_accessible === 0) {
        type = 'error'
        priority = 'high'
        title = '链接无法访问'
        message = `链接 "${result.offer_name}" 无法访问（HTTP ${result.http_status_code || 'N/A'}）`
        recommendation = '建议：1) 检查链接是否有效，2) 确认产品页面可访问，3) 检查是否有地区限制'
      } else if (result.brand_found === 0) {
        title = '品牌信息未找到'
        message = `链接 "${result.offer_name}" 中未检测到品牌信息`
        recommendation = '建议：1) 确认产品页面包含品牌名称，2) 检查页面是否正确加载'
      } else if (result.content_valid === 0) {
        title = '页面内容无效'
        message = `链接 "${result.offer_name}" 页面内容校验失败`
        recommendation = '建议：1) 检查页面是否被重定向，2) 确认页面内容完整，3) 查看具体错误信息'

        // 如果有具体的错误消息，添加到message中
        if (result.validation_message) {
          message += `：${result.validation_message}`
        }
      }

      insights.push({
        id: `link-check-${result.id}`,
        type,
        priority,
        title,
        message,
        recommendation,
        relatedOffer: {
          id: result.offer_id,
          name: result.offer_name,
          url: result.product_url,
        },
        createdAt: result.checked_at,
      })
    })

    // ==================== URL Swap 换链接任务洞察 ====================

    // 规则7: 检测URL Swap任务错误
    const urlSwapErrorQuery = db.type === 'postgres'
      ? `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.error_at,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status = 'error'
          AND t.is_deleted = FALSE
          AND t.error_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        ORDER BY t.error_at DESC
        LIMIT 5
      `
      : `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.error_at,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status = 'error'
          AND t.is_deleted = 0
          AND t.error_at >= datetime('now', '-24 hours')
        ORDER BY t.error_at DESC
        LIMIT 5
      `

    const urlSwapErrors = await db.query(
      urlSwapErrorQuery,
      [userId]
    ) as Array<{
      task_id: string
      offer_id: number
      error_message: string
      error_at: string
      offer_name: string
      product_url: string
    }>

    urlSwapErrors.forEach((task) => {
      insights.push({
        id: `url-swap-error-${task.task_id}`,
        type: 'error',
        priority: 'high',
        title: '换链接任务出错',
        message: `Offer "${task.offer_name}" 的自动换链任务执行失败`,
        recommendation: `错误信息: ${task.error_message}。建议：1) 检查推广链接是否有效，2) 确认Google Ads配置正确，3) 查看任务详情排查问题`,
        relatedOffer: {
          id: task.offer_id,
          name: task.offer_name,
          url: task.product_url,
        },
        createdAt: task.error_at,
      })
    })

    // 规则8: 检测最近的URL变化（成功的换链）
    const urlSwapChangesQuery = db.type === 'postgres'
      ? `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.current_final_url,
          t.url_changed_count,
          t.updated_at,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status = 'enabled'
          AND t.is_deleted = FALSE
          AND t.url_changed_count > 0
          AND t.updated_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        ORDER BY t.updated_at DESC
        LIMIT 3
      `
      : `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.current_final_url,
          t.url_changed_count,
          t.updated_at,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status = 'enabled'
          AND t.is_deleted = 0
          AND t.url_changed_count > 0
          AND t.updated_at >= datetime('now', '-24 hours')
        ORDER BY t.updated_at DESC
        LIMIT 3
      `

    const urlSwapChanges = await db.query(
      urlSwapChangesQuery,
      [userId]
    ) as Array<{
      task_id: string
      offer_id: number
      current_final_url: string
      url_changed_count: number
      updated_at: string
      offer_name: string
      product_url: string
    }>

    urlSwapChanges.forEach((task) => {
      insights.push({
        id: `url-swap-change-${task.task_id}`,
        type: 'info',
        priority: 'medium',
        title: '推广链接已自动更新',
        message: `Offer "${task.offer_name}" 的推广链接检测到变化，已自动同步到Google Ads`,
        recommendation: `系统已为您自动完成 ${task.url_changed_count} 次链接更新。建议：定期检查换链历史，确保链接变化符合预期`,
        relatedOffer: {
          id: task.offer_id,
          name: task.offer_name,
          url: task.product_url,
        },
        createdAt: task.updated_at,
      })
    })

    // 规则9: 检测暂停的换链任务（可能需要关注）
    const urlSwapPausedQuery = db.type === 'postgres'
      ? `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.updated_at,
          t.failed_swaps,
          t.total_swaps,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status = 'disabled'
          AND t.is_deleted = FALSE
          AND t.updated_at >= CURRENT_TIMESTAMP - INTERVAL '48 hours'
          AND t.failed_swaps > 0
        ORDER BY t.updated_at DESC
        LIMIT 3
      `
      : `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.updated_at,
          t.failed_swaps,
          t.total_swaps,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status = 'disabled'
          AND t.is_deleted = 0
          AND t.updated_at >= datetime('now', '-48 hours')
          AND t.failed_swaps > 0
        ORDER BY t.updated_at DESC
        LIMIT 3
      `

    const urlSwapPaused = await db.query(
      urlSwapPausedQuery,
      [userId]
    ) as Array<{
      task_id: string
      offer_id: number
      error_message: string | null
      updated_at: string
      failed_swaps: number
      total_swaps: number
      offer_name: string
      product_url: string
    }>

    urlSwapPaused.forEach((task) => {
      const failureRate = task.total_swaps > 0
        ? ((task.failed_swaps / task.total_swaps) * 100).toFixed(1)
        : '0'

      insights.push({
        id: `url-swap-paused-${task.task_id}`,
        type: 'warning',
        priority: 'high',
        title: '换链接任务已暂停',
        message: `Offer "${task.offer_name}" 的自动换链任务已暂停（失败率: ${failureRate}%）`,
        recommendation: task.error_message
          ? `暂停原因: ${task.error_message}。建议：检查并修复问题后重新启用任务`
          : '建议：检查任务配置，确认问题已解决后重新启用任务',
        relatedOffer: {
          id: task.offer_id,
          name: task.offer_name,
          url: task.product_url,
        },
        createdAt: task.updated_at,
      })
    })

    // 规则10: 检测推广链接解析失败（高优先级错误）
    const linkResolutionErrorQuery = db.type === 'postgres'
      ? `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.error_at,
          t.consecutive_failures,
          o.offer_name,
          o.affiliate_link,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status IN ('error', 'disabled')
          AND t.is_deleted = FALSE
          AND t.error_at >= CURRENT_TIMESTAMP - INTERVAL '48 hours'
          AND (
            t.error_message LIKE '%推广链接解析失败%'
            OR t.error_message LIKE '%resolve%'
            OR t.error_message LIKE '%无法访问%'
            OR t.error_message LIKE '%Failed to fetch%'
            OR t.error_message LIKE '%timeout%'
            OR t.error_message LIKE '%ENOTFOUND%'
            OR t.error_message LIKE '%ECONNREFUSED%'
            OR t.error_message LIKE '%network%'
          )
        ORDER BY t.error_at DESC
        LIMIT 5
      `
      : `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.error_at,
          t.consecutive_failures,
          o.offer_name,
          o.affiliate_link,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status IN ('error', 'disabled')
          AND t.is_deleted = 0
          AND t.error_at >= datetime('now', '-48 hours')
          AND (
            t.error_message LIKE '%推广链接解析失败%'
            OR t.error_message LIKE '%resolve%'
            OR t.error_message LIKE '%无法访问%'
            OR t.error_message LIKE '%Failed to fetch%'
            OR t.error_message LIKE '%timeout%'
            OR t.error_message LIKE '%ENOTFOUND%'
            OR t.error_message LIKE '%ECONNREFUSED%'
            OR t.error_message LIKE '%network%'
          )
        ORDER BY t.error_at DESC
        LIMIT 5
      `

    const linkResolutionErrors = await db.query(
      linkResolutionErrorQuery,
      [userId]
    ) as Array<{
      task_id: string
      offer_id: number
      error_message: string
      error_at: string
      consecutive_failures: number
      offer_name: string
      affiliate_link: string
      product_url: string
    }>

    linkResolutionErrors.forEach((task) => {
      // 确定是否已自动暂停
      const isAutoPaused = task.error_message.includes('任务已自动暂停')
      const failureCount = task.consecutive_failures

      insights.push({
        id: `link-resolution-error-${task.task_id}`,
        type: 'error',
        priority: 'high',
        title: '🔴 推广链接解析失败',
        message: isAutoPaused
          ? `Offer "${task.offer_name}" 的推广链接连续解析失败 ${failureCount} 次，任务已自动暂停`
          : `Offer "${task.offer_name}" 的推广链接解析失败（连续失败 ${failureCount}/3）`,
        recommendation: isAutoPaused
          ? `**需要立即处理的问题：**\n\n` +
            `1. **检查推广链接是否有效**: ${task.affiliate_link}\n` +
            `2. **确认链接未过期或被撤销**: 联系广告主确认链接状态\n` +
            `3. **检查网络访问**: 确认链接可正常访问\n` +
            `4. **修复后重新启用**: 在任务详情页重新启用任务\n\n` +
            `**故障排除建议：**\n` +
            `- 在浏览器中直接访问推广链接，检查是否正常跳转\n` +
            `- 检查推广链接是否需要特殊授权或Cookie\n` +
            `- 确认推广链接未被限制地区访问`
          : `**警告：** 系统将在下个时间间隔继续尝试。连续失败3次后将自动暂停任务。\n\n` +
            `1. **立即检查推广链接**: ${task.affiliate_link}\n` +
            `2. **确认链接可访问性**: 在浏览器中测试链接\n` +
            `3. **查看详细错误**: ${task.error_message.substring(0, 200)}`,
        relatedOffer: {
          id: task.offer_id,
          name: task.offer_name,
          url: task.product_url,
        },
        createdAt: task.error_at,
      })
    })

    // 规则11: 检测Google Ads API调用失败（高优先级错误）
    const googleAdsApiErrorQuery = db.type === 'postgres'
      ? `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.error_at,
          t.consecutive_failures,
          t.google_campaign_id,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status IN ('error', 'disabled')
          AND t.is_deleted = FALSE
          AND t.error_at >= CURRENT_TIMESTAMP - INTERVAL '48 hours'
          AND (
            t.error_message LIKE '%Google Ads API%'
            OR t.error_message LIKE '%google_ads%'
            OR t.error_message LIKE '%OAuth%'
            OR t.error_message LIKE '%refresh_token%'
            OR t.error_message LIKE '%authentication%'
            OR t.error_message LIKE '%authorization%'
            OR t.error_message LIKE '%quota%'
            OR t.error_message LIKE '%campaign%'
            OR t.error_message LIKE '%Customer%'
          )
        ORDER BY t.error_at DESC
        LIMIT 5
      `
      : `
        SELECT
          t.id as task_id,
          t.offer_id,
          t.error_message,
          t.error_at,
          t.consecutive_failures,
          t.google_campaign_id,
          o.offer_name,
          o.url as product_url
        FROM url_swap_tasks t
        INNER JOIN offers o ON t.offer_id = o.id
        WHERE t.user_id = ?
          AND t.status IN ('error', 'disabled')
          AND t.is_deleted = 0
          AND t.error_at >= datetime('now', '-48 hours')
          AND (
            t.error_message LIKE '%Google Ads API%'
            OR t.error_message LIKE '%google_ads%'
            OR t.error_message LIKE '%OAuth%'
            OR t.error_message LIKE '%refresh_token%'
            OR t.error_message LIKE '%authentication%'
            OR t.error_message LIKE '%authorization%'
            OR t.error_message LIKE '%quota%'
            OR t.error_message LIKE '%campaign%'
            OR t.error_message LIKE '%Customer%'
          )
        ORDER BY t.error_at DESC
        LIMIT 5
      `

    const googleAdsApiErrors = await db.query(
      googleAdsApiErrorQuery,
      [userId]
    ) as Array<{
      task_id: string
      offer_id: number
      error_message: string
      error_at: string
      consecutive_failures: number
      google_campaign_id: string | null
      offer_name: string
      product_url: string
    }>

    googleAdsApiErrors.forEach((task) => {
      // 确定是否已自动暂停
      const isAutoPaused = task.error_message.includes('任务已自动暂停')
      const failureCount = task.consecutive_failures

      insights.push({
        id: `google-ads-api-error-${task.task_id}`,
        type: 'error' as const,
        priority: 'high' as const,
        title: '🔴 Google Ads API调用失败',
        message: isAutoPaused
          ? `Offer "${task.offer_name}" 的Google Ads API连续失败 ${failureCount} 次，任务已自动暂停`
          : `Offer "${task.offer_name}" 的Google Ads API调用失败（连续失败 ${failureCount}/3）`,
        recommendation: isAutoPaused
          ? `**需要立即处理的问题：**\n\n` +
            `1. **检查Google Ads账号权限**: 确认OAuth授权有效\n` +
            `2. **检查API配额**: 确认未超出每日配额限制\n` +
            `3. **检查服务账号配置**: 如使用服务账号模式，确认配置正确\n` +
            `4. **修复后重新启用**: 在任务详情页重新启用任务\n\n` +
            `**故障排除建议：**\n` +
            `- 前往 Google Cloud Console 检查API启用状态\n` +
            `- 确认OAuth refresh token未过期\n` +
            `- 检查Google Ads账号的开发者Token是否有效\n` +
            `- 确认campaign ${task.google_campaign_id || 'N/A'} 存在且有权限访问`
          : `**警告：** 系统将在下个时间间隔继续尝试。连续失败3次后将自动暂停任务。\n\n` +
            `1. **检查账号权限**: 确认OAuth授权有效\n` +
            `2. **检查API配额**: 确认未超出每日配额\n` +
            `3. **查看详细错误**: ${task.error_message.substring(0, 200)}`,
        relatedOffer: {
          id: task.offer_id,
          name: task.offer_name,
          url: task.product_url,
        },
        createdAt: task.error_at,
      })
    })

    // 按优先级排序
    const priorityOrder = { high: 1, medium: 2, low: 3 }
    insights.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    console.log(`[Insights API] Generated ${insights.length} insights for days=${days}`)

    return NextResponse.json({
      success: true,
      data: {
        insights,
        total: insights.length,
        summary: {
          high: insights.filter((i) => i.priority === 'high').length,
          medium: insights.filter((i) => i.priority === 'medium').length,
          low: insights.filter((i) => i.priority === 'low').length,
        },
        generatedAt: new Date().toISOString(),
      },
    })
  } catch (error) {
    console.error('获取智能洞察失败:', error)
    return NextResponse.json(
      {
        error: '获取智能洞察失败',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
}

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.TZ || 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}
