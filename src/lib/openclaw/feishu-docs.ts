import { getDatabase } from '@/lib/db'
import { updateSettings } from '@/lib/settings'
import { getOpenclawFeishuDocConfig } from '@/lib/openclaw/feishu-config'
import { feishuRequest, getTenantAccessToken, resolveFeishuApiBase } from '@/lib/openclaw/feishu-api'

type DailyReportPayload = {
  date: string
  summary?: any
  kpis?: any
  roi?: any
  actions?: any[]
  budget?: any
  campaigns?: any
  trends?: any
  strategyRun?: any
  generatedAt?: string
}

type FeishuDocRow = {
  id: number
  user_id: number
  bitable_app_token: string | null
  bitable_table_id: string | null
  folder_token: string | null
  last_doc_token: string | null
  last_doc_date: string | null
}

type BitableStrategySummary = {
  guardLevel: string
  publishFailureRate: number
  recommendedMaxOffersPerRun: number
  recommendedDefaultBudget: number
  recommendedMaxCpc: number
  recommendationSource: 'effective_config' | 'failure_guard_after' | 'adaptive_after' | 'none'
  recommendationNote: string
  reason: string | null
}

const REQUIRED_BITABLE_FIELDS = ['Date', 'Offers', 'Campaigns', 'Revenue', 'Cost', 'ROAS', 'ROI', 'Actions', 'GuardLevel', 'PublishFailureRate', 'NextMaxOffers', 'NextBudget', 'NextMaxCpc', 'RecommendationSource', 'TomorrowAdvice', 'StrategyReason', 'Notes']

async function getFeishuDocRow(userId: number): Promise<FeishuDocRow | null> {
  const db = await getDatabase()
  const row = await db.queryOne<FeishuDocRow>(
    'SELECT * FROM openclaw_feishu_docs WHERE user_id = ? LIMIT 1',
    [userId]
  )
  return row || null
}

async function upsertFeishuDocRow(userId: number, updates: Partial<FeishuDocRow>) {
  const db = await getDatabase()
  const existing = await getFeishuDocRow(userId)
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

  if (existing) {
    const fields: string[] = []
    const values: any[] = []
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'id' || key === 'user_id') continue
      fields.push(`${key} = ?`)
      values.push(value ?? null)
    }
    if (fields.length === 0) return
    await db.exec(
      `UPDATE openclaw_feishu_docs SET ${fields.join(', ')}, updated_at = ${nowFunc} WHERE user_id = ?`,
      [...values, userId]
    )
  } else {
    await db.exec(
      `INSERT INTO openclaw_feishu_docs (user_id, bitable_app_token, bitable_table_id, folder_token, last_doc_token, last_doc_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})`,
      [
        userId,
        updates.bitable_app_token ?? null,
        updates.bitable_table_id ?? null,
        updates.folder_token ?? null,
        updates.last_doc_token ?? null,
        updates.last_doc_date ?? null,
      ]
    )
  }
}

function parseMaybeJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  if (typeof value === 'object') return value as T
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function buildRecommendationNote(params: {
  guardLevel: string
  publishFailureRate: number
  reason: string | null
}): string {
  if (params.reason === 'publish_failure_stop_loss') {
    return '上一轮触发发布止损，明日建议先排查账号状态、素材合规与落地页可用性，再恢复投放。'
  }

  if (params.guardLevel === 'strong') {
    return `发布失败率 ${(params.publishFailureRate * 100).toFixed(1)}%，建议明日执行强防守：缩量、降CPC、低预算小步验证。`
  }

  if (params.guardLevel === 'mild') {
    return `发布失败率 ${(params.publishFailureRate * 100).toFixed(1)}%，建议明日执行温和防守：控制节奏并优先验证高质量创意与关键词。`
  }

  if (params.guardLevel === 'insufficient_data') {
    return '当前样本不足，明日建议保持小规模探索，优先积累有效发布与转化样本。'
  }

  return '发布链路稳定，明日建议按建议参数稳步放量，同时持续监控ROAS与失败原因。'
}

