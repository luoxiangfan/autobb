/**
 * 使用 axios 调用 Gemini API
 *
 * 重要：
 * 1. API密钥从用户配置获取，不使用全局配置
 * 2. 不使用代理，直接访问Google API
 */

import { createHash } from 'crypto'
import { Resolver, lookup as systemLookup } from 'dns'
import { Agent as HttpsAgent } from 'https'
import axios, { AxiosInstance } from 'axios'
import { GEMINI_PROVIDERS, type GeminiProvider } from './gemini-config'
import { GEMINI_ACTIVE_MODEL, normalizeModelForProvider } from './gemini-models'
import { REDIS_PREFIX_CONFIG } from './config'
import { getRedisClient } from './redis-client'

interface DailyQuotaBreakerState {
  untilMs: number
  message: string
  quotaMetric?: string
}

const dailyQuotaBreakerMemory = new Map<string, DailyQuotaBreakerState>()
const DAILY_QUOTA_BREAKER_FALLBACK_MS = 12 * 60 * 60 * 1000
const RELAY_DEFAULT_DNS_SERVERS = ['1.1.1.1', '8.8.8.8']

function normalizeProvider(value?: string | null): GeminiProvider {
  if (value === 'relay' || value === 'official') {
    return value
  }

  return 'official'
}

function isEnvTrue(value?: string | null): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes'
}

function shouldLogFullGeminiResponse(): boolean {
  return isEnvTrue(process.env.GEMINI_LOG_FULL_RESPONSE)
}

function getRelayDnsServers(): string[] {
  const raw = process.env.GEMINI_RELAY_DNS_SERVERS
  if (raw === undefined) {
    return RELAY_DEFAULT_DNS_SERVERS
  }

  const normalized = raw.trim().toLowerCase()
  if (!normalized || normalized === 'off' || normalized === 'disable' || normalized === 'none') {
    return []
  }

  return raw
    .split(',')
    .map(server => server.trim())
    .filter(Boolean)
}

function createRelayHttpsAgent(endpointUrl: URL): HttpsAgent | undefined {
  const dnsServers = getRelayDnsServers()
  if (dnsServers.length === 0) {
    return undefined
  }

  const resolver = new Resolver()
  try {
    resolver.setServers(dnsServers)
  } catch (error) {
    console.warn(`⚠️ relay DNS fallback 初始化失败，跳过自定义解析: ${error}`)
    return undefined
  }

  const targetHostname = endpointUrl.hostname
  return new HttpsAgent({
    keepAlive: true,
    lookup: (hostname, options, callback) => {
      systemLookup(hostname, options as any, (lookupError: any, address: any, family: any) => {
        if (!lookupError) {
          callback(null, address, family)
          return
        }

        const code = String(lookupError?.code || '').toUpperCase()
        const allowFallback = hostname === targetHostname && (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
        if (!allowFallback) {
          callback(lookupError as Error, undefined as any, undefined as any)
          return
        }

        resolver.resolve4(hostname, (resolverError, addresses) => {
          if (!resolverError && Array.isArray(addresses) && addresses.length > 0) {
            const fallbackAddress = addresses[0]
            console.warn(`⚠️ relay DNS fallback 生效: ${hostname} -> ${fallbackAddress}`)
            const all = typeof options === 'object' && !!(options as any)?.all
            if (all) {
              callback(null, [{ address: fallbackAddress, family: 4 }] as any)
            } else {
              callback(null, fallbackAddress, 4)
            }
            return
          }

          callback(lookupError as Error, undefined as any, undefined as any)
        })
      })
    },
  })
}

function extractDnsTarget(message: string): string | null {
  const match = String(message).match(/\b(?:ENOTFOUND|EAI_AGAIN)\s+([^\s:]+)/i)
  return match?.[1] || null
}

function getDailyQuotaBreakerKey(
  userId: number,
  provider: GeminiProvider,
  model: string,
  apiKey: string
): string {
  const apiKeyFingerprint = createHash('sha1').update(apiKey).digest('hex').slice(0, 12)
  return `${REDIS_PREFIX_CONFIG.cache}gemini:daily-quota-breaker:user:${userId}:provider:${provider}:model:${model}:key:${apiKeyFingerprint}`
}

function parseDurationToMs(raw?: string | null): number | null {
  if (!raw) return null

  const trimmed = String(raw).trim()
  if (!trimmed) return null

  const simpleSecondsMatch = trimmed.match(/^(\d+(?:\.\d+)?)s$/i)
  if (simpleSecondsMatch) {
    const seconds = Number.parseFloat(simpleSecondsMatch[1])
    return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds * 1000)) : null
  }

  const partRegex = /(\d+(?:\.\d+)?)(h|m|s)/gi
  let totalMs = 0
  let matched = false
  let match: RegExpExecArray | null

  while ((match = partRegex.exec(trimmed)) !== null) {
    matched = true
    const value = Number.parseFloat(match[1])
    if (!Number.isFinite(value)) continue

    const unit = match[2].toLowerCase()
    if (unit === 'h') totalMs += value * 60 * 60 * 1000
    if (unit === 'm') totalMs += value * 60 * 1000
    if (unit === 's') totalMs += value * 1000
  }

  return matched ? Math.max(0, Math.ceil(totalMs)) : null
}

