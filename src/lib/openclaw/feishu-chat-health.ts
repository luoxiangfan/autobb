import { getDatabase } from '@/lib/db'
import { datetimeMinusHours } from '@/lib/db-helpers'
import { failStaleQueuedCommandRuns } from './commands/queued-timeout'

export type FeishuChatHealthDecision = 'allowed' | 'blocked' | 'error'
export type FeishuChatHealthExecutionState =
  | 'not_applicable'
  | 'waiting'
  | 'missing'
  | 'pending_confirm'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'unknown'

export type FeishuChatHealthWorkflowState =
  | 'not_required'
  | 'running'
  | 'incomplete'
  | 'completed'
  | 'failed'
  | 'unknown'

export type FeishuChatHealthWorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'unknown'

export type FeishuChatHealthLogInput = {
  userId: number
  accountId: string
  messageId?: string | null
  chatId?: string | null
  chatType?: string | null
  messageType?: string | null
  senderPrimaryId?: string | null
  senderOpenId?: string | null
  senderUnionId?: string | null
  senderUserId?: string | null
  senderCandidates?: string[]
  decision: FeishuChatHealthDecision
  reasonCode: string
  reasonMessage?: string | null
  messageText?: string | null
  messageReceivedAt?: string | null
  replyDispatchedAt?: string | null
  metadata?: Record<string, unknown> | null
}

type FeishuChatHealthRow = {
  id: number
  user_id: number
  account_id: string
  message_id: string | null
  chat_id: string | null
  chat_type: string | null
  message_type: string | null
  sender_primary_id: string | null
  sender_open_id: string | null
  sender_union_id: string | null
  sender_user_id: string | null
  sender_candidates_json: string | null
  decision: FeishuChatHealthDecision
  reason_code: string
  reason_message: string | null
  message_text: string | null
  message_text_length: number
  metadata_json: string | null
  created_at: string | Date
}

type FeishuChatHealthStatsRow = {
  decision: string
  total: number | string
}

type OpenclawCommandRunLinkRow = {
  id: string
  parent_request_id: string | null
  channel: string | null
  sender_id: string | null
  status: string
  request_path?: string | null
  request_body_json?: string | null
  response_status?: number | null
  response_body?: string | null
  created_at: string | Date
}

type FeishuSyntheticHealthCandidate = {
  messageId: string
  createdAt: string | Date
  senderId: string | null
  requestPath: string | null
  requestBodyJson: string | null
  runCount: number
}

type FeishuChatHealthCreatedAtRow = {
  created_at: string | Date
}

type FeishuChatHealthAnchorRow = {
  created_at: string | Date
  message_text: string | null
  metadata_json: string | null
}

type CreativeTaskStatusRow = {
  id: string
  offer_id: number
  status: string
  stage: string | null
  progress: number | null
  message: string | null
  completed_at: string | Date | null
  updated_at: string | Date
}

type CampaignWorkflowStatusRow = {
  id: number
  offer_id: number
  ad_creative_id: number | null
  creation_status: string | null
  creation_error: string | null
  status: string | null
  is_deleted: boolean | number | null
  created_at: string | Date
  updated_at: string | Date
  published_at: string | Date | null
}

type FeishuChatHealthWorkflowStep = {
  key: string
  label: string
  status: FeishuChatHealthWorkflowStepStatus
  detail: string
}

export type FeishuChatHealthLogItem = {
  id: number
  userId: number
  accountId: string
  messageId: string | null
  chatId: string | null
  chatType: string | null
  messageType: string | null
  senderPrimaryId: string | null
  senderOpenId: string | null
  senderUnionId: string | null
  senderUserId: string | null
  senderCandidates: string[]
  decision: FeishuChatHealthDecision
  reasonCode: string
  reasonMessage: string | null
  messageText: string | null
  messageExcerpt: string
  messageTextLength: number
  metadata: Record<string, unknown> | null
  messageReceivedAt: string | null
  replyDispatchedAt: string | null
  executionState: FeishuChatHealthExecutionState
  executionRunId: string | null
  executionRunStatus: string | null
  executionRunCount: number
  executionRunCreatedAt: string | null
  executionDetail: string
  workflowState: FeishuChatHealthWorkflowState
  workflowProgress: number
  workflowDetail: string
  workflowOfferId: number | null
  workflowSteps: FeishuChatHealthWorkflowStep[]
  ageSeconds: number
  createdAt: string
}

export type FeishuChatHealthListResult = {
  rows: FeishuChatHealthLogItem[]
  stats: {
    total: number
    allowed: number
    blocked: number
    error: number
    execution: {
      linked: number
      completed: number
      inProgress: number
      waiting: number
      missing: number
      failed: number
      notApplicable: number
      unknown: number
    }
    workflow: {
      tracked: number
      completed: number
      running: number
      incomplete: number
      failed: number
      notRequired: number
      unknown: number
    }
  }
}

const FEISHU_HEALTH_RETENTION_DAYS = 7
const FEISHU_HEALTH_RETENTION_HOURS = FEISHU_HEALTH_RETENTION_DAYS * 24
const FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT = 500
const FEISHU_HEALTH_CLEANUP_INTERVAL_MS = 5 * 60 * 1000
const FEISHU_HEALTH_EXECUTION_MISSING_SECONDS = 180
const FEISHU_HEALTH_WORKFLOW_INCOMPLETE_SECONDS = 10 * 60
const FEISHU_HEALTH_WORKFLOW_MAX_WINDOW_SECONDS = 6 * 60 * 60
const FEISHU_HEALTH_PUBLISH_RUNNING_STALE_SECONDS = 2 * 60 * 60
const FEISHU_CHAT_HEALTH_NOISE_REASON_CODE = 'duplicate_message'
// Note: `created_at` in chat health logs is written when the gateway reports the event,
// which may happen after one or more command runs were already created. Keep a relatively
// forgiving "link before" window, but not too large to avoid cross-message mislinks.
const FEISHU_HEALTH_EXECUTION_LINK_BEFORE_SECONDS = 180
const FEISHU_HEALTH_BACKFILL_LINK_BEFORE_SECONDS = 15 * 60
const FEISHU_HEALTH_EXECUTION_LINK_AFTER_SECONDS = 5 * 60

let lastCleanupAt = 0

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function resolveExecutionMissingSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_EXECUTION_MISSING_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_EXECUTION_MISSING_SECONDS
  }
  return clamp(envValue, 30, 3600)
}

export function getFeishuChatHealthExecutionMissingSeconds(): number {
  return resolveExecutionMissingSeconds()
}

function resolveExecutionLinkBeforeSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_EXECUTION_LINK_BEFORE_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_EXECUTION_LINK_BEFORE_SECONDS
  }
  return clamp(envValue, 0, 3600)
}

function resolveBackfillLinkBeforeSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_BACKFILL_LINK_BEFORE_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_BACKFILL_LINK_BEFORE_SECONDS
  }
  return clamp(envValue, 30, 3600)
}

function resolveExecutionLinkAfterSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_EXECUTION_LINK_AFTER_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_EXECUTION_LINK_AFTER_SECONDS
  }
  return clamp(envValue, 0, 3600)
}

function resolveWorkflowIncompleteSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_WORKFLOW_INCOMPLETE_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_WORKFLOW_INCOMPLETE_SECONDS
  }
  return clamp(envValue, 120, 86_400)
}

function resolveWorkflowMaxWindowSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_WORKFLOW_MAX_WINDOW_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_WORKFLOW_MAX_WINDOW_SECONDS
  }
  return clamp(envValue, 300, 86_400)
}

function resolvePublishRunningStaleSeconds(): number {
  const envValue = Number(process.env.OPENCLAW_FEISHU_PUBLISH_RUNNING_STALE_SECONDS)
  if (!Number.isFinite(envValue)) {
    return FEISHU_HEALTH_PUBLISH_RUNNING_STALE_SECONDS
  }
  return clamp(envValue, 120, 86_400)
}

function normalizeShortText(value: unknown, maxLength: number): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, maxLength)
}

function normalizeFeishuIdentifier(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  const normalized = text.replace(/^(feishu|lark):/i, '').toLowerCase()
  return normalized ? normalized.slice(0, 255) : null
}

function normalizeMessageText(value: unknown): string | null {
  const text = String(value || '').trim()
  if (!text) return null
  return text.slice(0, 20_000)
}

function epochValueToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null
  const abs = Math.abs(value)
  // seconds / milliseconds / microseconds
  const millis = abs >= 1e14
    ? Math.floor(value / 1000)
    : abs >= 1e11
      ? Math.floor(value)
      : Math.floor(value * 1000)
  const date = new Date(millis)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function normalizeIsoTimestampInput(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === 'number') {
    return epochValueToIso(value)
  }

  const text = String(value || '').trim()
  if (!text) return null
  if (/^\d+(\.\d+)?$/.test(text)) {
    const numeric = Number(text)
    if (!Number.isFinite(numeric)) return null
    return epochValueToIso(numeric)
  }

  const hasTimezone = /z$/i.test(text) || /[+-]\d{2}:\d{2}$/.test(text)
  const normalized = text.includes('T')
    ? (hasTimezone ? text : `${text}Z`)
    : `${text.replace(' ', 'T')}${hasTimezone ? '' : 'Z'}`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function safeParseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

function safeParseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

function firstMetadataTimestamp(metadata: Record<string, unknown> | null, keys: string[]): string | null {
  if (!metadata) return null
  for (const key of keys) {
    const iso = normalizeIsoTimestampInput(metadata[key])
    if (iso) return iso
  }
  return null
}