function formatRecommendationSourceLabel(
  source: BitableStrategySummary['recommendationSource']
): string {
  switch (source) {
    case 'effective_config':
      return '最终生效配置'
    case 'failure_guard_after':
      return '风控后参数'
    case 'adaptive_after':
      return '自适应后参数'
    default:
      return '无建议来源'
  }
}

function formatGuardLevelLabel(guardLevel: string): string {
  switch (String(guardLevel || '').toLowerCase()) {
    case 'strong':
      return '强防守'
    case 'mild':
      return '温和防守'
    case 'insufficient_data':
      return '样本不足'
    case 'none':
      return '无'
    default:
      return guardLevel || '无'
  }
}

function buildBitableStrategySummary(report: DailyReportPayload): BitableStrategySummary {
  const strategyStats = parseMaybeJson<Record<string, any>>(report.strategyRun?.stats_json, {})
  const failureGuard = parseMaybeJson<Record<string, any>>(strategyStats.failureGuardInsight, {})
  const adaptiveInsight = parseMaybeJson<Record<string, any>>(strategyStats.adaptiveInsight, {})
  const effectiveConfig = parseMaybeJson<Record<string, any>>(strategyStats.effectiveConfig, {})
  const failureGuardAfter = parseMaybeJson<Record<string, any>>(failureGuard.after, {})
  const adaptiveAfter = parseMaybeJson<Record<string, any>>(adaptiveInsight.after, {})

  const hasEffectiveConfig = Object.prototype.hasOwnProperty.call(effectiveConfig, 'maxOffersPerRun')
  const hasFailureGuardAfter = Object.prototype.hasOwnProperty.call(failureGuardAfter, 'maxOffersPerRun')
  const hasAdaptiveAfter = Object.prototype.hasOwnProperty.call(adaptiveAfter, 'maxOffersPerRun')

  const recommendationSource: BitableStrategySummary['recommendationSource'] = hasEffectiveConfig
    ? 'effective_config'
    : (hasFailureGuardAfter ? 'failure_guard_after' : (hasAdaptiveAfter ? 'adaptive_after' : 'none'))

  const recommendedMaxOffersPerRun = toNumber(
    effectiveConfig.maxOffersPerRun,
    toNumber(failureGuardAfter.maxOffersPerRun, toNumber(adaptiveAfter.maxOffersPerRun, 0))
  )
  const recommendedDefaultBudget = toNumber(
    effectiveConfig.defaultBudget,
    toNumber(failureGuardAfter.defaultBudget, toNumber(adaptiveAfter.defaultBudget, 0))
  )
  const recommendedMaxCpc = toNumber(
    effectiveConfig.maxCpc,
    toNumber(failureGuardAfter.maxCpc, toNumber(adaptiveAfter.maxCpc, 0))
  )
  const guardLevel = String(failureGuard.guardLevel || 'none')
  const publishFailureRate = toNumber(failureGuard.publishFailureRate, 0)
  const reason = strategyStats.reason ? String(strategyStats.reason) : null

  return {
    guardLevel,
    publishFailureRate,
    recommendedMaxOffersPerRun,
    recommendedDefaultBudget,
    recommendedMaxCpc,
    recommendationSource,
    recommendationNote: buildRecommendationNote({
      guardLevel,
      publishFailureRate,
      reason,
    }),
    reason,
  }
}