function extractErrorPayload(error: any): any {
  const data = error?.response?.data
  if (!data) return null
  if (typeof data === 'object') return data

  if (Buffer.isBuffer(data)) {
    try {
      return JSON.parse(data.toString('utf-8'))
    } catch {
      return null
    }
  }

  if (typeof data === 'string') {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  return null
}

function parseRetryDelayFromMessage(message: string): number | null {
  const match = message.match(/Please retry in\s+([^\n.]+(?:\.\d+)?s)\.?/i)
  return parseDurationToMs(match?.[1] || null)
}

function detectDailyQuotaExhaustion(error: any): {
  exhausted: boolean
  retryAfterMs: number | null
  message: string
  quotaMetric?: string
} {
  const status = Number(error?.response?.status || 0)
  const payload = extractErrorPayload(error)
  const errorDetails = payload?.error
  const message = String(errorDetails?.message || error?.message || '')
  const details = Array.isArray(errorDetails?.details) ? errorDetails.details : []

  const quotaFailure = details.find((detail: any) =>
    String(detail?.['@type'] || '').includes('QuotaFailure')
  )

  const violations = Array.isArray(quotaFailure?.violations)
    ? quotaFailure.violations
    : []

  const dailyViolation = violations.find((violation: any) => {
    const quotaMetric = String(violation?.quotaMetric || '').toLowerCase()
    const quotaId = String(violation?.quotaId || '').toLowerCase()
    return quotaMetric.includes('per_day')
      || quotaMetric.includes('per day')
      || quotaId.includes('perday')
      || quotaId.includes('per_day')
  })

  const lowerMessage = message.toLowerCase()
  const isDailyMessage = lowerMessage.includes('daily quota')
    || lowerMessage.includes('per day')
    || lowerMessage.includes('generate_requests_per_model_per_day')

  const retryInfo = details.find((detail: any) =>
    String(detail?.['@type'] || '').includes('RetryInfo')
  )

  const retryAfterMs = parseDurationToMs(retryInfo?.retryDelay)
    ?? parseRetryAfterMs(error?.response?.headers)
    ?? parseRetryDelayFromMessage(message)

  return {
    exhausted: status === 429 && Boolean(dailyViolation || isDailyMessage),
    retryAfterMs,
    message,
    quotaMetric: dailyViolation?.quotaMetric || dailyViolation?.quotaId,
  }
}

async function getActiveDailyQuotaBreaker(
  userId: number,
  provider: GeminiProvider,
  model: string,
  apiKey: string
): Promise<DailyQuotaBreakerState | null> {
  const key = getDailyQuotaBreakerKey(userId, provider, model, apiKey)
  const cached = dailyQuotaBreakerMemory.get(key)

  if (cached) {
    if (cached.untilMs > Date.now()) {
      return cached
    }
    dailyQuotaBreakerMemory.delete(key)
  }

  const redis = getRedisClient()
  if (!redis) return null

  const raw = await redis.get(key)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as DailyQuotaBreakerState
    if (parsed.untilMs > Date.now()) {
      dailyQuotaBreakerMemory.set(key, parsed)
      return parsed
    }
    await redis.del(key)
  } catch {
    await redis.del(key)
  }

  return null
}

async function openDailyQuotaBreaker(
  userId: number,
  provider: GeminiProvider,
  model: string,
  apiKey: string,
  state: DailyQuotaBreakerState
): Promise<void> {
  const key = getDailyQuotaBreakerKey(userId, provider, model, apiKey)
  dailyQuotaBreakerMemory.set(key, state)

  const redis = getRedisClient()
  if (!redis) return

  const ttlSeconds = Math.max(60, Math.ceil((state.untilMs - Date.now()) / 1000))
  await redis.set(key, JSON.stringify(state), 'EX', ttlSeconds)
}

function buildDailyQuotaBreakerError(state: DailyQuotaBreakerState): Error {
  const retryAt = new Date(state.untilMs).toISOString()
  const error = new Error(
    `Gemini API 每日配额已耗尽，已熔断至 ${retryAt}。${state.message}`
  )
  ;(error as any).code = 'GEMINI_DAILY_QUOTA_EXHAUSTED'
  ;(error as any).retryAfterMs = Math.max(0, state.untilMs - Date.now())
  return error
}

function parseRetryAfterMs(headers: any): number | null {
  if (!headers || typeof headers !== 'object') return null

  const retryAfterRaw = headers['retry-after'] ?? headers['Retry-After']
  if (retryAfterRaw === undefined || retryAfterRaw === null) return null

  const retryAfter = String(retryAfterRaw).trim()
  if (!retryAfter) return null

  const seconds = Number.parseInt(retryAfter, 10)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000
  }

  const retryAt = Date.parse(retryAfter)
  if (Number.isFinite(retryAt)) {
    return Math.max(0, retryAt - Date.now())
  }

  return null
}

function isInvalidArgumentError(error: any): boolean {
  const status = Number(error?.response?.status || 0)
  if (status !== 400) return false

  const payloadStatus = String(error?.response?.data?.error?.status || '').toUpperCase()
  if (payloadStatus === 'INVALID_ARGUMENT') return true

  const payloadMessage = String(error?.response?.data?.error?.message || '').toLowerCase()
  const message = String(error?.message || '').toLowerCase()
  return payloadMessage.includes('invalid argument') || message.includes('invalid argument')
}

function buildInvalidArgumentFallbackRequest(
  requestToSend: GeminiRequest,
  safeMaxOutputTokens: number
): { nextRequest: GeminiRequest; stage: 'clamp_tokens' | 'drop_thinking_config' | 'drop_schema' | 'drop_mime'; fromTokens?: number; toTokens?: number } | null {
  const generationConfig = { ...(requestToSend.generationConfig || {}) }
  const maxOutputTokens = Number(generationConfig.maxOutputTokens || 0)

  if (Number.isFinite(maxOutputTokens) && maxOutputTokens > safeMaxOutputTokens) {
    generationConfig.maxOutputTokens = safeMaxOutputTokens
    return {
      nextRequest: {
        ...requestToSend,
        generationConfig,
      },
      stage: 'clamp_tokens',
      fromTokens: maxOutputTokens,
      toTokens: safeMaxOutputTokens,
    }
  }

  if (generationConfig.thinkingConfig) {
    delete generationConfig.thinkingConfig
    return {
      nextRequest: {
        ...requestToSend,
        generationConfig,
      },
      stage: 'drop_thinking_config',
    }
  }

  if (generationConfig.responseSchema) {
    delete generationConfig.responseSchema
    return {
      nextRequest: {
        ...requestToSend,
        generationConfig,
      },
      stage: 'drop_schema',
    }
  }

  if (generationConfig.responseMimeType) {
    delete generationConfig.responseMimeType
    return {
      nextRequest: {
        ...requestToSend,
        generationConfig,
      },
      stage: 'drop_mime',
    }
  }

  return null
}

function shouldRetryGeminiError(
  error: any,
  provider: GeminiProvider
): { retryable: boolean; reason: string } {
  const status = Number(error?.response?.status || 0)
  const code = String(error?.code || '').toUpperCase()
  const message = String(error?.message || '')
  const lowerMessage = message.toLowerCase()

  const isNetworkTransient = [
    'ECONNABORTED',
    'ETIMEDOUT',
    'ECONNRESET',
    'EPIPE',
    'ECONNREFUSED',
    'ENETUNREACH',
    'EHOSTUNREACH',
  ].includes(code)

  if (isNetworkTransient) {
    return { retryable: true, reason: '网络波动' }
  }

  const hasRateLimitMessage =
    lowerMessage.includes('concurrency slot') ||
    lowerMessage.includes('resource_exhausted') ||
    lowerMessage.includes('resource exhausted') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('rate limit')
  if (status === 429 || hasRateLimitMessage) {
    return { retryable: true, reason: '限流/并发受限' }
  }

  const hasModelBusyMessage =
    lowerMessage.includes('high demand') ||
    lowerMessage.includes('overloaded') ||
    lowerMessage.includes('temporarily unavailable') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('try again later')
  if (status === 503 || hasModelBusyMessage) {
    return { retryable: true, reason: '模型繁忙/高负载' }
  }

  if (provider === 'relay' && [500, 502, 504].includes(status)) {
    return { retryable: true, reason: '中转上游暂时不可用' }
  }

  if (provider === 'official' && [500, 504].includes(status)) {
    return { retryable: true, reason: '官方服务暂时异常' }
  }

  return { retryable: false, reason: '' }
}