type FeishuChatHealthEventTiming = {
  ingestedAt: string
  messageReceivedAt: string | null
  replyDispatchedAt: string | null
  linkAnchorAt: string
  linkAnchorMs: number
  dispatchAnchorAt: string
  dispatchAnchorMs: number
}

function resolveFeishuChatHealthEventTiming(input: {
  metadataJson: string | null
  createdAt: string | Date
}): FeishuChatHealthEventTiming {
  const metadata = safeParseJsonObject(input.metadataJson)
  const ingestedAt = toIsoTimestamp(input.createdAt)
  const messageReceivedAt = firstMetadataTimestamp(metadata, [
    'messageReceivedAt',
    'message_received_at',
    'inboundMessageAt',
    'inbound_message_at',
    'messageCreateTime',
    'message_create_time',
  ])
  const replyDispatchedAt = firstMetadataTimestamp(metadata, [
    'replyDispatchedAt',
    'reply_dispatched_at',
    'dispatchAt',
    'dispatch_at',
    'replySentAt',
    'reply_sent_at',
    'responseSentAt',
    'response_sent_at',
  ])

  const linkAnchorAt = messageReceivedAt || replyDispatchedAt || ingestedAt
  const dispatchAnchorAt = replyDispatchedAt || ingestedAt
  const linkAnchorMsRaw = Date.parse(linkAnchorAt)
  const dispatchAnchorMsRaw = Date.parse(dispatchAnchorAt)
  const ingestedMsRaw = Date.parse(ingestedAt)
  const fallbackMs = Number.isFinite(ingestedMsRaw) ? ingestedMsRaw : Date.now()

  return {
    ingestedAt,
    messageReceivedAt,
    replyDispatchedAt,
    linkAnchorAt,
    linkAnchorMs: Number.isFinite(linkAnchorMsRaw) ? linkAnchorMsRaw : fallbackMs,
    dispatchAnchorAt,
    dispatchAnchorMs: Number.isFinite(dispatchAnchorMsRaw) ? dispatchAnchorMsRaw : fallbackMs,
  }
}

function extractExpectedOfferCountFromMessageText(messageText: string | null): number {
  const text = String(messageText || '')
  if (!text) return 1

  const urlMatches = text.match(/https?:\/\/[^\s)]+/gi) || []
  const asinMatches = text.match(/\bB0[A-Z0-9]{8}\b/gi) || []
  const urls = new Set(urlMatches.map((item) => item.trim()).filter(Boolean))
  const asins = new Set(asinMatches.map((item) => item.toUpperCase()))
  const estimated = Math.max(urls.size, asins.size, 1)
  return clamp(estimated, 1, 10)
}

function resolveDynamicLinkWindowSeconds(params: {
  messageText: string | null
  expectation: FeishuBusinessWorkflowExpectation | null
}): { beforeSeconds: number; afterSeconds: number } {
  const baseBefore = resolveBackfillLinkBeforeSeconds()
  const baseAfter = resolveExecutionLinkAfterSeconds()
  if (!params.expectation) {
    return {
      beforeSeconds: baseBefore,
      afterSeconds: baseAfter,
    }
  }

  const offerCount = clamp(
    params.expectation.expectedOffers || extractExpectedOfferCountFromMessageText(params.messageText),
    1,
    10
  )
  const perOfferSeconds = params.expectation.requirePublish ? 22 * 60 : 14 * 60
  const dynamicBefore = 3 * 60 + offerCount * perOfferSeconds
  const dynamicAfter = 2 * 60 + offerCount * 90

  return {
    beforeSeconds: clamp(Math.max(baseBefore, dynamicBefore), 30, 3 * 60 * 60),
    afterSeconds: clamp(Math.max(baseAfter, dynamicAfter), 30, 3600),
  }
}

function toIsoTimestamp(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  const text = String(value || '').trim()
  if (!text) {
    return new Date().toISOString()
  }

  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    return text
  }
  return date.toISOString()
}

function toMessageExcerpt(messageText: string | null): string {
  if (!messageText) return ''
  return messageText.length <= FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT
    ? messageText
    : `${messageText.slice(0, FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT)}…`
}

function toSyntheticMessageTextFromRun(candidate: FeishuSyntheticHealthCandidate): string {
  const path = normalizeShortText(candidate.requestPath, 255) || '/api/unknown'
  const body = safeParseJsonObject(candidate.requestBodyJson)
  if (body && Object.keys(body).length > 0) {
    const compact = JSON.stringify(body)
    const snippet = compact.length > 160 ? `${compact.slice(0, 160)}...` : compact
    return `命令已开始执行：${path} ${snippet}`
  }
  return `命令已开始执行：${path}`
}

function mapRunStatusToExecutionState(status: string): FeishuChatHealthExecutionState {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized) return 'unknown'

  if (normalized === 'completed') return 'completed'
  if (normalized === 'running') return 'running'
  if (normalized === 'queued' || normalized === 'draft') return 'queued'
  if (normalized === 'pending_confirm' || normalized === 'confirmed') return 'pending_confirm'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'canceled') return 'canceled'
  if (normalized === 'expired') return 'expired'

  return 'unknown'
}

type NormalizedCreativeBucket = 'A' | 'B' | 'D'

type FeishuBusinessWorkflowExpectation = {
  kind: 'creative_triplet_publish'
  requirePublish: boolean
  expectedOffers: number
}

type ParsedWorkflowRun = {
  id: string
  createdAt: string
  createdMs: number
  status: string
  requestPath: string
  offerId: number | null
  bucket: NormalizedCreativeBucket | null
  creativeTaskId: string | null
  publishAdCreativeId: number | null
  publishCampaignIds: number[]
  isCreativeGenerate: boolean
  isPublish: boolean
  isFailed: boolean
  isAccepted: boolean
}

type WorkflowContext = {
  messageId: string
  createdMs: number
  senderCandidates: string[]
  expectation: FeishuBusinessWorkflowExpectation
  linkedRuns: OpenclawCommandRunLinkRow[]
  ageSeconds: number
  windowStartMs: number
  windowEndMs: number
  primaryOfferId: number | null
}

type WorkflowAssessment = {
  state: FeishuChatHealthWorkflowState
  progress: number
  detail: string
  offerId: number | null
  steps: FeishuChatHealthWorkflowStep[]
}

function toPositiveInteger(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  const normalized = Math.floor(parsed)
  return normalized > 0 ? normalized : null
}

function normalizeCreativeBucket(value: unknown): NormalizedCreativeBucket | null {
  const upper = String(value || '').trim().toUpperCase()
  if (!upper) return null
  if (upper === 'A') return 'A'
  if (upper === 'B' || upper === 'C') return 'B'
  if (upper === 'D' || upper === 'S') return 'D'
  return null
}

function resolveCreativeWorkflowExpectation(
  messageText: string | null
): FeishuBusinessWorkflowExpectation | null {
  const normalized = String(messageText || '').replace(/\s+/g, '')
  if (!normalized) {
    return null
  }

  const requireThreeCreatives =
    /生成.*(?:3|三)个.*创意/.test(normalized) || /(?:3|三)个.*创意.*生成/.test(normalized)
  if (!requireThreeCreatives) {
    return null
  }

  const requirePublish = normalized.includes('发布') || normalized.includes('投放')
  const expectedOffers = extractExpectedOfferCountFromMessageText(messageText)
  return {
    kind: 'creative_triplet_publish',
    requirePublish,
    expectedOffers,
  }
}

const FEISHU_CHAT_HEALTH_COMMAND_ACTION_HINT_REGEX =
  /(创建|生成|发布|投放|修复|排查|同步|补拉|归因|重建|重跑|恢复|暂停|下线|上线|执行|抓取|拉取|更新)/i
const FEISHU_CHAT_HEALTH_COMMAND_OBJECT_HINT_REGEX =
  /(offer|campaign|ads|asin|mcc|roas|cpc|pb|partnerboost|amazon|佣金|广告|创意|推广|出单|关键词|预算|联盟)/i
const FEISHU_CHAT_HEALTH_QUESTION_HINT_REGEX = /[?？]|为什么|为何|怎么|如何|吗$/
const FEISHU_CHAT_HEALTH_CONTINUATION_HINT_REGEX =
  /^(继续|继续执行|继续任务|继续投放|继续跑|继续做|继续吧|继续上一步|继续上一条|接着|接着做|接着执行|恢复投放|resume|continue|goon)$/i

function normalizeContinuationHintToken(text: string): string {
  return text
    .replace(/\s+/g, '')
    .replace(/[，,。.!！？?;；:：]/g, '')
    .toLowerCase()
}

function isContinuationMessageText(messageText: string | null): boolean {
  const rawText = normalizeMessageText(messageText)
  if (!rawText) return false
  const compact = normalizeContinuationHintToken(rawText)
  if (!compact) return false
  return FEISHU_CHAT_HEALTH_CONTINUATION_HINT_REGEX.test(compact)
}