function buildDocLines(report: DailyReportPayload): string[] {
  const summary = report.summary?.kpis || {}
  const roi = report.roi?.data?.overall || {}
  const totalCost = Number(roi.totalCost) || 0
  const totalRevenueRaw = roi?.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : Number(totalRevenueRaw)
  const revenueAvailable = roi?.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)
  const roas = revenueAvailable
    ? (roi?.roas !== undefined
      ? Number(roi.roas) || 0
      : (totalCost > 0 ? (totalRevenue || 0) / totalCost : 0))
    : null
  const affiliateBreakdown = Array.isArray(roi?.affiliateBreakdown)
    ? roi.affiliateBreakdown as Array<{ platform?: string; totalCommission?: number; records?: number }>
    : []
  const strategySummary = buildBitableStrategySummary(report)

  const lines: string[] = []
  lines.push(`OpenClaw 每日报表（${report.date}）`)
  lines.push(`生成时间：${report.generatedAt || new Date().toISOString()}`)
  lines.push('')
  lines.push(`Offer 数量：${summary.totalOffers ?? 0}`)
  lines.push(`Campaign 数量：${summary.totalCampaigns ?? 0}`)
  lines.push(`点击数：${summary.totalClicks ?? 0}`)
  lines.push(`花费：${totalCost}`)

  if (revenueAvailable) {
    lines.push(`佣金收入：${Number(totalRevenue || 0).toFixed(2)}`)
    lines.push(`ROAS：${(roas || 0).toFixed(2)}x`)
    lines.push(`ROI：${roi.roi ?? 0}%`)
    lines.push('收入来源：联盟佣金（PartnerBoost / YeahPromos）')

    if (affiliateBreakdown.length > 0) {
      lines.push(
        `联盟拆分：${affiliateBreakdown
          .map((item) => `${item.platform || '未知平台'} ${Number(item.totalCommission || 0).toFixed(2)}（记录 ${Number(item.records) || 0}）`)
          .join(' | ')}`
      )
    }
  } else {
    lines.push('佣金收入：暂不可用（等待联盟平台返回）')
    lines.push('ROAS：暂不可用')
    lines.push('ROI：暂不可用')
    lines.push('收入来源：严格联盟模式（不回退 AutoAds）')
  }

  lines.push(`操作记录：${(report.actions || []).length}`)
  if (strategySummary.recommendedMaxOffersPerRun > 0) {
    lines.push(
      `明日建议参数：Offer上限 ${strategySummary.recommendedMaxOffersPerRun}｜预算 ${strategySummary.recommendedDefaultBudget}｜最大CPC ${strategySummary.recommendedMaxCpc}｜来源 ${formatRecommendationSourceLabel(strategySummary.recommendationSource)}`
    )
  }
  lines.push(`明日建议：${strategySummary.recommendationNote}`)
  if (strategySummary.reason) {
    lines.push(`策略原因：${strategySummary.reason}`)
  }
  return lines
}


async function ensureBitableFields(params: {
  appToken: string
  tableId: string
  token: string
  apiBase: string
  fieldNames: string[]
}) {
  const existing = new Set<string>()
  let pageToken: string | undefined
  let hasMore = true

  while (hasMore) {
    const query = new URLSearchParams({ page_size: '500' })
    if (pageToken) query.set('page_token', pageToken)

    const response = await feishuRequest<{
      data?: {
        has_more?: boolean
        page_token?: string
        items?: Array<{ field_name?: string }>
      }
    }>({
      method: 'GET',
      url: `${params.apiBase}/bitable/v1/apps/${params.appToken}/tables/${params.tableId}/fields?${query.toString()}`,
      token: params.token,
    })

    const items = response?.data?.items || []
    for (const item of items) {
      if (item?.field_name) {
        existing.add(String(item.field_name))
      }
    }

    hasMore = Boolean(response?.data?.has_more)
    pageToken = response?.data?.page_token || undefined
  }

  for (const fieldName of params.fieldNames) {
    if (existing.has(fieldName)) continue
    try {
      await feishuRequest({
        method: 'POST',
        url: `${params.apiBase}/bitable/v1/apps/${params.appToken}/tables/${params.tableId}/fields`,
        token: params.token,
        body: {
          field_name: fieldName,
          type: 1,
        },
      })
    } catch (error) {
      console.warn(`Feishu Bitable field create skipped: ${fieldName}`, error)
    }
  }
}