/**
 * Gemini API 请求接口
 */
export interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text: string
    }>
    role?: string
  }>
  generationConfig?: {
    temperature?: number
    topK?: number
    topP?: number
    maxOutputTokens?: number
    thinkingConfig?: {
      thinkingBudget?: number
    }
    responseMimeType?: string  // 🆕 Token优化：MIME类型
    responseSchema?: any  // 🆕 Token优化：JSON schema
  }
}

/**
 * Gemini API 响应接口
 */
export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string
      }>
      role: string
    }
    finishReason: string
  }>
  usageMetadata?: {
    promptTokenCount: number
    candidatesTokenCount: number
    totalTokenCount: number
    thoughtsTokenCount?: number
  }
}

/**
 * Gemini生成结果接口
 */
export interface GeminiAxiosGenerateResult {
  text: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  model: string
}

function extractCandidateText(candidate: GeminiResponse['candidates'][number]): string {
  const parts = candidate?.content?.parts
  if (!parts || parts.length === 0) return ''
  return parts
    .map(part => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
}

function detectRunawayStructuredOutput(
  usageMetadata?: GeminiResponse['usageMetadata'],
  partialText?: string
): boolean {
  const outputTokens = Number(usageMetadata?.candidatesTokenCount || 0)
  const outputLength = Number(partialText?.length || 0)

  if (outputTokens >= 20000) return true
  if (outputLength >= 100000) return true

  const tail = String(partialText || '').slice(-1500).toLowerCase()
  if (!tail) return false

  const repeatedPhrases = [
    'done and finished',
    'completed and concluded',
    'success and complete',
    'final and done',
  ]
  const repeatedHits = repeatedPhrases.reduce((count, phrase) => {
    return count + Math.max(0, tail.split(phrase).length - 1)
  }, 0)

  if (repeatedHits >= 3) return true

  // 生产故障样本：尾部出现长串重复数字/时间戳片段（如 1738770420-1200000000-...）
  // 这通常是结构化输出跑飞，不应继续扩大 maxOutputTokens。
  const longNumbers = tail.match(/\d{6,}/g) || []
  if (longNumbers.length >= 10) {
    const countMap = new Map<string, number>()
    let maxRepeat = 0
    for (const token of longNumbers) {
      const next = (countMap.get(token) || 0) + 1
      countMap.set(token, next)
      if (next > maxRepeat) maxRepeat = next
    }
    if (maxRepeat >= 6) return true
  }

  const repetitiveNumericChain = /(?:\d{6,}-){6,}\d{4,}/.test(tail)
  if (repetitiveNumericChain) return true

  return false
}

function logEmptyCandidate(response: GeminiResponse, candidate: GeminiResponse['candidates'][number]) {
  const candidateAny = candidate as any
  const responseAny = response as any
  const parts = candidateAny?.content?.parts

  console.error('   - finishReason:', candidateAny?.finishReason)
  if (candidateAny?.safetyRatings) {
    console.error('   - safetyRatings:', JSON.stringify(candidateAny.safetyRatings))
  }
  if (responseAny?.promptFeedback) {
    console.error('   - promptFeedback:', JSON.stringify(responseAny.promptFeedback))
  }
  console.error('   - content存在:', !!candidateAny?.content)
  console.error('   - parts存在:', !!parts)
  console.error('   - parts长度:', Array.isArray(parts) ? parts.length : 0)
  if (Array.isArray(parts)) {
    console.error('   - parts字段:', parts.map(part => Object.keys(part || {})))
  }
  const responsePreview = JSON.stringify(responseAny, null, 2)
  console.error(`   - 响应片段: ${responsePreview.substring(0, 800)}`)
}

function extractTextFromOpenAIMessageContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item: any) => {
        if (typeof item === 'string') return item
        if (item?.type === 'text' && typeof item?.text === 'string') return item.text
        return ''
      })
      .join('')
  }

  return ''
}

function extractUsage(usage: any): GeminiAxiosGenerateResult['usage'] {
  if (!usage) return undefined

  const readFirstNumeric = (keys: string[]): number | undefined => {
    for (const key of keys) {
      const raw = usage?.[key]
      if (raw === undefined || raw === null) continue
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
    return undefined
  }

  const inputTokens = readFirstNumeric([
    'input_tokens',
    'prompt_tokens',
    'inputTokens',
    'promptTokens',
    'promptTokenCount',
    'inputTokenCount',
  ]) ?? 0

  const outputTokens = readFirstNumeric([
    'output_tokens',
    'completion_tokens',
    'outputTokens',
    'completionTokens',
    'candidatesTokenCount',
    'outputTokenCount',
  ]) ?? 0

  const totalTokens = readFirstNumeric([
    'total_tokens',
    'totalTokens',
    'totalTokenCount',
  ]) ?? (inputTokens + outputTokens)

  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return undefined
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  }
}

function isRelayGptModel(model: string): boolean {
  return /^gpt-/i.test(model)
}

function extractTextFromResponsesOutput(output: unknown): string {
  if (!Array.isArray(output)) return ''

  return output
    .map((item: any) => {
      if (!Array.isArray(item?.content)) return ''
      return item.content
        .map((part: any) => {
          if (typeof part === 'string') return part
          if (part?.type === 'output_text' && typeof part?.text === 'string') return part.text
          if (part?.type === 'text' && typeof part?.text === 'string') return part.text
          return ''
        })
        .join('')
    })
    .join('')
}

function parseRelayResponsesObject(
  responseData: any,
  fallbackModel: string,
  streamedText: string = ''
): GeminiAxiosGenerateResult {
  const root = responseData?.response && typeof responseData.response === 'object'
    ? responseData.response
    : responseData

  const outputText = typeof root?.output_text === 'string'
    ? root.output_text
    : ''
  const outputArrayText = extractTextFromResponsesOutput(root?.output)
  const text = outputText || outputArrayText || streamedText

  if (!text) {
    console.error('❌ Relay /v1/responses 响应异常: 无法解析文本内容')
    console.error('   - 完整响应:', JSON.stringify(responseData, null, 2))
    throw new Error('Relay /v1/responses 返回了空响应（无法解析文本）')
  }

  return {
    text,
    usage: extractUsage(root?.usage ?? root?.usageMetadata),
    model: root?.model || fallbackModel,
  }
}