function shouldExpectExecutionForAllowedMessage(params: {
  messageText: string | null
  workflowState: FeishuChatHealthWorkflowState
  linkedRunCount: number
}): boolean {
  if (params.linkedRunCount > 0) {
    return true
  }

  if (params.workflowState !== 'not_required') {
    return true
  }

  const rawText = normalizeMessageText(params.messageText)
  if (!rawText) {
    return false
  }

  const compact = rawText.replace(/\s+/g, '').toLowerCase()
  if (!compact) {
    return false
  }

  if (/^\/[a-z0-9_-]+$/.test(compact)) {
    return false
  }

  if (/^(hi|hello|你好|您好|在吗|谢谢|没有了)$/.test(compact)) {
    return false
  }

  if (/(天气|几月几日|星期几|ai模型)/i.test(compact)) {
    return false
  }

  if (isContinuationMessageText(rawText)) {
    return true
  }

  const hasActionHint = FEISHU_CHAT_HEALTH_COMMAND_ACTION_HINT_REGEX.test(rawText)
  const hasObjectHint = FEISHU_CHAT_HEALTH_COMMAND_OBJECT_HINT_REGEX.test(rawText)
  if (!(hasActionHint && hasObjectHint)) {
    return false
  }

  const isQuestionLike = FEISHU_CHAT_HEALTH_QUESTION_HINT_REGEX.test(rawText)
  const hasImperativeHint = /(请|需要|帮我|执行|立即|开始)/.test(rawText)
  if (isQuestionLike && !hasImperativeHint) {
    return false
  }

  return true
}

function collectSenderCandidatesFromHealthRow(row: FeishuChatHealthRow): string[] {
  const senderSet = new Set<string>()
  const push = (value: unknown) => {
    const normalized = normalizeShortText(value, 255)
    if (normalized) {
      senderSet.add(normalized)
    }
  }

  push(row.sender_primary_id)
  push(row.sender_open_id)
  push(row.sender_union_id)
  push(row.sender_user_id)
  for (const candidate of safeParseJsonArray(row.sender_candidates_json)) {
    push(candidate)
  }
  return Array.from(senderSet)
}

function hasSharedSender(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false
  const set = new Set(a)
  return b.some((value) => set.has(value))
}

function isRunFailed(status: string, responseStatus?: number | null): boolean {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized === 'failed' || normalized === 'canceled' || normalized === 'expired') {
    return true
  }
  const code = Number(responseStatus)
  return Number.isFinite(code) && code >= 400
}

function isRunAccepted(status: string, responseStatus?: number | null): boolean {
  const normalized = String(status || '').trim().toLowerCase()
  if (normalized !== 'completed') {
    return false
  }
  const code = Number(responseStatus)
  if (!Number.isFinite(code)) {
    return true
  }
  return code >= 200 && code < 300
}

function parseOfferIdFromGeneratePath(path: string): number | null {
  const matched = path.match(/\/api\/offers\/(\d+)\/generate-creatives-queue$/)
  if (!matched) return null
  return toPositiveInteger(matched[1])
}

function parseOfferIdFromRebuildPath(path: string): number | null {
  const matched = path.match(/\/api\/offers\/(\d+)\/rebuild$/)
  if (!matched) return null
  return toPositiveInteger(matched[1])
}

function parsePublishCampaignIds(responseBodyJson: Record<string, unknown> | null): number[] {
  if (!responseBodyJson) return []
  const campaigns = responseBodyJson.campaigns
  if (!Array.isArray(campaigns)) return []
  return campaigns
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const row = item as Record<string, unknown>
      return toPositiveInteger(row.id)
    })
    .filter((value): value is number => Boolean(value))
}

function parseWorkflowRun(run: OpenclawCommandRunLinkRow): ParsedWorkflowRun | null {
  const createdAt = toIsoTimestamp(run.created_at)
  const createdMs = Date.parse(createdAt)
  if (!Number.isFinite(createdMs)) {
    return null
  }

  const requestPath = String(run.request_path || '').trim()
  const requestBody = safeParseJsonObject(run.request_body_json)
  const responseBody = safeParseJsonObject(run.response_body)

  const isCreativeGenerate = /\/api\/offers\/\d+\/generate-creatives-queue$/.test(requestPath)
  const isPublish = requestPath === '/api/campaigns/publish'

  let offerId: number | null = null
  let bucket: NormalizedCreativeBucket | null = null
  let creativeTaskId: string | null = null
  let publishAdCreativeId: number | null = null
  let publishCampaignIds: number[] = []

  if (isCreativeGenerate) {
    offerId = parseOfferIdFromGeneratePath(requestPath)
    bucket = normalizeCreativeBucket(requestBody?.bucket)
    creativeTaskId = normalizeShortText(responseBody?.taskId, 120)
  } else if (isPublish) {
    offerId = toPositiveInteger(requestBody?.offerId ?? requestBody?.offer_id)
    publishAdCreativeId = toPositiveInteger(requestBody?.adCreativeId ?? requestBody?.ad_creative_id)
    publishCampaignIds = parsePublishCampaignIds(responseBody)
  } else if (requestPath === '/api/offers/extract') {
    offerId = toPositiveInteger(responseBody?.offerId)
  } else if (/\/api\/offers\/\d+\/rebuild$/.test(requestPath)) {
    offerId = parseOfferIdFromRebuildPath(requestPath)
  }

  return {
    id: String(run.id),
    createdAt,
    createdMs,
    status: String(run.status || ''),
    requestPath,
    offerId,
    bucket,
    creativeTaskId,
    publishAdCreativeId,
    publishCampaignIds,
    isCreativeGenerate,
    isPublish,
    isFailed: isRunFailed(run.status, run.response_status),
    isAccepted: isRunAccepted(run.status, run.response_status),
  }
}

function resolvePrimaryOfferId(runs: ParsedWorkflowRun[]): number | null {
  return resolveWorkflowOfferIds({ runs, expectedOffers: 1 })[0] || null
}