async function ensureBitableTable(params: {
  userId: number
  appToken: string
  tableId?: string
  tableName: string
  token: string
  apiBase: string
}): Promise<string> {
  let tableId = params.tableId

  if (!tableId) {
    const createTable = await feishuRequest<{ data?: { table_id?: string } }>({
      method: 'POST',
      url: `${params.apiBase}/bitable/v1/apps/${params.appToken}/tables`,
      token: params.token,
      body: {
        table: { name: params.tableName },
      },
    })

    tableId = createTable?.data?.table_id
    if (!tableId) {
      throw new Error('Feishu Bitable table create failed: missing table_id')
    }

    await updateSettings(
      [{ category: 'openclaw', key: 'feishu_bitable_table_id', value: tableId }],
      params.userId
    )

    await upsertFeishuDocRow(params.userId, {
      bitable_app_token: params.appToken,
      bitable_table_id: tableId,
    })
  }

  await ensureBitableFields({
    appToken: params.appToken,
    tableId,
    token: params.token,
    apiBase: params.apiBase,
    fieldNames: REQUIRED_BITABLE_FIELDS,
  })

  return tableId
}

export async function writeDailyReportToBitable(userId: number, report: DailyReportPayload): Promise<void> {
  const config = await getOpenclawFeishuDocConfig(userId)
  if (!config.appId || !config.appSecret || !config.bitableAppToken) return

  const token = await getTenantAccessToken({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: config.domain,
  })
  const apiBase = resolveFeishuApiBase(config.domain)

  const tableId = await ensureBitableTable({
    userId,
    appToken: config.bitableAppToken,
    tableId: config.bitableTableId,
    tableName: config.bitableTableName || 'OpenClaw 每日报表',
    token,
    apiBase,
  })

  const roi = report.roi?.data?.overall || {}
  const totalCost = Number(roi.totalCost) || 0
  const totalRevenueRaw = roi?.totalRevenue
  const totalRevenue = totalRevenueRaw === null || totalRevenueRaw === undefined
    ? null
    : Number(totalRevenueRaw)
  const revenueAvailable = roi?.revenueAvailable !== false
    && totalRevenue !== null
    && Number.isFinite(totalRevenue)
  const roas = revenueAvailable
    ? (roi?.roas !== undefined
      ? Number(roi.roas) || 0
      : (totalCost > 0 ? (totalRevenue || 0) / totalCost : 0))
    : null
  const strategySummary = buildBitableStrategySummary(report)
  const fields = {
    Date: report.date,
    Offers: String(report.summary?.kpis?.totalOffers ?? 0),
    Campaigns: String(report.summary?.kpis?.totalCampaigns ?? 0),
    Revenue: revenueAvailable ? String(totalRevenue) : '-',
    Cost: String(totalCost),
    ROAS: revenueAvailable ? roas!.toFixed(2) : '-',
    ROI: revenueAvailable ? String(roi.roi ?? 0) : '-',
    Actions: String((report.actions || []).length),
    GuardLevel: formatGuardLevelLabel(strategySummary.guardLevel),
    PublishFailureRate: `${(strategySummary.publishFailureRate * 100).toFixed(1)}%`,
    NextMaxOffers: strategySummary.recommendedMaxOffersPerRun > 0 ? String(strategySummary.recommendedMaxOffersPerRun) : '',
    NextBudget: strategySummary.recommendedDefaultBudget > 0 ? String(strategySummary.recommendedDefaultBudget) : '',
    NextMaxCpc: strategySummary.recommendedMaxCpc > 0 ? String(strategySummary.recommendedMaxCpc) : '',
    RecommendationSource: formatRecommendationSourceLabel(strategySummary.recommendationSource),
    TomorrowAdvice: strategySummary.recommendationNote,
    StrategyReason: strategySummary.reason || '',
    Notes: revenueAvailable
      ? '收入来源：联盟佣金'
      : '收入暂不可用：严格联盟模式',
  }

  let existingRecordId: string | null = null
  try {
    const searchRes = await feishuRequest<{ data?: { items?: Array<{ record_id?: string; recordId?: string }> } }>({
      method: 'POST',
      url: `${apiBase}/bitable/v1/apps/${config.bitableAppToken}/tables/${tableId}/records/search`,
      token,
      body: {
        page_size: 1,
        filter: {
          conjunction: 'and',
          conditions: [{ field_name: 'Date', operator: 'is', value: [report.date] }],
        },
      },
    })
    const record = searchRes?.data?.items?.[0]
    existingRecordId = record?.record_id || record?.recordId || null
  } catch (error) {
    console.warn('Feishu Bitable search existing record failed, fallback to create', error)
  }

  if (existingRecordId) {
    await feishuRequest({
      method: 'POST',
      url: `${apiBase}/bitable/v1/apps/${config.bitableAppToken}/tables/${tableId}/records/batch_update`,
      token,
      body: { records: [{ record_id: existingRecordId, fields }] },
    })
    return
  }

  await feishuRequest({
    method: 'POST',
    url: `${apiBase}/bitable/v1/apps/${config.bitableAppToken}/tables/${tableId}/records/batch_create`,
    token,
    body: { records: [{ fields }] },
  })
}