function parseRelayResponsesSSE(rawSse: string, fallbackModel: string): GeminiAxiosGenerateResult {
  let deltaText = ''
  let doneText = ''
  let completedPayload: any = null
  let latestModel = fallbackModel
  let latestUsage: GeminiAxiosGenerateResult['usage']

  for (const rawLine of rawSse.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue

    const payload = line.slice(5).trim()
    if (!payload || payload === '[DONE]') continue

    let parsed: any
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }

    const usageCandidate = extractUsage(
      parsed?.response?.usage
      ?? parsed?.usage
      ?? parsed?.response?.usageMetadata
      ?? parsed?.usageMetadata
    )
    if (usageCandidate) {
      latestUsage = usageCandidate
    }

    const modelCandidate = parsed?.response?.model
    if (typeof modelCandidate === 'string' && modelCandidate.trim()) {
      latestModel = modelCandidate
    }

    if (parsed?.type === 'response.output_text.delta' && typeof parsed?.delta === 'string') {
      deltaText += parsed.delta
    }

    if (parsed?.type === 'response.output_text.done' && typeof parsed?.text === 'string') {
      doneText = parsed.text
    }

    if (parsed?.type === 'response.completed' || parsed?.type === 'response.done') {
      completedPayload = parsed?.response ?? parsed
    }
  }

  if (completedPayload) {
    return parseRelayResponsesObject(completedPayload, latestModel, doneText || deltaText)
  }

  const text = doneText || deltaText
  if (!text) {
    console.error('❌ Relay /v1/responses SSE响应异常: 未找到可用文本')
    console.error('   - 响应片段:', rawSse.slice(0, 1200))
    throw new Error('Relay /v1/responses 返回了空响应（SSE）')
  }

  return {
    text,
    usage: latestUsage,
    model: latestModel,
  }
}

function parseRelayResponsesResponse(responseData: any, fallbackModel: string): GeminiAxiosGenerateResult {
  if (typeof responseData === 'string') {
    const trimmed = responseData.trim()
    if (!trimmed) {
      throw new Error('Relay /v1/responses 返回了空响应')
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return parseRelayResponsesObject(JSON.parse(trimmed), fallbackModel)
      } catch {
        // ignore parse failure and fall through to SSE parser
      }
    }

    return parseRelayResponsesSSE(responseData, fallbackModel)
  }

  if (responseData && typeof responseData === 'object') {
    return parseRelayResponsesObject(responseData, fallbackModel)
  }

  throw new Error('Relay /v1/responses 返回了无法识别的响应格式')
}

function parseRelayResponse(
  responseData: any,
  fallbackModel: string
): GeminiAxiosGenerateResult {
  // Anthropic-compatible messages API: content=[{type:"text",text:"..."}]
  const anthropicText = Array.isArray(responseData?.content)
    ? responseData.content
        .map((item: any) => (item?.type === 'text' && typeof item?.text === 'string' ? item.text : ''))
        .join('')
    : (typeof responseData?.content === 'string' ? responseData.content : '')

  // OpenAI-compatible fallback: choices[0].message.content
  const openAIText = extractTextFromOpenAIMessageContent(
    responseData?.choices?.[0]?.message?.content
  )

  // Generic fallback fields
  const genericText = typeof responseData?.output_text === 'string'
    ? responseData.output_text
    : (typeof responseData?.text === 'string' ? responseData.text : '')

  const text = anthropicText || openAIText || genericText
  if (!text) {
    console.error('❌ Relay API响应异常: 无法解析文本内容')
    console.error('   - 完整响应:', JSON.stringify(responseData, null, 2))
    throw new Error('Relay API 返回了空响应（无法解析文本）')
  }

  return {
    text,
    usage: extractUsage(responseData?.usage ?? responseData?.usageMetadata),
    model: responseData?.model || fallbackModel,
  }
}

/**
 * 根据用户配置获取对应的 Gemini API Key
 *
 * @param userId - 用户ID
 * @param provider - 服务商类型
 * @returns API Key
 */
async function getGeminiApiKey(userId: number, provider: GeminiProvider): Promise<string> {
  const { getUserOnlySetting } = await import('./settings')

  // 根据服务商选择对应的字段
  const keyField = provider === 'relay' ? 'gemini_relay_api_key' : 'gemini_api_key'

  const setting = await getUserOnlySetting('ai', keyField, userId)

  if (!setting?.value) {
    throw new Error(
      `用户(ID=${userId})未配置 ${GEMINI_PROVIDERS[provider].name} 的 API 密钥。` +
      `请在设置页面配置。`
    )
  }

  return setting.value
}

/**
 * 根据用户配置获取 Gemini 端点
 *
 * 🔧 关键修复(2025-12-30): 使用 getSetting() 正确处理配置字段
 *
 * @param userId - 用户ID
 * @returns Gemini API 端点 URL
 */
async function getGeminiEndpoint(userId: number): Promise<string> {
  const provider = await getGeminiProvider(userId)
  return getEndpointByProvider(provider)
}

/**
 * 根据服务商类型获取端点 URL（纯函数）
 */
export function getEndpointByProvider(provider: GeminiProvider): string {
  return GEMINI_PROVIDERS[provider].endpoint
}

/**
 * 创建 axios 实例用于 Gemini API
 *
 * 🔧 2025-12-29 更新：支持动态端点
 * - 根据用户配置自动选择官方或中转端点
 * - 直连访问，不使用代理
 *
 * 超时设置：
 * - 180秒（3分钟）
 * - 原因：平衡可靠性与响应时间
 *
 * 🔧 2025-12-31 修复：
 * - relay 服务商使用 Cloudflare 防护，需要浏览器特征 headers 绕过检测
 * - official 服务商不需要这些 headers（官方API不使用Cloudflare）
 */
export async function createGeminiAxiosClient(userId: number, provider?: GeminiProvider): Promise<AxiosInstance> {
  const geminiProvider = provider || await getGeminiProvider(userId)
  const endpoint = getEndpointByProvider(geminiProvider)
  const endpointUrl = new URL(endpoint)

  // 🔧 2025-12-31 修复：relay 服务商需要浏览器特征 headers 绕过 Cloudflare
  // ThunderRelay 使用 Cloudflare 防护，服务器请求需要模拟浏览器行为
  const isRelayProvider = geminiProvider === 'relay'

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  }

  // 🔧 relay 服务商需要额外的浏览器特征 headers 绕过 Cloudflare
  if (isRelayProvider) {
    const relayOrigin = `${endpointUrl.protocol}//${endpointUrl.host}`
    headers['Origin'] = relayOrigin
    headers['Referer'] = `${relayOrigin}/`
    headers['sec-fetch-dest'] = 'empty'
    headers['sec-fetch-mode'] = 'cors'
    headers['sec-fetch-site'] = 'same-origin'
    headers['anthropic-version'] = '2023-06-01'
  }

  const relayHttpsAgent = isRelayProvider ? createRelayHttpsAgent(endpointUrl) : undefined

  return axios.create({
    baseURL: endpoint, // 动态端点
    timeout: 300000, // 300 秒（5分钟）- 适配 Gemini 3 thinking 模式
    headers,
    ...(relayHttpsAgent ? { httpsAgent: relayHttpsAgent } : {}),
  })
}