function resolveWorkflowOfferIds(params: {
  runs: ParsedWorkflowRun[]
  expectedOffers: number
}): number[] {
  const statsByOffer = new Map<number, { score: number; bucketSet: Set<NormalizedCreativeBucket>; latestMs: number }>()

  for (const run of params.runs) {
    if (!run.offerId) continue
    const current = statsByOffer.get(run.offerId) || {
      score: 0,
      bucketSet: new Set<NormalizedCreativeBucket>(),
      latestMs: 0,
    }

    if (run.isCreativeGenerate) {
      current.score += 10
      if (run.bucket) {
        current.bucketSet.add(run.bucket)
      }
    } else if (run.isPublish) {
      current.score += 8
    } else if (/\/api\/offers\/\d+\/rebuild$/.test(run.requestPath)) {
      current.score += 3
    } else if (run.requestPath === '/api/offers/extract') {
      current.score += 1
    }

    current.latestMs = Math.max(current.latestMs, run.createdMs)
    statsByOffer.set(run.offerId, current)
  }

  const sortedOffers = Array.from(statsByOffer.entries())
    .map(([offerId, stat]) => ({
      offerId,
      score: stat.score + stat.bucketSet.size * 100,
      latestMs: stat.latestMs,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return b.latestMs - a.latestMs
    })
    .map((item) => item.offerId)

  if (sortedOffers.length === 0) return []

  const maxOffers = clamp(params.expectedOffers || 1, 1, 10)
  return sortedOffers.slice(0, Math.min(maxOffers, sortedOffers.length))
}

function evaluateCreativeBucketStep(params: {
  bucket: NormalizedCreativeBucket
  offerId: number | null
  labelPrefix?: string
  keyPrefix?: string
  runs: ParsedWorkflowRun[]
  creativeTaskById: Map<string, CreativeTaskStatusRow>
}): FeishuChatHealthWorkflowStep {
  const label = params.labelPrefix
    ? `${params.labelPrefix} · 生成桶 ${params.bucket}`
    : `生成桶 ${params.bucket}`
  const key = `${params.keyPrefix || ''}creative_${params.bucket.toLowerCase()}`
  const scopedRuns = params.runs.filter((run) => {
    if (!run.isCreativeGenerate) return false
    if (run.bucket !== params.bucket) return false
    if (params.offerId && run.offerId && run.offerId !== params.offerId) return false
    return true
  })

  if (scopedRuns.length === 0) {
    return {
      key,
      label,
      status: 'pending',
      detail: `待生成桶 ${params.bucket}`,
    }
  }

  const ordered = scopedRuns.slice().sort((a, b) => b.createdMs - a.createdMs)
  let hasRunning = false
  let hasFailure = false
  let hasUnknown = false
  let runningDetail = ''
  let failureDetail = ''

  for (const run of ordered) {
    if (run.creativeTaskId) {
      const task = params.creativeTaskById.get(run.creativeTaskId)
      const taskStatus = String(task?.status || '').trim().toLowerCase()
      if (taskStatus === 'completed') {
        return {
          key,
          label,
          status: 'completed',
          detail: `桶 ${params.bucket} 创意已完成`,
        }
      }
      if (taskStatus === 'running' || taskStatus === 'pending') {
        hasRunning = true
        runningDetail = task?.message ? String(task.message) : `桶 ${params.bucket} 创意生成中`
        continue
      }
      if (taskStatus === 'failed') {
        hasFailure = true
        failureDetail = task?.message ? String(task.message) : `桶 ${params.bucket} 创意任务失败`
        continue
      }
    }

    if (run.isFailed) {
      hasFailure = true
      failureDetail = `桶 ${params.bucket} 命令失败`
      continue
    }

    const normalizedStatus = String(run.status || '').trim().toLowerCase()
    if (run.isAccepted || normalizedStatus === 'running' || normalizedStatus === 'queued' || normalizedStatus === 'pending_confirm') {
      hasRunning = true
      runningDetail = `桶 ${params.bucket} 命令已受理，等待任务完成`
      continue
    }

    hasUnknown = true
  }

  if (hasRunning) {
    return {
      key,
      label,
      status: 'running',
      detail: runningDetail || `桶 ${params.bucket} 处理中`,
    }
  }
  if (hasFailure) {
    return {
      key,
      label,
      status: 'failed',
      detail: failureDetail || `桶 ${params.bucket} 失败`,
    }
  }
  if (hasUnknown) {
    return {
      key,
      label,
      status: 'unknown',
      detail: `桶 ${params.bucket} 状态未知`,
    }
  }

  return {
    key,
    label,
    status: 'pending',
    detail: `待生成桶 ${params.bucket}`,
  }
}

function evaluatePublishStep(params: {
  offerId: number | null
  labelPrefix?: string
  keyPrefix?: string
  runs: ParsedWorkflowRun[]
  campaignsByOfferId: Map<number, CampaignWorkflowStatusRow[]>
  nowMs: number
  runningStaleSeconds: number
}): FeishuChatHealthWorkflowStep {
  const key = `${params.keyPrefix || ''}publish`
  const label = params.labelPrefix ? `${params.labelPrefix} · 发布广告` : '发布广告'
  const scopedRuns = params.runs
    .filter((run) => run.isPublish && (!params.offerId || !run.offerId || run.offerId === params.offerId))
    .sort((a, b) => b.createdMs - a.createdMs)

  if (scopedRuns.length === 0) {
    return {
      key,
      label,
      status: 'pending',
      detail: '待发布',
    }
  }

  const campaignIds = new Set<number>()
  const adCreativeIds = new Set<number>()
  const acceptedRuns = scopedRuns.filter((run) => run.isAccepted)
  const failedRuns = scopedRuns.filter((run) => run.isFailed)
  const latestAcceptedRunMs = acceptedRuns.length > 0
    ? Math.max(...acceptedRuns.map((run) => run.createdMs))
    : null
  const acceptedRunAgeSeconds = latestAcceptedRunMs && Number.isFinite(latestAcceptedRunMs)
    ? Math.max(0, Math.floor((params.nowMs - latestAcceptedRunMs) / 1000))
    : null
  const firstPublishMs = Math.min(...scopedRuns.map((run) => run.createdMs))
  for (const run of scopedRuns) {
    run.publishCampaignIds.forEach((id) => campaignIds.add(id))
    if (run.publishAdCreativeId) {
      adCreativeIds.add(run.publishAdCreativeId)
    }
  }

  const offerCampaigns = params.offerId
    ? (params.campaignsByOfferId.get(params.offerId) || [])
    : []

  const campaignRows = offerCampaigns.filter((row) => {
    if (campaignIds.size > 0) {
      return campaignIds.has(Number(row.id))
    }
    const createdMs = Date.parse(toIsoTimestamp(row.created_at))
    if (!Number.isFinite(createdMs) || createdMs < firstPublishMs - 5 * 60 * 1000) {
      return false
    }
    if (adCreativeIds.size > 0) {
      return row.ad_creative_id ? adCreativeIds.has(Number(row.ad_creative_id)) : false
    }
    return true
  })

  if (campaignRows.length > 0) {
    const hasSynced = campaignRows.some((campaign) => {
      const creationStatus = String(campaign.creation_status || '').trim().toLowerCase()
      const isDeleted = campaign.is_deleted === true || Number(campaign.is_deleted) === 1
      return creationStatus === 'synced' && !isDeleted
    })
    if (hasSynced) {
      return {
        key,
        label,
        status: 'completed',
        detail: '发布完成并已同步',
      }
    }

    const hasPending = campaignRows.some((campaign) => {
      const creationStatus = String(campaign.creation_status || '').trim().toLowerCase()
      return creationStatus === 'pending' || creationStatus === 'draft'
    })
    if (hasPending) {
      const latestPendingUpdatedMs = campaignRows.reduce((maxMs, campaign) => {
        const creationStatus = String(campaign.creation_status || '').trim().toLowerCase()
        if (!(creationStatus === 'pending' || creationStatus === 'draft')) {
          return maxMs
        }
        const updatedMs = Date.parse(toIsoTimestamp(campaign.updated_at || campaign.created_at))
        if (!Number.isFinite(updatedMs)) {
          return maxMs
        }
        return Math.max(maxMs, updatedMs)
      }, Number.NEGATIVE_INFINITY)
      if (Number.isFinite(latestPendingUpdatedMs)) {
        const pendingAgeSeconds = Math.max(0, Math.floor((params.nowMs - latestPendingUpdatedMs) / 1000))
        if (pendingAgeSeconds >= params.runningStaleSeconds) {
          return {
            key,
            label,
            status: 'pending',
            detail: `Campaign 长时间未同步（>${params.runningStaleSeconds}s）`,
          }
        }
      }
      return {
        key,
        label,
        status: 'running',
        detail: '发布已受理，等待 Campaign 同步',
      }
    }

    const hasFailed = campaignRows.some((campaign) => {
      const creationStatus = String(campaign.creation_status || '').trim().toLowerCase()
      return creationStatus === 'failed'
    })
    if (hasFailed) {
      return {
        key,
        label,
        status: 'failed',
        detail: 'Campaign 发布失败',
      }
    }
  }

  if (acceptedRuns.length > 0) {
    if (acceptedRunAgeSeconds !== null && acceptedRunAgeSeconds >= params.runningStaleSeconds) {
      return {
        key,
        label,
        status: 'pending',
        detail: `发布已受理但超时未落地（>${params.runningStaleSeconds}s）`,
      }
    }
    return {
      key,
      label,
      status: 'running',
      detail: '发布请求已受理，等待业务结果',
    }
  }
  if (failedRuns.length > 0) {
    return {
      key,
      label,
      status: 'failed',
      detail: '发布命令失败',
    }
  }

  return {
    key,
    label,
    status: 'unknown',
    detail: '发布状态未知',
  }
}

function buildWorkflowAssessmentForMessage(params: {
  context: WorkflowContext
  runs: ParsedWorkflowRun[]
  creativeTaskById: Map<string, CreativeTaskStatusRow>
  campaignsByOfferId: Map<number, CampaignWorkflowStatusRow[]>
  workflowIncompleteSeconds: number
  nowMs: number
  publishRunningStaleSeconds: number
}): WorkflowAssessment {
  const expectedOffers = clamp(params.context.expectation.expectedOffers || 1, 1, 10)
  const workflowOfferIds = resolveWorkflowOfferIds({
    runs: params.runs,
    expectedOffers,
  })
  const primaryOfferId = workflowOfferIds[0] || params.context.primaryOfferId || resolvePrimaryOfferId(params.runs)
  const steps: FeishuChatHealthWorkflowStep[] = []

  for (const offerId of workflowOfferIds) {
    const multiOffer = expectedOffers > 1 || workflowOfferIds.length > 1
    const labelPrefix = multiOffer ? `Offer ${offerId}` : undefined
    const keyPrefix = multiOffer ? `offer_${offerId}_` : ''

    steps.push(
      evaluateCreativeBucketStep({
        bucket: 'A',
        offerId,
        labelPrefix,
        keyPrefix,
        runs: params.runs,
        creativeTaskById: params.creativeTaskById,
      }),
      evaluateCreativeBucketStep({
        bucket: 'B',
        offerId,
        labelPrefix,
        keyPrefix,
        runs: params.runs,
        creativeTaskById: params.creativeTaskById,
      }),
      evaluateCreativeBucketStep({
        bucket: 'D',
        offerId,
        labelPrefix,
        keyPrefix,
        runs: params.runs,
        creativeTaskById: params.creativeTaskById,
      })
    )

    if (params.context.expectation.requirePublish) {
      steps.push(
        evaluatePublishStep({
          offerId,
          labelPrefix,
          keyPrefix,
          runs: params.runs,
          campaignsByOfferId: params.campaignsByOfferId,
          nowMs: params.nowMs,
          runningStaleSeconds: params.publishRunningStaleSeconds,
        })
      )
    }
  }

  if (workflowOfferIds.length < expectedOffers) {
    for (let index = workflowOfferIds.length; index < expectedOffers; index += 1) {
      const seq = index + 1
      steps.push({
        key: `offer_missing_${seq}`,
        label: `Offer #${seq} 链路`,
        status: 'pending',
        detail: params.context.expectation.requirePublish
          ? `待识别第${seq}个 Offer 并完成 A/B/D + 发布`
          : `待识别第${seq}个 Offer 并完成 A/B/D`,
      })
    }
  }

  if (steps.length === 0) {
    return {
      state: 'unknown',
      progress: 0,
      detail: 'workflow 步骤为空',
      offerId: primaryOfferId,
      steps,
    }
  }

  const completedSteps = steps.filter((step) => step.status === 'completed')
  const runningSteps = steps.filter((step) => step.status === 'running')
  const failedSteps = steps.filter((step) => step.status === 'failed')
  const pendingSteps = steps.filter((step) => step.status === 'pending')
  const unknownSteps = steps.filter((step) => step.status === 'unknown')
  const progress = clamp(
    Math.round(((completedSteps.length + runningSteps.length * 0.5) / steps.length) * 100),
    0,
    100
  )

  if (failedSteps.length > 0) {
    return {
      state: 'failed',
      progress,
      detail: `业务链路失败：${failedSteps.map((step) => step.label).join('，')}`,
      offerId: primaryOfferId,
      steps,
    }
  }

  if (completedSteps.length === steps.length) {
    return {
      state: 'completed',
      progress: 100,
      detail: '业务链路完成',
      offerId: primaryOfferId,
      steps,
    }
  }

  if (runningSteps.length > 0 || unknownSteps.length > 0) {
    const activeLabels = [...runningSteps, ...unknownSteps].map((step) => step.label)
    return {
      state: 'running',
      progress,
      detail: `业务链路执行中：${activeLabels.join('，')}`,
      offerId: primaryOfferId,
      steps,
    }
  }

  if (pendingSteps.length > 0) {
    const pendingLabels = pendingSteps.map((step) => step.label).join('，')
    if (params.context.ageSeconds >= params.workflowIncompleteSeconds) {
      return {
        state: 'incomplete',
        progress,
        detail: `业务链路未完成：${pendingLabels}`,
        offerId: primaryOfferId,
        steps,
      }
    }
    return {
      state: 'running',
      progress,
      detail: `业务链路等待：${pendingLabels}`,
      offerId: primaryOfferId,
      steps,
    }
  }

  return {
    state: 'unknown',
    progress,
    detail: '业务链路状态未知',
    offerId: primaryOfferId,
    steps,
  }
}

async function buildWorkflowAssessmentsByMessageId(params: {
  db: Awaited<ReturnType<typeof getDatabase>>
  userId: number
  rows: FeishuChatHealthRow[]
  runsByMessageId: Map<string, OpenclawCommandRunLinkRow[]>
  withinHours: number
  nowMs: number
}): Promise<Map<string, WorkflowAssessment>> {
  const workflowContexts: WorkflowContext[] = []
  const allowedMessageBoundaries: Array<{
    createdMs: number
    senderCandidates: string[]
    isSoftBoundary: boolean
  }> = []

  for (const row of params.rows) {
    if (row.decision !== 'allowed') continue
    const messageId = normalizeShortText(row.message_id, 120)
    if (!messageId) continue

    const timing = resolveFeishuChatHealthEventTiming({
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
    })
    const createdMs = timing.linkAnchorMs
    const messageText = normalizeMessageText(row.message_text)

    const senderCandidates = collectSenderCandidatesFromHealthRow(row)
    allowedMessageBoundaries.push({
      createdMs,
      senderCandidates,
      // Continuation-only messages (e.g. "继续") should not split an unfinished
      // workflow into independent chains.
      isSoftBoundary: isContinuationMessageText(messageText),
    })

    const expectation = resolveCreativeWorkflowExpectation(messageText)
    if (!expectation) continue

    const ageSeconds = Math.max(0, Math.floor((params.nowMs - createdMs) / 1000))
    workflowContexts.push({
      messageId,
      createdMs,
      senderCandidates,
      expectation,
      linkedRuns: params.runsByMessageId.get(messageId) || [],
      ageSeconds,
      windowStartMs: createdMs,
      windowEndMs: createdMs,
      primaryOfferId: null,
    })
  }

  if (workflowContexts.length === 0) {
    return new Map<string, WorkflowAssessment>()
  }

  const maxWindowMs = resolveWorkflowMaxWindowSeconds() * 1000
  const sortedContexts = workflowContexts.slice().sort((a, b) => a.createdMs - b.createdMs)
  const sortedAllowedBoundaries = allowedMessageBoundaries
    .slice()
    .sort((a, b) => a.createdMs - b.createdMs)
  for (let i = 0; i < sortedContexts.length; i += 1) {
    const context = sortedContexts[i]
    let previousBoundaryMs: number | null = null
    let nextBoundaryMs: number | null = null
    for (const boundary of sortedAllowedBoundaries) {
      if (boundary.isSoftBoundary) {
        continue
      }
      if (hasSharedSender(context.senderCandidates, boundary.senderCandidates)) {
        if (boundary.createdMs < context.createdMs) {
          previousBoundaryMs = boundary.createdMs
          continue
        }
        if (boundary.createdMs === context.createdMs) {
          // Ignore self-boundary.
          continue
        }
        nextBoundaryMs = boundary.createdMs
        break
      }
    }

    const earliestLinkedRunMs = context.linkedRuns.reduce((minMs, run) => {
      const runMs = Date.parse(toIsoTimestamp(run.created_at))
      if (!Number.isFinite(runMs)) {
        return minMs
      }
      return Math.min(minMs, runMs)
    }, Number.POSITIVE_INFINITY)
    const linkAnchorMs = Number.isFinite(earliestLinkedRunMs)
      ? Math.min(context.createdMs, earliestLinkedRunMs)
      : context.createdMs

    const hardWindowEnd = context.createdMs + maxWindowMs
    const dynamicWindow = resolveDynamicLinkWindowSeconds({
      messageText: null,
      expectation: context.expectation,
    })
    context.windowStartMs = linkAnchorMs - dynamicWindow.beforeSeconds * 1000
    if (previousBoundaryMs !== null) {
      // Keep recovery within this message segment and avoid stealing runs from
      // the previous allowed message of the same sender.
      context.windowStartMs = Math.max(context.windowStartMs, previousBoundaryMs + 1)
    }
    context.windowEndMs = nextBoundaryMs
      ? Math.min(hardWindowEnd, nextBoundaryMs - 1)
      : hardWindowEnd
    if (context.windowEndMs < context.windowStartMs) {
      context.windowEndMs = context.windowStartMs
    }
  }

  const workflowSenderSet = new Set<string>()
  sortedContexts.forEach((context) => {
    context.senderCandidates.forEach((sender) => workflowSenderSet.add(sender))
  })
  const workflowSendersAll = Array.from(workflowSenderSet)
  const canUseSenderFilter = workflowSendersAll.length > 0 && workflowSendersAll.length <= 200
  const workflowSenders = canUseSenderFilter ? workflowSendersAll : []
  const cutoffExpr = datetimeMinusHours(params.withinHours + 1, params.db.type)

  const workflowCandidateRuns = await (async () => {
    if (workflowSenders.length > 0) {
      const senderPlaceholders = workflowSenders.map(() => '?').join(', ')
      return await params.db.query<OpenclawCommandRunLinkRow>(
        `SELECT id, parent_request_id, channel, sender_id, status, request_path, request_body_json, response_status, response_body, created_at
         FROM openclaw_command_runs
         WHERE user_id = ?
           AND channel = 'feishu'
           AND sender_id IN (${senderPlaceholders})
           AND created_at >= ${cutoffExpr}
         ORDER BY created_at ASC`,
        [params.userId, ...workflowSenders]
      )
    }

    return await params.db.query<OpenclawCommandRunLinkRow>(
      `SELECT id, parent_request_id, channel, sender_id, status, request_path, request_body_json, response_status, response_body, created_at
       FROM openclaw_command_runs
       WHERE user_id = ?
         AND channel = 'feishu'
         AND created_at >= ${cutoffExpr}
       ORDER BY created_at ASC`,
      [params.userId]
    )
  })()

  const runsBySender = new Map<string, OpenclawCommandRunLinkRow[]>()
  for (const run of workflowCandidateRuns) {
    const sender = normalizeShortText(run.sender_id, 255)
    if (!sender) continue
    const bucket = runsBySender.get(sender) || []
    bucket.push(run)
    runsBySender.set(sender, bucket)
  }

  const parsedRunsByContextMessageId = new Map<string, ParsedWorkflowRun[]>()
  const parsedRunsById = new Map<string, ParsedWorkflowRun>()
  for (const context of sortedContexts) {
    const mergedRuns = new Map<string, OpenclawCommandRunLinkRow>()
    context.linkedRuns.forEach((run) => mergedRuns.set(String(run.id), run))

    for (const sender of context.senderCandidates) {
      const senderRuns = runsBySender.get(sender) || []
      for (const run of senderRuns) {
        const runMs = Date.parse(toIsoTimestamp(run.created_at))
        if (!Number.isFinite(runMs)) continue
        if (runMs < context.windowStartMs) continue
        if (runMs > context.windowEndMs) break
        mergedRuns.set(String(run.id), run)
      }
    }

    const parsedRuns = Array.from(mergedRuns.values())
      .map((run) => {
        const cached = parsedRunsById.get(String(run.id))
        if (cached) return cached
        const parsed = parseWorkflowRun(run)
        if (!parsed) return null
        parsedRunsById.set(String(run.id), parsed)
        return parsed
      })
      .filter((value): value is ParsedWorkflowRun => Boolean(value))
      .sort((a, b) => a.createdMs - b.createdMs)

    parsedRunsByContextMessageId.set(context.messageId, parsedRuns)
    context.primaryOfferId = resolvePrimaryOfferId(parsedRuns)
  }

  const creativeTaskIds = Array.from(
    new Set(
      Array.from(parsedRunsById.values())
        .map((run) => normalizeShortText(run.creativeTaskId, 120))
        .filter((value): value is string => Boolean(value))
    )
  )

  const creativeTaskById = new Map<string, CreativeTaskStatusRow>()
  for (let start = 0; start < creativeTaskIds.length; start += 200) {
    const chunk = creativeTaskIds.slice(start, start + 200)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = await params.db.query<CreativeTaskStatusRow>(
      `SELECT id, offer_id, status, stage, progress, message, completed_at, updated_at
       FROM creative_tasks
       WHERE id IN (${placeholders})`,
      [...chunk]
    )
    rows.forEach((row) => {
      creativeTaskById.set(String(row.id), row)
    })
  }

  const offerIdSet = new Set<number>()
  const hasPublishRun = Array.from(parsedRunsById.values()).some((run) => run.isPublish)
  if (hasPublishRun) {
    Array.from(parsedRunsById.values()).forEach((run) => {
      if (run.offerId) offerIdSet.add(run.offerId)
    })
  }

  const campaignsByOfferId = new Map<number, CampaignWorkflowStatusRow[]>()
  const offerIds = Array.from(offerIdSet)
  for (let start = 0; start < offerIds.length; start += 100) {
    const chunk = offerIds.slice(start, start + 100)
    const placeholders = chunk.map(() => '?').join(', ')
    const campaignRows = await params.db.query<CampaignWorkflowStatusRow>(
      `SELECT id, offer_id, ad_creative_id, creation_status, creation_error, status, is_deleted, created_at, updated_at, published_at
       FROM campaigns
       WHERE user_id = ?
         AND offer_id IN (${placeholders})
       ORDER BY updated_at DESC`,
      [params.userId, ...chunk]
    )
    campaignRows.forEach((row) => {
      const key = Number(row.offer_id)
      const bucket = campaignsByOfferId.get(key) || []
      bucket.push(row)
      campaignsByOfferId.set(key, bucket)
    })
  }

  const workflowIncompleteSeconds = resolveWorkflowIncompleteSeconds()
  const publishRunningStaleSeconds = resolvePublishRunningStaleSeconds()
  const result = new Map<string, WorkflowAssessment>()
  for (const context of sortedContexts) {
    const parsedRuns = parsedRunsByContextMessageId.get(context.messageId) || []
    const assessment = buildWorkflowAssessmentForMessage({
      context,
      runs: parsedRuns,
      creativeTaskById,
      campaignsByOfferId,
      workflowIncompleteSeconds,
      nowMs: params.nowMs,
      publishRunningStaleSeconds,
    })
    result.set(context.messageId, assessment)
  }

  return result
}

export async function backfillFeishuChatHealthRunLinks(params: {
  userId: number
  messageId: string
  senderIds: string[]
}): Promise<{ updatedRuns: number }> {
  const db = await getDatabase()

  const messageId = normalizeShortText(params.messageId, 120)
  if (!messageId) return { updatedRuns: 0 }

  const senderIds = Array.from(
    new Set(params.senderIds.map((item) => normalizeFeishuIdentifier(item)).filter(Boolean))
  ) as string[]

  if (senderIds.length === 0) {
    return { updatedRuns: 0 }
  }

  const healthRow = await db.queryOne<FeishuChatHealthAnchorRow>(
    `SELECT created_at, message_text, metadata_json
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND message_id = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [params.userId, messageId]
  )

  const healthTiming = resolveFeishuChatHealthEventTiming({
    metadataJson: healthRow?.metadata_json || null,
    createdAt: healthRow?.created_at || new Date().toISOString(),
  })
  const expectation = resolveCreativeWorkflowExpectation(normalizeMessageText(healthRow?.message_text || null))
  const dynamicWindow = resolveDynamicLinkWindowSeconds({
    messageText: normalizeMessageText(healthRow?.message_text || null),
    expectation,
  })

  const senderPlaceholders = senderIds.map(() => '?').join(', ')

  const previousAllowedHealthRow = await db.queryOne<FeishuChatHealthCreatedAtRow>(
    `SELECT created_at
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND decision = 'allowed'
       AND lower(trim(reason_code)) IN ('reply_dispatched', 'reply_enqueued', 'reply_delivered')
       AND message_id IS NOT NULL
       AND message_id <> ?
       AND created_at < (
         SELECT created_at
         FROM openclaw_feishu_chat_health_logs
         WHERE user_id = ?
           AND message_id = ?
         ORDER BY created_at DESC
         LIMIT 1
       )
       AND (
         sender_primary_id IN (${senderPlaceholders})
         OR sender_open_id IN (${senderPlaceholders})
         OR sender_union_id IN (${senderPlaceholders})
         OR sender_user_id IN (${senderPlaceholders})
       )
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      params.userId,
      messageId,
      params.userId,
      messageId,
      ...senderIds,
      ...senderIds,
      ...senderIds,
      ...senderIds,
    ]
  )

  let startMs = Math.min(
    healthTiming.linkAnchorMs,
    healthTiming.dispatchAnchorMs - dynamicWindow.beforeSeconds * 1000
  )
  const endMs = healthTiming.dispatchAnchorMs + dynamicWindow.afterSeconds * 1000

  if (previousAllowedHealthRow) {
    const previousMs = Date.parse(toIsoTimestamp(previousAllowedHealthRow.created_at))
    if (Number.isFinite(previousMs)) {
      // Avoid crossing into the previous allowed message window for the same sender.
      startMs = Math.max(startMs, previousMs + 1)
    }
  }

  const cutoffExpr = datetimeMinusHours(6, db.type)
  const candidateRuns = await db.query<OpenclawCommandRunLinkRow>(
    `SELECT id, parent_request_id, channel, sender_id, status, created_at
     FROM openclaw_command_runs
     WHERE user_id = ?
       AND channel = 'feishu'
       AND sender_id IN (${senderPlaceholders})
       AND created_at >= ${cutoffExpr}
     ORDER BY created_at DESC`,
    [params.userId, ...senderIds]
  )

  const runIds: string[] = []
  for (const run of candidateRuns) {
    const parent = normalizeShortText(run.parent_request_id, 120)
    if (parent && parent.toLowerCase().startsWith('om_')) {
      continue
    }

    const runMs = Date.parse(toIsoTimestamp(run.created_at))
    if (!Number.isFinite(runMs)) continue
    if (runMs < startMs || runMs > endMs) continue
    runIds.push(String(run.id))
  }

  const uniqueRunIds = Array.from(new Set(runIds)).slice(0, 50)
  if (uniqueRunIds.length === 0) {
    return { updatedRuns: 0 }
  }

  const runIdPlaceholders = uniqueRunIds.map(() => '?').join(', ')
  const result = await db.exec(
    `UPDATE openclaw_command_runs
     SET parent_request_id = ?
     WHERE user_id = ?
       AND id IN (${runIdPlaceholders})
       AND (parent_request_id IS NULL OR lower(trim(parent_request_id)) NOT LIKE 'om_%')`,
    [messageId, params.userId, ...uniqueRunIds]
  )

  return {
    updatedRuns: Number(result?.changes || 0),
  }
}