async function createDoc(params: {
  apiBase: string
  token: string
  title: string
  folderToken?: string
}): Promise<string> {
  const payload: Record<string, any> = { title: params.title }
  if (params.folderToken) {
    payload.folder_token = params.folderToken
  }

  const result = await feishuRequest<{ data?: { document_id?: string } }>(
    {
      method: 'POST',
      url: `${params.apiBase}/docx/v1/documents`,
      token: params.token,
      body: payload,
    }
  )

  const documentId = result?.data?.document_id
  if (!documentId) {
    throw new Error('Feishu doc create failed: missing document_id')
  }
  return documentId
}

async function appendDocLines(params: {
  apiBase: string
  token: string
  documentId: string
  lines: string[]
}) {
  if (params.lines.length === 0) return
  const chunks: string[][] = []
  const chunkSize = 40
  for (let i = 0; i < params.lines.length; i += chunkSize) {
    chunks.push(params.lines.slice(i, i + chunkSize))
  }

  for (const group of chunks) {
    const children = group.map((line) => ({
      block_type: 2,
      text: {
        elements: [
          {
            text_run: {
              content: line,
            },
          },
        ],
      },
    }))

    await feishuRequest(
      {
        method: 'POST',
        url: `${params.apiBase}/docx/v1/documents/${params.documentId}/blocks/${params.documentId}/children`,
        token: params.token,
        body: { children },
      }
    )
  }
}

export async function writeDailyReportToDoc(userId: number, report: DailyReportPayload): Promise<void> {
  const config = await getOpenclawFeishuDocConfig(userId)
  if (!config.appId || !config.appSecret || !config.docFolderToken) return

  const token = await getTenantAccessToken({
    appId: config.appId,
    appSecret: config.appSecret,
    domain: config.domain,
  })
  const apiBase = resolveFeishuApiBase(config.domain)

  const docRow = await getFeishuDocRow(userId)
  const shouldReuse = docRow?.last_doc_date === report.date && docRow?.last_doc_token
  const docTitlePrefix = config.docTitlePrefix || 'OpenClaw 每日报表'
  const docTitle = `${docTitlePrefix} ${report.date}`

  const documentId = shouldReuse
    ? (docRow!.last_doc_token as string)
    : await createDoc({
        apiBase,
        token,
        title: docTitle,
        folderToken: config.docFolderToken,
      })

  await appendDocLines({
    apiBase,
    token,
    documentId,
    lines: buildDocLines(report),
  })

  await upsertFeishuDocRow(userId, {
    folder_token: config.docFolderToken || null,
    last_doc_token: documentId,
    last_doc_date: report.date,
  })
}