/**
 * 获取用户配置的服务商类型
 *
 * 🔧 关键修复(2025-12-30): 使用 getSetting() 正确处理配置字段
 */
async function getGeminiProvider(userId: number): Promise<GeminiProvider> {
  const { getUserOnlySetting } = await import('./settings')
  const setting = await getUserOnlySetting('ai', 'gemini_provider', userId)

  return normalizeProvider(setting?.value)
}

/**
 * 调用 Gemini API 生成内容（不做自动降级）
 *
 * 不自动切换模型，错误直接抛出
 * 直接访问Google API，不使用代理
 *
 * 重要：API密钥从用户配置获取，不使用全局配置
 *
 * @param params - 生成参数
 * @param params.model - 模型名称，默认 'gemini-3-flash-preview'
 * @param params.prompt - 提示词
 * @param params.temperature - 温度参数，默认 0.7
 * @param params.maxOutputTokens - 最大输出tokens，默认 8192
 * @param userId - 用户ID（必需，用于获取用户的API密钥）
 * @param overrideConfig - 临时配置覆盖（可选，用于验证未保存的配置）
 * @param overrideConfig.provider - 服务商类型（'official' | 'relay'）
 * @param overrideConfig.apiKey - API密钥
 * @returns 生成的文本内容
 */
export async function generateContent(params: {
  model?: string
  prompt: string
  temperature?: number
  maxOutputTokens?: number
  thinkingBudget?: number
  timeoutMs?: number
  responseSchema?: any  // 🆕 Token优化：JSON schema
  responseMimeType?: string  // 🆕 Token优化：MIME类型
}, userId: number, overrideConfig?: { provider: string; apiKey: string }): Promise<GeminiAxiosGenerateResult> {
  const {
    model: requestedModel = GEMINI_ACTIVE_MODEL,
    prompt,
    temperature = 0.7,
    maxOutputTokens = 8192,
    thinkingBudget,
    timeoutMs,
    responseSchema,  // 🆕 Token优化：JSON schema
    responseMimeType,  // 🆕 Token优化：MIME类型
  } = params

  // 🔧 关键修复(2025-12-30): 支持临时配置覆盖（用于验证未保存的配置）
  // 根据用户配置获取服务商类型和对应的 API Key
  const provider = overrideConfig ? overrideConfig.provider as GeminiProvider : await getGeminiProvider(userId)
  const apiKey = overrideConfig ? overrideConfig.apiKey : await getGeminiApiKey(userId, provider)
  const model = normalizeModelForProvider(requestedModel, provider)
  if (requestedModel && requestedModel !== model) {
    console.warn(`⚠️ 服务商 ${provider} 不支持模型 ${requestedModel}，自动切换为 ${model}`)
  }
  console.log(`🌐 使用 ${GEMINI_PROVIDERS[provider].name} 服务商${overrideConfig ? '（临时配置）' : ''}`)

  const activeBreaker = await getActiveDailyQuotaBreaker(userId, provider, model, apiKey)
  if (activeBreaker) {
    throw buildDailyQuotaBreakerError(activeBreaker)
  }

  // 🔧 2025-12-31 修复：传递 provider 参数以确保正确设置 headers（relay 需要 Cloudflare 绕过 headers）
  const client = await createGeminiAxiosClient(userId, provider)

  // 构建请求
  // 构建generationConfig（根据是否有responseSchema）
  const generationConfig: any = {
    temperature,
    maxOutputTokens,
  }
  const normalizedThinkingBudget = Number.isFinite(Number(thinkingBudget))
    ? Math.max(0, Math.floor(Number(thinkingBudget)))
    : undefined

  // 🔧 2026-02-01: 恢复 Gemini 3 thinking 模式
  // 结构化任务可通过 thinkingBudget=0 关闭 thinking，避免抢占输出 token 配额
  if (model.includes('gemini-3')) {
    if (normalizedThinkingBudget !== undefined) {
      generationConfig.thinkingConfig = { thinkingBudget: normalizedThinkingBudget }
      if (normalizedThinkingBudget === 0) {
        console.log(`🧠 Gemini 3 thinking 已关闭 (模型: ${model})`)
      } else {
        console.log(`🧠 Gemini 3 thinkingBudget=${normalizedThinkingBudget} (模型: ${model})`)
      }
    } else {
      console.log(`🧠 Gemini 3 模型使用默认 thinking 模式 (模型: ${model})`)
    }
  }

  // 🆕 Token优化：结构化JSON输出约束
  if (responseSchema) {
    generationConfig.responseMimeType = responseMimeType || 'application/json'
    generationConfig.responseSchema = responseSchema
    if (provider === 'relay') {
      console.log(`📋 已请求JSON schema约束（relay链路可能忽略）`)
    } else {
      console.log(`📋 Gemini API使用JSON schema约束`)
    }
  }

  const request: GeminiRequest = {
    contents: [
      {
        parts: [{ text: prompt }],
        role: 'user',
      },
    ],
    generationConfig,
  }

  // 尝试使用主模型
  try {
    console.log(`🤖 调用 Gemini API: ${model}`)
    console.log(`   - Prompt长度: ${prompt.length} 字符`)
    console.log(`   - maxOutputTokens: ${maxOutputTokens}`)
    if (timeoutMs) {
      console.log(`   - timeout: ${timeoutMs}ms`)
    }
    console.log(`   - temperature: ${temperature}`)

    // 服务商鉴权方式：
    // - 官方API: query参数 ?key=xxx
    // - 第三方中转: header x-api-key: xxx
    const timeoutConfig = timeoutMs ? { timeout: timeoutMs } : {}
    const relayRequestConfig = {
      headers: {
        'x-api-key': apiKey,
      },
      ...timeoutConfig,
    }
    const officialRequestConfig = {
      params: {
        key: apiKey,
      },
      ...timeoutConfig,
    }
    const requestConfig = provider === 'relay' ? relayRequestConfig : officialRequestConfig

    // 🔧 2026-02-01: 提高上限到65536（Gemini 3 Flash Preview 支持的最大值）
    // 原问题：gemini-3-flash-preview 可能生成36k+ tokens，超过原来的49152上限
    const MAX_OUTPUT_TOKENS_CAP = 65536
    const MAX_TOKENS_RETRY_BUMP = 16384  // 更大的增量，减少重试次数
    const MAX_TOKENS_RETRY_BUFFER = 4096
    const INVALID_ARGUMENT_SAFE_MAX_OUTPUT_TOKENS = 8192
    const INVALID_ARGUMENT_MAX_FALLBACK_ATTEMPTS = 3

    const runRequest = async (overrideMaxOutputTokens?: number): Promise<GeminiAxiosGenerateResult> => {
      const effectiveMaxOutputTokens = overrideMaxOutputTokens ?? maxOutputTokens

      if (overrideMaxOutputTokens) {
        console.warn(`🔄 MAX_TOKENS重试: maxOutputTokens=${effectiveMaxOutputTokens}`)
      }

      if (provider === 'relay') {
        const useResponsesApi = isRelayGptModel(model)

        const runRelayMessages = async (
          relayModel: string,
          fallbackReason?: string
        ): Promise<GeminiAxiosGenerateResult> => {
          if (fallbackReason) {
            console.warn(
              `↪️ Relay 自动降级到 /v1/messages: model=${relayModel}, reason=${fallbackReason}`
            )
          }

          const relayPayload = {
            model: relayModel,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            max_tokens: effectiveMaxOutputTokens,
            temperature,
          }

          const relayResponse = await client.post<any>(
            '',
            relayPayload,
            relayRequestConfig
          )

          const parsedRelay = parseRelayResponse(relayResponse.data, relayModel)
          console.log(
            `✓ Relay /v1/messages 调用成功，返回 ${parsedRelay.text.length} 字符 (model=${parsedRelay.model})`
          )
          return parsedRelay
        }

        if (responseSchema) {
          const route = useResponsesApi ? '/v1/responses' : '/v1/messages'
          console.warn(`⚠️ relay ${route} 暂不支持 responseSchema 强约束，将使用普通文本生成`)
        }

        if (useResponsesApi) {
          const relayResponsesEndpoint = getEndpointByProvider('relay').replace(/\/messages\/?$/, '/responses')
          const relayPayload = {
            model,
            input: [
              {
                role: 'user',
                content: [
                  {
                    type: 'input_text',
                    text: prompt,
                  },
                ],
              },
            ],
            max_output_tokens: effectiveMaxOutputTokens,
            temperature,
            stream: true,
          }

          try {
            const relayResponse = await client.post<string>(
              relayResponsesEndpoint,
              relayPayload,
              {
                ...relayRequestConfig,
                responseType: 'text',
                headers: {
                  ...relayRequestConfig.headers,
                  Accept: 'text/event-stream, application/json',
                },
              }
            )

            const parsedRelay = parseRelayResponsesResponse(relayResponse.data, model)
            console.log(`✓ Relay /v1/responses 调用成功，返回 ${parsedRelay.text.length} 字符`)
            return parsedRelay
          } catch (relayResponsesError: any) {
            const status = Number(relayResponsesError?.response?.status || 0)
            if (status === 400) {
              console.warn(
                `⚠️ Relay /v1/responses 返回 400，gpt 模型请求降级为 Gemini: ${relayResponsesError?.message || 'unknown error'}`
              )
              return await runRelayMessages(
                normalizeModelForProvider(GEMINI_ACTIVE_MODEL, 'relay'),
                'relay_responses_http_400'
              )
            }
            throw relayResponsesError
          }
        }

        return await runRelayMessages(model)
      }

      let requestToSend: GeminiRequest = overrideMaxOutputTokens
        ? {
            ...request,
            generationConfig: {
              ...generationConfig,
              maxOutputTokens: effectiveMaxOutputTokens,
            },
          }
        : request

      let response: { data: GeminiResponse } | null = null
      for (let invalidArgAttempt = 0; invalidArgAttempt <= INVALID_ARGUMENT_MAX_FALLBACK_ATTEMPTS; invalidArgAttempt++) {
        try {
          response = await client.post<GeminiResponse>(
            `/v1beta/models/${model}:generateContent`,
            requestToSend,
            requestConfig
          )
          break
        } catch (error: any) {
          if (!isInvalidArgumentError(error)) {
            throw error
          }

          const fallbackDecision = buildInvalidArgumentFallbackRequest(
            requestToSend,
            INVALID_ARGUMENT_SAFE_MAX_OUTPUT_TOKENS
          )
          if (!fallbackDecision || invalidArgAttempt >= INVALID_ARGUMENT_MAX_FALLBACK_ATTEMPTS) {
            throw error
          }

          if (fallbackDecision.stage === 'clamp_tokens') {
            console.warn(
              `⚠️ Gemini API INVALID_ARGUMENT，自动降级 maxOutputTokens: ` +
              `${fallbackDecision.fromTokens} → ${fallbackDecision.toTokens}`
            )
          } else if (fallbackDecision.stage === 'drop_thinking_config') {
            console.warn('⚠️ Gemini API INVALID_ARGUMENT，自动移除 thinkingConfig 后重试')
          } else if (fallbackDecision.stage === 'drop_schema') {
            console.warn('⚠️ Gemini API INVALID_ARGUMENT，自动移除 responseSchema 后重试')
          } else {
            console.warn('⚠️ Gemini API INVALID_ARGUMENT，自动移除 responseMimeType 后重试')
          }

          requestToSend = fallbackDecision.nextRequest
        }
      }

      if (!response) {
        throw new Error('Gemini API 调用失败：未获得有效响应')
      }

      // 检查响应基本结构
      if (!response.data.candidates || response.data.candidates.length === 0) {
        console.error('❌ Gemini API响应异常: 没有candidates')
        console.error('   - 完整响应:', JSON.stringify(response.data, null, 2))
        throw new Error('Gemini API 返回了空响应（没有candidates）')
      }

      const candidate = response.data.candidates[0]

      // 🔧 修复(2025-12-11): 检查finishReason，如果是MAX_TOKENS，说明输出被截断
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        console.warn(`⚠️ Gemini API finishReason: ${candidate.finishReason}`)
        if (candidate.finishReason === 'MAX_TOKENS') {
          console.error('❌ Gemini API输出达到token限制被截断')
          console.error('   - finishReason:', candidate.finishReason)
          console.error('   - usageMetadata:', response.data.usageMetadata)
          const partialText = extractCandidateText(candidate)
          if (partialText) {
            const head = partialText.substring(0, 1024)
            const tail = partialText.substring(Math.max(0, partialText.length - 1024))
            console.error(`   - 输出预览(前1KB): ${head}`)
            console.error(`   - 输出预览(后1KB): ${tail}`)
            console.error(`   - 输出长度: ${partialText.length} 字符`)
          } else {
            console.error('   - 输出预览: 空文本')
          }
          if (shouldLogFullGeminiResponse()) {
            console.error('   - Prompt完整内容开始 >>>')
            console.error(prompt)
            console.error('   - Prompt完整内容结束 <<<')
          } else {
            console.error('   - Prompt完整内容已省略 (设置 GEMINI_LOG_FULL_RESPONSE=true 开启)')
          }

          const usage = response.data.usageMetadata
          const thoughtsTokenCount = usage?.thoughtsTokenCount || 0
          const candidatesTokenCount = usage?.candidatesTokenCount || 0
          const isRunawayCandidate = detectRunawayStructuredOutput(usage, partialText)
          // Use actual output token usage as a floor for the retry to avoid under-bumping.
          const minRetryFromUsage = candidatesTokenCount > 0
            ? candidatesTokenCount + MAX_TOKENS_RETRY_BUFFER
            : 0
          const minRetryFromThoughts = thoughtsTokenCount > 0
            ? thoughtsTokenCount + MAX_TOKENS_RETRY_BUFFER
            : 0
          const retryMaxOutputTokens = Math.min(
            MAX_OUTPUT_TOKENS_CAP,
            Math.max(
              effectiveMaxOutputTokens + MAX_TOKENS_RETRY_BUMP,
              minRetryFromThoughts,
              minRetryFromUsage
            )
          )

          if (isRunawayCandidate) {
            console.warn('   - 检测到结构化输出跑飞，跳过maxOutputTokens自动放大重试')
          }

          if (!isRunawayCandidate && !overrideMaxOutputTokens && retryMaxOutputTokens > effectiveMaxOutputTokens) {
            console.warn(`   - 自动提升maxOutputTokens: ${effectiveMaxOutputTokens} → ${retryMaxOutputTokens}`)
            return await runRequest(retryMaxOutputTokens)
          }

          const maxTokensError: any = new Error('Gemini API 输出达到token限制被截断。请增加maxOutputTokens参数。')
          maxTokensError.code = 'MAX_TOKENS'
          maxTokensError.retryMaxOutputTokens = retryMaxOutputTokens
          maxTokensError.finishReason = candidate.finishReason
          maxTokensError.usageMetadata = response.data.usageMetadata
          maxTokensError.partialTextLength = partialText?.length || 0
          maxTokensError.isRunawayCandidate = isRunawayCandidate
          throw maxTokensError
        }
        if ((candidate as any).safetyRatings) {
          console.warn('   - safetyRatings:', JSON.stringify((candidate as any).safetyRatings))
        }
      }

      // 提取响应文本
      const text = extractCandidateText(candidate)
      if (!text) {
        console.error('❌ Gemini API响应异常: content.parts为空', { finishReason: candidate.finishReason })
        logEmptyCandidate(response.data, candidate)
        throw new Error('Gemini API 返回了空响应（content.parts为空）')
      }
      console.log(`✓ Gemini API 调用成功，返回 ${text.length} 字符`)

      // 🔧 调试(2026-01-31): 记录响应内容详情，排查输出过大问题
      const usage = response.data.usageMetadata
      const thoughtsTokenCount = usage?.thoughtsTokenCount || 0
      const candidatesTokenCount = usage?.candidatesTokenCount || 0
      const charsPerToken = candidatesTokenCount > 0 ? (text.length / candidatesTokenCount).toFixed(2) : 'N/A'
      console.log(`📊 响应分析:`)
      console.log(`   - 文本长度: ${text.length} 字符`)
      console.log(`   - 输出tokens: ${candidatesTokenCount} (含thinking: ${thoughtsTokenCount})`)
      console.log(`   - 字符/token比: ${charsPerToken}`)
      // 如果输出异常大（超过10k tokens），记录更多信息
      if (candidatesTokenCount > 10000) {
        console.warn(`⚠️ 输出异常大! 预期约1000 tokens，实际 ${candidatesTokenCount} tokens`)
        console.log(`   - 响应前500字符: ${text.substring(0, 500)}`)
        console.log(`   - 响应后500字符: ${text.substring(text.length - 500)}`)
        if (shouldLogFullGeminiResponse()) {
          console.log('   - 响应完整内容开始 >>>')
          console.log(text)
          console.log('   - 响应完整内容结束 <<<')
          console.log('   - Prompt完整内容开始 >>>')
          console.log(prompt)
          console.log('   - Prompt完整内容结束 <<<')
        } else {
          console.log('   - 响应完整内容已省略 (设置 GEMINI_LOG_FULL_RESPONSE=true 开启)')
        }
      }

      // 记录token使用情况
      let usageResult: GeminiAxiosGenerateResult['usage']
      if (response.data.usageMetadata) {
        usageResult = {
          inputTokens: response.data.usageMetadata.promptTokenCount || 0,
          outputTokens: response.data.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.data.usageMetadata.totalTokenCount || 0
        }
        console.log(`   Token使用: prompt=${usageResult.inputTokens}, ` +
          `output=${usageResult.outputTokens}, ` +
          `total=${usageResult.totalTokens}`)
      }

      return {
        text,
        usage: usageResult,
        model
      }
    }

    const maxTransientRetries = 5
    for (let attempt = 1; attempt <= maxTransientRetries; attempt++) {
      try {
        return await runRequest()
      } catch (error: any) {
        if (error?.code === 'MAX_TOKENS') {
          throw error
        }

        const dailyQuota = detectDailyQuotaExhaustion(error)
        if (dailyQuota.exhausted) {
          const breakerState: DailyQuotaBreakerState = {
            untilMs: Date.now() + Math.max(
              dailyQuota.retryAfterMs || DAILY_QUOTA_BREAKER_FALLBACK_MS,
              60_000
            ),
            message: dailyQuota.message,
            quotaMetric: dailyQuota.quotaMetric,
          }
          await openDailyQuotaBreaker(userId, provider, model, apiKey, breakerState)
          console.warn(
            `⛔ Gemini API日配额已耗尽，已熔断至 ${new Date(breakerState.untilMs).toISOString()}` +
            `${breakerState.quotaMetric ? ` (${breakerState.quotaMetric})` : ''}`
          )
          throw buildDailyQuotaBreakerError(breakerState)
        }

        const status = Number(error?.response?.status || 0)
        const retryAfterMs = parseRetryAfterMs(error?.response?.headers)
        const retryDecision = shouldRetryGeminiError(error, provider)

        if (retryDecision.retryable && attempt < maxTransientRetries) {
          const baseDelayMs = 2000 * Math.pow(2, attempt - 1)
          const jitterMs = Math.floor(Math.random() * 1000)
          const adaptiveDelayMs = retryAfterMs !== null
            ? Math.max(baseDelayMs + jitterMs, retryAfterMs)
            : (baseDelayMs + jitterMs)
          const delayMs = Math.min(adaptiveDelayMs, 30000)
          const statusLabel = status ? `HTTP ${status}` : '网络错误'
          console.warn(
            `⚠️ Gemini API${retryDecision.reason}(${statusLabel})，` +
            `${(delayMs / 1000).toFixed(1)}s 后重试 (${attempt}/${maxTransientRetries})`
          )
          await new Promise(resolve => setTimeout(resolve, delayMs))
          continue
        }

        throw error
      }
    }

    throw new Error('Gemini API调用失败: 超过最大重试次数')
  } catch (error: any) {
    // 🔧 修复(2025-12-11): 对所有错误打印详细信息
    console.error(`❌ Gemini API调用失败:`)
    console.error(`   - HTTP状态: ${error.response?.status}`)
    console.error(`   - 错误消息: ${error.message}`)

    // 🔧 修复(2025-12-30): 正确处理可能是Buffer或压缩数据的错误响应
    if (error.response?.data) {
      try {
        // 如果是Buffer，转换为字符串
        let dataStr = error.response.data
        if (Buffer.isBuffer(dataStr)) {
          dataStr = dataStr.toString('utf-8')
        }
        // 如果是对象，序列化为JSON
        if (typeof dataStr === 'object') {
          dataStr = JSON.stringify(dataStr, null, 2)
        }
        // 限制输出长度，避免日志过长
        const maxLength = 500
        if (dataStr.length > maxLength) {
          console.error(`   - 响应数据（前${maxLength}字符）: ${dataStr.substring(0, maxLength)}...`)
        } else {
          console.error(`   - 响应数据: ${dataStr}`)
        }
      } catch (parseError) {
        console.error(`   - 响应数据解析失败:`, parseError)
      }
    }

    if (error.response?.status === 401) {
      throw new Error('API Key 无效或已过期，请检查后重试')
    }

    const networkCode = String(error?.code || '').toUpperCase()
    const networkMessage = String(error?.message || '')
    const dnsFailure = networkCode === 'ENOTFOUND'
      || networkCode === 'EAI_AGAIN'
      || /\bENOTFOUND\b/i.test(networkMessage)
      || /\bEAI_AGAIN\b/i.test(networkMessage)
    if (dnsFailure) {
      const failedHost = extractDnsTarget(networkMessage)
      const hostLabel = failedHost ? ` (${failedHost})` : ''
      throw new Error(
        `Gemini API调用失败: DNS解析失败${hostLabel}。` +
        `请检查服务器DNS配置后重试。`
      )
    }

    // 透传 MAX_TOKENS 元信息，供上层判断是否走 simplified/emergency retry。
    if (error?.code === 'MAX_TOKENS') {
      throw error
    }

    if (error?.code === 'GEMINI_DAILY_QUOTA_EXHAUSTED') {
      throw error
    }

    // 🔧 修复(2025-12-30): 针对403错误给出更明确的提示
    if (error.response?.status === 403) {
      const providerName = GEMINI_PROVIDERS[provider]?.name || '当前服务商'
      throw new Error(
        `Gemini API调用失败: 403 Forbidden\n` +
        `\n` +
        `可能的原因：\n` +
        `1. API Key无效或过期（${providerName}）\n` +
        `2. ${providerName === '第三方中转' ? '中转服务的' : ''}API Key权限不足\n` +
        `3. ${providerName === '第三方中转' ? '中转服务的Cloudflare防护拦截了请求\n' : 'IP地址被限制\n'}` +
        `\n` +
        `请检查：\n` +
        `- API Key是否正确配置\n` +
        `- API Key是否仍然有效\n` +
        `- ${providerName === '第三方中转' ? '中转服务账户是否有足够余额\n' : '账户是否处于正常状态\n'}` +
        `\n` +
        `原始错误: ${error.message}`
      )
    }

    if (error.response?.status === 502 && provider === 'relay') {
      throw new Error(
        '第三方中转上游请求失败（502）。请稍后重试，或在中转平台确认模型权限/余额状态。'
      )
    }

    // 🔧 新增(2025-12-30): 针对402错误（余额不足）给出明确提示
    if (error.response?.status === 402) {
      const providerName = GEMINI_PROVIDERS[provider]?.name || '当前服务商'
      const errorData = error.response?.data
      const balance = errorData?.billing?.balance ?? 0
      const message = errorData?.message || '账户余额不足'
      const errorCode = errorData?.error

      // 🔧 新增(2025-12-30): 处理BILLING_BINDING_MISSING错误
      if (errorCode === 'BILLING_BINDING_MISSING') {
        throw new Error(
          `Gemini API调用失败: 需要绑定专属账户\n` +
          `\n` +
          `${providerName}配置问题：\n` +
          `- 错误代码: BILLING_BINDING_MISSING\n` +
          `- 服务消息: ${message}\n` +
          `- 计费模式: ${errorData?.billing?.mode || 'payg'} (按量付费)\n` +
          `\n` +
          `解决方案：\n` +
          `1. 登录中转服务平台 (https://aicode.cat)\n` +
          `2. 前往账户设置，绑定Gemini专属账户\n` +
          `3. 或联系服务商管理员配置账户绑定\n` +
          `4. 配置完成后重新验证API Key\n`
        )
      }

      // 余额不足错误
      throw new Error(
        `Gemini API调用失败: 402 Payment Required\n` +
        `\n` +
        `${providerName}账户余额不足：\n` +
        `- 当前余额: ${balance} 积分\n` +
        `- 服务消息: ${message}\n` +
        `\n` +
        `解决方案：\n` +
        `1. ${providerName === '第三方中转' ? '前往中转服务平台充值积分\n' : '检查账户配额并充值\n'}` +
        `2. 更换其他有余额的API Key\n` +
        `3. ${providerName === '第三方中转' ? '切换到Gemini官方API\n' : '联系服务提供商\n'}`
      )
    }

    // 其他错误直接抛出
    // 🔧 修复(2025-12-11): 增加详细错误信息，便于排查400错误
    const errorDetails = error.response?.data?.error
    if (errorDetails) {
      console.error('❌ Gemini API错误详情:')
      console.error('   - code:', errorDetails.code)
      console.error('   - message:', errorDetails.message)
      console.error('   - status:', errorDetails.status)
      if (errorDetails.details) {
        console.error('   - details:', JSON.stringify(errorDetails.details, null, 2))
      }

      // 🔧 地理位置限制的友好错误提示
      if (errorDetails.message?.includes('location is not supported') ||
          errorDetails.status === 'FAILED_PRECONDITION') {
        throw new Error(
          `Gemini API调用失败: 当前地理位置不支持直接访问Gemini API。\n` +
          `解决方案:\n` +
          `1. 切换到第三方中转服务商\n` +
          `2. 使用VPN或代理切换到支持的地区\n` +
          `原始错误: ${errorDetails.message}`
        )
      }

      throw new Error(`Gemini API调用失败 (${errorDetails.code}): ${errorDetails.message}`)
    }
    throw new Error(`Gemini API调用失败: ${error.message}`)
  }
}