async function cleanupFeishuChatHealthLogsIfNeeded() {
  const now = Date.now()
  if (now - lastCleanupAt < FEISHU_HEALTH_CLEANUP_INTERVAL_MS) {
    return
  }
  lastCleanupAt = now

  const db = await getDatabase()
  const cutoffExpr = datetimeMinusHours(FEISHU_HEALTH_RETENTION_HOURS, db.type)
  await db.exec(
    `DELETE FROM openclaw_feishu_chat_health_logs
     WHERE created_at < ${cutoffExpr}`
  )
}

export async function recordFeishuChatHealthLog(input: FeishuChatHealthLogInput): Promise<void> {
  const db = await getDatabase()

  const accountId = normalizeShortText(input.accountId, 120)
  const reasonCode = normalizeShortText(input.reasonCode, 120)
  if (!accountId || !reasonCode) {
    throw new Error('accountId/reasonCode 不能为空')
  }

  const senderCandidates = Array.from(
    new Set(
      (input.senderCandidates || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 20)
    )
  )

  const messageText = normalizeMessageText(input.messageText)
  const messageReceivedAt = normalizeIsoTimestampInput(input.messageReceivedAt)
  const replyDispatchedAt = normalizeIsoTimestampInput(input.replyDispatchedAt)
  const metadataPayload = input.metadata && typeof input.metadata === 'object'
    ? { ...input.metadata }
    : {} as Record<string, unknown>
  if (messageReceivedAt) {
    metadataPayload.messageReceivedAt = messageReceivedAt
  }
  if (replyDispatchedAt) {
    metadataPayload.replyDispatchedAt = replyDispatchedAt
  }
  const metadataJson = Object.keys(metadataPayload).length > 0 ? JSON.stringify(metadataPayload) : null

  await db.exec(
    `INSERT INTO openclaw_feishu_chat_health_logs
     (user_id, account_id, message_id, chat_id, chat_type, message_type,
      sender_primary_id, sender_open_id, sender_union_id, sender_user_id,
      sender_candidates_json, decision, reason_code, reason_message,
      message_text, message_text_length, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.userId,
      accountId,
      normalizeShortText(input.messageId, 120),
      normalizeShortText(input.chatId, 120),
      normalizeShortText(input.chatType, 32),
      normalizeShortText(input.messageType, 32),
      normalizeShortText(input.senderPrimaryId, 255),
      normalizeShortText(input.senderOpenId, 255),
      normalizeShortText(input.senderUnionId, 255),
      normalizeShortText(input.senderUserId, 255),
      senderCandidates.length > 0 ? JSON.stringify(senderCandidates) : null,
      input.decision,
      reasonCode,
      normalizeShortText(input.reasonMessage, 500),
      messageText,
      messageText ? messageText.length : 0,
      metadataJson,
    ]
  )

  void cleanupFeishuChatHealthLogsIfNeeded().catch(() => {})
}

export async function listFeishuChatHealthLogs(params: {
  userId: number
  withinHours?: number
  limit?: number
}): Promise<FeishuChatHealthListResult> {
  const db = await getDatabase()
  await failStaleQueuedCommandRuns({
    db,
    userId: params.userId,
  })
  const withinHours = clamp(params.withinHours || FEISHU_CHAT_HEALTH_WINDOW_HOURS, 1, FEISHU_HEALTH_RETENTION_HOURS)
  const limit = clamp(params.limit || 200, 20, 500)
  const cutoffExpr = datetimeMinusHours(withinHours, db.type)

  const dbRows = await db.query<FeishuChatHealthRow>(
    `SELECT
       id,
       user_id,
       account_id,
       message_id,
       chat_id,
       chat_type,
       message_type,
       sender_primary_id,
       sender_open_id,
       sender_union_id,
       sender_user_id,
       sender_candidates_json,
       decision,
       reason_code,
       reason_message,
       message_text,
       message_text_length,
       metadata_json,
       created_at
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND created_at >= ${cutoffExpr}
       AND lower(trim(reason_code)) <> '${FEISHU_CHAT_HEALTH_NOISE_REASON_CODE}'
     ORDER BY created_at DESC
     LIMIT ?`,
    [params.userId, limit]
  )

  const existingMessageIdSet = new Set(
    dbRows
      .map((row) => normalizeShortText(row.message_id, 120))
      .filter((value): value is string => Boolean(value))
  )

  const recentCommandRuns = await db.query<OpenclawCommandRunLinkRow>(
    `SELECT id, parent_request_id, channel, sender_id, status, request_path, request_body_json, response_status, response_body, created_at
     FROM openclaw_command_runs
     WHERE user_id = ?
       AND channel = 'feishu'
       AND created_at >= ${cutoffExpr}
     ORDER BY created_at DESC`,
    [params.userId]
  )

  const syntheticByMessageId = new Map<string, FeishuSyntheticHealthCandidate>()
  for (const run of recentCommandRuns) {
    const messageId = normalizeShortText(run.parent_request_id, 120)
    if (!messageId || !messageId.toLowerCase().startsWith('om_')) {
      continue
    }
    if (existingMessageIdSet.has(messageId)) {
      continue
    }

    const current = syntheticByMessageId.get(messageId)
    if (!current) {
      syntheticByMessageId.set(messageId, {
        messageId,
        createdAt: run.created_at,
        senderId: normalizeShortText(run.sender_id, 255),
        requestPath: normalizeShortText(run.request_path, 255),
        requestBodyJson: run.request_body_json || null,
        runCount: 1,
      })
      continue
    }

    current.runCount += 1
    const currentMs = Date.parse(toIsoTimestamp(current.createdAt))
    const runMs = Date.parse(toIsoTimestamp(run.created_at))
    if (Number.isFinite(runMs) && (!Number.isFinite(currentMs) || runMs < currentMs)) {
      current.createdAt = run.created_at
      current.requestPath = normalizeShortText(run.request_path, 255) || current.requestPath
      current.requestBodyJson = run.request_body_json || current.requestBodyJson
    }
    if (!current.senderId) {
      current.senderId = normalizeShortText(run.sender_id, 255)
    }
  }

  const syntheticRows: FeishuChatHealthRow[] = Array.from(syntheticByMessageId.values())
    .sort((a, b) => Date.parse(toIsoTimestamp(b.createdAt)) - Date.parse(toIsoTimestamp(a.createdAt)))
    .map((candidate, index) => {
      const sender = normalizeShortText(candidate.senderId, 255)
      const senderCandidates = sender ? [sender] : []
      const messageText = toSyntheticMessageTextFromRun(candidate)
      return {
        id: -1 * (index + 1),
        user_id: params.userId,
        account_id: `user-${params.userId}`,
        message_id: candidate.messageId,
        chat_id: null,
        chat_type: null,
        message_type: null,
        sender_primary_id: sender,
        sender_open_id: sender,
        sender_union_id: null,
        sender_user_id: null,
        sender_candidates_json: senderCandidates.length > 0 ? JSON.stringify(senderCandidates) : null,
        decision: 'allowed',
        reason_code: 'command_run_created',
        reason_message: '命令链路已创建，等待聊天回执落库',
        message_text: messageText,
        message_text_length: messageText.length,
        metadata_json: JSON.stringify({
          synthetic: true,
          source: 'command_runs',
          runCount: candidate.runCount,
        }),
        created_at: candidate.createdAt,
      }
    })

  const rows = [...dbRows, ...syntheticRows]
    .sort((a, b) => Date.parse(toIsoTimestamp(b.created_at)) - Date.parse(toIsoTimestamp(a.created_at)))
    .slice(0, limit)

  const statsRows = await db.query<FeishuChatHealthStatsRow>(
    `SELECT decision, COUNT(*) AS total
     FROM openclaw_feishu_chat_health_logs
     WHERE user_id = ?
       AND created_at >= ${cutoffExpr}
       AND lower(trim(reason_code)) <> '${FEISHU_CHAT_HEALTH_NOISE_REASON_CODE}'
     GROUP BY decision`,
    [params.userId]
  )

  const allowedMessageIds = Array.from(
    new Set(
      rows
        .filter((row) => row.decision === 'allowed')
        .map((row) => normalizeShortText(row.message_id, 120))
        .filter((value): value is string => Boolean(value))
    )
  )

  const runsByMessageId = new Map<string, OpenclawCommandRunLinkRow[]>()
  const linkModeByMessageId = new Map<string, 'parent' | 'sender_time'>()
  if (allowedMessageIds.length > 0) {
    const placeholders = allowedMessageIds.map(() => '?').join(', ')
    const runRows = await db.query<OpenclawCommandRunLinkRow>(
      `SELECT id, parent_request_id, channel, sender_id, status, request_path, request_body_json, response_status, response_body, created_at
       FROM openclaw_command_runs
       WHERE user_id = ?
         AND channel = 'feishu'
         AND parent_request_id IN (${placeholders})
       ORDER BY created_at DESC`,
      [params.userId, ...allowedMessageIds]
    )

    for (const run of runRows) {
      const key = normalizeShortText(run.parent_request_id, 120)
      if (!key) continue
      const bucket = runsByMessageId.get(key) || []
      bucket.push(run)
      runsByMessageId.set(key, bucket)
      linkModeByMessageId.set(key, 'parent')
    }
  }

  const missingMessageIds = allowedMessageIds.filter((id) => (runsByMessageId.get(id) || []).length === 0)
  const missingMessageIdSet = new Set(missingMessageIds)
  if (missingMessageIdSet.size > 0) {
    const cutoffExpr = datetimeMinusHours(withinHours + 1, db.type)
    const candidateSenderSet = new Set<string>()
    const pushSenderCandidate = (value: unknown) => {
      const normalized = normalizeShortText(value, 255)
      if (normalized) candidateSenderSet.add(normalized)
    }

    for (const row of rows) {
      if (row.decision !== 'allowed') continue
      const messageId = normalizeShortText(row.message_id, 120)
      if (!messageId) continue
      if (!missingMessageIdSet.has(messageId)) continue

      pushSenderCandidate(row.sender_primary_id)
      pushSenderCandidate(row.sender_open_id)
      pushSenderCandidate(row.sender_union_id)
      pushSenderCandidate(row.sender_user_id)
      for (const candidate of safeParseJsonArray(row.sender_candidates_json)) {
        pushSenderCandidate(candidate)
      }
    }

    const candidateSendersAll = Array.from(candidateSenderSet).map((sender) => sender.trim()).filter(Boolean)
    const canUseSenderFilter = candidateSendersAll.length > 0 && candidateSendersAll.length <= 200
    const candidateSenders = canUseSenderFilter ? candidateSendersAll : []

    const candidateRuns = await (async () => {
      if (candidateSenders.length > 0) {
        const senderPlaceholders = candidateSenders.map(() => '?').join(', ')
        return await db.query<OpenclawCommandRunLinkRow>(
          `SELECT id, parent_request_id, channel, sender_id, status, request_path, request_body_json, response_status, response_body, created_at
           FROM openclaw_command_runs
           WHERE user_id = ?
             AND channel = 'feishu'
             AND sender_id IN (${senderPlaceholders})
             AND created_at >= ${cutoffExpr}
           ORDER BY created_at DESC`,
          [params.userId, ...candidateSenders]
        )
      }

      // Fallback: still keep channel in SQL to avoid scanning other channels.
      return await db.query<OpenclawCommandRunLinkRow>(
        `SELECT id, parent_request_id, channel, sender_id, status, request_path, request_body_json, response_status, response_body, created_at
         FROM openclaw_command_runs
         WHERE user_id = ?
           AND channel = 'feishu'
           AND created_at >= ${cutoffExpr}
         ORDER BY created_at DESC`,
        [params.userId]
      )
    })()

    const runsBySender = new Map<string, OpenclawCommandRunLinkRow[]>()
    for (const run of candidateRuns) {
      // A run already bound to another Feishu message id (`om_*`) should not
      // be re-linked by sender/time fallback, otherwise different messages can
      // incorrectly share the same execution result.
      const parentRequestId = normalizeShortText(run.parent_request_id, 120)
      if (parentRequestId && parentRequestId.toLowerCase().startsWith('om_')) {
        continue
      }

      const sender = normalizeShortText(run.sender_id, 255)
      if (!sender) continue
      const bucket = runsBySender.get(sender) || []
      bucket.push(run)
      runsBySender.set(sender, bucket)
    }

    const linkBeforeMs = resolveExecutionLinkBeforeSeconds() * 1000
    const linkAfterMs = resolveExecutionLinkAfterSeconds() * 1000

    for (const row of rows) {
      if (row.decision !== 'allowed') continue
      const messageId = normalizeShortText(row.message_id, 120)
      if (!messageId) continue
      if (!missingMessageIdSet.has(messageId)) continue

      const timing = resolveFeishuChatHealthEventTiming({
        metadataJson: row.metadata_json,
        createdAt: row.created_at,
      })
      const expectation = resolveCreativeWorkflowExpectation(normalizeMessageText(row.message_text))
      const dynamicWindow = resolveDynamicLinkWindowSeconds({
        messageText: normalizeMessageText(row.message_text),
        expectation,
      })

      const startMs = Math.min(
        timing.linkAnchorMs,
        timing.dispatchAnchorMs - Math.max(linkBeforeMs, dynamicWindow.beforeSeconds * 1000)
      )
      const endMs = timing.dispatchAnchorMs + Math.max(linkAfterMs, dynamicWindow.afterSeconds * 1000)

      const senderCandidates = new Set<string>()
      const pushCandidate = (value: unknown) => {
        const normalized = normalizeShortText(value, 255)
        if (normalized) senderCandidates.add(normalized)
      }

      pushCandidate(row.sender_primary_id)
      pushCandidate(row.sender_open_id)
      pushCandidate(row.sender_union_id)
      pushCandidate(row.sender_user_id)
      for (const candidate of safeParseJsonArray(row.sender_candidates_json)) {
        pushCandidate(candidate)
      }

      const linkedByTime = new Map<string, OpenclawCommandRunLinkRow>()
      for (const sender of senderCandidates) {
        const bucket = runsBySender.get(sender) || []
        for (const run of bucket) {
          const runCreatedAt = toIsoTimestamp(run.created_at)
          const runMs = Date.parse(runCreatedAt)
          if (!Number.isFinite(runMs)) continue
          if (runMs < startMs) {
            // Buckets are ordered DESC; older runs won't match either.
            break
          }
          if (runMs > endMs) {
            continue
          }
          linkedByTime.set(String(run.id), run)
        }
      }

      if (linkedByTime.size === 0) {
        continue
      }

      const merged = Array.from(linkedByTime.values()).sort((a, b) => {
        return Date.parse(toIsoTimestamp(b.created_at)) - Date.parse(toIsoTimestamp(a.created_at))
      })
      runsByMessageId.set(messageId, merged)
      if (!linkModeByMessageId.has(messageId)) {
        linkModeByMessageId.set(messageId, 'sender_time')
      }
    }
  }

  const executionMissingSeconds = getFeishuChatHealthExecutionMissingSeconds()
  const nowMs = Date.now()
  const workflowByMessageId = await buildWorkflowAssessmentsByMessageId({
    db,
    userId: params.userId,
    rows,
    runsByMessageId,
    withinHours,
    nowMs,
  })

  const mapped: FeishuChatHealthLogItem[] = rows.map((row) => {
    const messageText = normalizeMessageText(row.message_text)
    const senderCandidates = safeParseJsonArray(row.sender_candidates_json)
    const metadata = safeParseJsonObject(row.metadata_json)
    const timing = resolveFeishuChatHealthEventTiming({
      metadataJson: row.metadata_json,
      createdAt: row.created_at,
    })
    const createdAt = timing.ingestedAt
    const ageSeconds = Math.max(0, Math.floor((nowMs - timing.dispatchAnchorMs) / 1000))

    let executionState: FeishuChatHealthExecutionState = 'not_applicable'
    let executionRunId: string | null = null
    let executionRunStatus: string | null = null
    let executionRunCount = 0
    let executionRunCreatedAt: string | null = null
    let executionDetail = '非放行消息，无执行链路'
    let workflowState: FeishuChatHealthWorkflowState = 'not_required'
    let workflowProgress = 0
    let workflowDetail = '非放行消息，无需业务 workflow'
    let workflowOfferId: number | null = null
    let workflowSteps: FeishuChatHealthWorkflowStep[] = []

    if (row.decision === 'allowed') {
      const messageId = normalizeShortText(row.message_id, 120)
      if (!messageId) {
        executionState = 'unknown'
        executionDetail = '放行消息缺少 message_id，无法关联执行链路'
        workflowState = 'unknown'
        workflowProgress = 0
        workflowDetail = '放行消息缺少 message_id，无法评估业务 workflow'
      } else {
        const linkedRuns = runsByMessageId.get(messageId) || []
        executionRunCount = linkedRuns.length
        const workflowAssessment = workflowByMessageId.get(messageId)
        if (workflowAssessment) {
          workflowState = workflowAssessment.state
          workflowProgress = workflowAssessment.progress
          workflowDetail = workflowAssessment.detail
          workflowOfferId = workflowAssessment.offerId
          workflowSteps = workflowAssessment.steps
        }

        const shouldExpectExecution = shouldExpectExecutionForAllowedMessage({
          messageText,
          workflowState,
          linkedRunCount: linkedRuns.length,
        })

        if (linkedRuns.length === 0) {
          if (!shouldExpectExecution) {
            executionState = 'not_applicable'
            executionDetail = '放行消息无命令执行预期'
          } else {
            if (ageSeconds >= executionMissingSeconds) {
              executionState = 'missing'
              executionDetail = `放行后超过 ${executionMissingSeconds}s 仍无命令执行记录`
            } else {
              executionState = 'waiting'
              executionDetail = '放行后等待命令链路落库中'
            }
          }
        } else {
          const latestRun = linkedRuns[0]
          executionRunId = latestRun.id || null
          executionRunStatus = normalizeShortText(latestRun.status, 64)
          executionRunCreatedAt = toIsoTimestamp(latestRun.created_at)
          executionState = mapRunStatusToExecutionState(latestRun.status)
          const linkMode = linkModeByMessageId.get(messageId)
          const modeHint = linkMode === 'sender_time' ? '（按 sender/time 推断）' : ''
          executionDetail = `已关联 ${executionRunCount} 条命令记录${modeHint}，最新状态 ${executionRunStatus || 'unknown'}`
        }
      }
    }

    return {
      id: Number(row.id),
      userId: Number(row.user_id),
      accountId: String(row.account_id || ''),
      messageId: row.message_id || null,
      chatId: row.chat_id || null,
      chatType: row.chat_type || null,
      messageType: row.message_type || null,
      senderPrimaryId: row.sender_primary_id || null,
      senderOpenId: row.sender_open_id || null,
      senderUnionId: row.sender_union_id || null,
      senderUserId: row.sender_user_id || null,
      senderCandidates,
      decision: row.decision,
      reasonCode: row.reason_code,
      reasonMessage: row.reason_message || null,
      messageText,
      messageExcerpt: toMessageExcerpt(messageText),
      messageTextLength: Number(row.message_text_length || (messageText ? messageText.length : 0)),
      metadata,
      messageReceivedAt: timing.messageReceivedAt,
      replyDispatchedAt: timing.replyDispatchedAt,
      executionState,
      executionRunId,
      executionRunStatus,
      executionRunCount,
      executionRunCreatedAt,
      executionDetail,
      workflowState,
      workflowProgress,
      workflowDetail,
      workflowOfferId,
      workflowSteps,
      ageSeconds,
      createdAt,
    }
  })

  const stats = statsRows.reduce(
    (acc, row) => {
      const count = Number(row.total || 0)
      if (!Number.isFinite(count) || count <= 0) {
        return acc
      }
      if (row.decision === 'allowed') {
        acc.allowed += count
      } else if (row.decision === 'blocked') {
        acc.blocked += count
      } else if (row.decision === 'error') {
        acc.error += count
      }
      return acc
    },
    { total: 0, allowed: 0, blocked: 0, error: 0 }
  )

  const syntheticRowsInWindow = rows.filter((row) => row.reason_code === 'command_run_created').length
  if (syntheticRowsInWindow > 0) {
    stats.allowed += syntheticRowsInWindow
  }
  stats.total = stats.allowed + stats.blocked + stats.error

  const executionStats = mapped.reduce(
    (acc, row) => {
      if (row.executionState === 'not_applicable') {
        acc.notApplicable += 1
        return acc
      }
      if (row.executionState === 'waiting') {
        acc.waiting += 1
        return acc
      }
      if (row.executionState === 'missing') {
        acc.missing += 1
        return acc
      }
      if (row.executionState === 'completed') {
        acc.linked += 1
        acc.completed += 1
        return acc
      }
      if (row.executionState === 'failed' || row.executionState === 'canceled' || row.executionState === 'expired') {
        acc.linked += 1
        acc.failed += 1
        return acc
      }
      if (row.executionState === 'pending_confirm' || row.executionState === 'queued' || row.executionState === 'running') {
        acc.linked += 1
        acc.inProgress += 1
        return acc
      }
      acc.unknown += 1
      return acc
    },
    {
      linked: 0,
      completed: 0,
      inProgress: 0,
      waiting: 0,
      missing: 0,
      failed: 0,
      notApplicable: 0,
      unknown: 0,
    }
  )

  const workflowStats = mapped.reduce(
    (acc, row) => {
      if (row.workflowState === 'not_required') {
        acc.notRequired += 1
        return acc
      }

      acc.tracked += 1
      if (row.workflowState === 'completed') {
        acc.completed += 1
        return acc
      }
      if (row.workflowState === 'running') {
        acc.running += 1
        return acc
      }
      if (row.workflowState === 'incomplete') {
        acc.incomplete += 1
        return acc
      }
      if (row.workflowState === 'failed') {
        acc.failed += 1
        return acc
      }
      acc.unknown += 1
      return acc
    },
    {
      tracked: 0,
      completed: 0,
      running: 0,
      incomplete: 0,
      failed: 0,
      notRequired: 0,
      unknown: 0,
    }
  )

  void cleanupFeishuChatHealthLogsIfNeeded().catch(() => {})

  return {
    rows: mapped,
    stats: {
      ...stats,
      execution: executionStats,
      workflow: workflowStats,
    },
  }
}

export const FEISHU_CHAT_HEALTH_RETENTION_DAYS = FEISHU_HEALTH_RETENTION_DAYS
export const FEISHU_CHAT_HEALTH_WINDOW_HOURS = FEISHU_HEALTH_RETENTION_HOURS
export const FEISHU_CHAT_HEALTH_EXCERPT_LIMIT = FEISHU_HEALTH_MESSAGE_EXCERPT_LIMIT
export const FEISHU_CHAT_HEALTH_EXECUTION_MISSING_SECONDS = FEISHU_HEALTH_EXECUTION_MISSING_SECONDS
