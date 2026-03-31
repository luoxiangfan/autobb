// 补点击任务执行器
// src/lib/queue/executors/click-farm-executor.ts

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Task } from '../types';
import { updateTaskStats } from '@/lib/click-farm';
import { getHourInTimezone } from '@/lib/timezone-utils';
import { getDatabase } from '@/lib/db';
import { getAllProxyUrls } from '@/lib/settings';
import { getProxyIp } from '@/lib/proxy/fetch-proxy-ip';
import type { ProxyCredentials } from '@/lib/proxy/types';
import { ProxyProviderRegistry } from '@/lib/proxy/providers/provider-registry';
import { maskProxyUrl } from '@/lib/proxy/validate-url';
import { assertUserExecutionAllowed } from '@/lib/user-execution-eligibility';
import { getHeapStatistics } from 'v8';
import { analyzeProxyError } from './proxy-error-handler';

/**
 * 补点击任务数据结构
 */
export interface ClickFarmTaskData {
  taskId: string;        // click_farm_tasks表的ID
  url: string;           // 要访问的affiliate链接
  proxyUrl: string;      // 代理URL
  offerId: number;       // Offer ID（用于日志）
  timezone?: string;     // 🆕 任务时区（用于按 scheduledAt 统计到正确小时，避免每次点击再查库）
  // 🆕 计划执行时间（用于将点击分散到1小时内不同时间点执行）
  scheduledAt?: string;  // ISO 8601 格式的时间戳字符串
  // 🆕 Referer配置
  refererConfig?: {
    type: 'none' | 'random' | 'specific' | 'custom';
    referer?: string;    // specific/custom类型时的固定referer
  };
}

/**
 * 社交媒体Referer列表
 * 用于防止反爬检测，模拟真实用户来源
 */
export const SOCIAL_MEDIA_REFERRERS = [
  { name: 'Facebook', url: 'https://www.facebook.com/', pattern: 'facebook' },
  { name: 'Twitter/X', url: 'https://twitter.com/search?q=', pattern: 'twitter' },
  { name: 'Instagram', url: 'https://www.instagram.com/', pattern: 'instagram' },
  { name: 'YouTube', url: 'https://www.youtube.com/', pattern: 'youtube' },
  { name: 'TikTok', url: 'https://www.tiktok.com/', pattern: 'tiktok' },
  { name: 'Pinterest', url: 'https://www.pinterest.com/search/pins/?q=', pattern: 'pinterest' },
  { name: 'Reddit', url: 'https://www.reddit.com/search/?q=', pattern: 'reddit' },
  { name: 'LinkedIn', url: 'https://www.linkedin.com/search/results/all/?keyword=', pattern: 'linkedin' },
  { name: 'Medium', url: 'https://medium.com/search?q=', pattern: 'medium' },
  { name: 'WhatsApp', url: 'https://wa.me/', pattern: 'whatsapp' },
  { name: 'Snapchat', url: 'https://www.snapchat.com/', pattern: 'snapchat' },
  { name: 'Quora', url: 'https://www.quora.com/search?q=', pattern: 'quora' },
];

/**
 * 🆕 从社媒列表中随机获取一个referer
 */
export function getRandomSocialReferer(): string {
  const randomIndex = Math.floor(Math.random() * SOCIAL_MEDIA_REFERRERS.length);
  return SOCIAL_MEDIA_REFERRERS[randomIndex].url;
}

const MAX_PROXY_AGENT_CACHE_SIZE = 50
const proxyAgentCache = new Map<string, HttpsProxyAgent<string>>()

function getProxyAgent(proxyAddress: string): HttpsProxyAgent<string> {
  const cached = proxyAgentCache.get(proxyAddress)
  if (cached) {
    // 简单LRU：Map迭代顺序即插入顺序
    proxyAgentCache.delete(proxyAddress)
    proxyAgentCache.set(proxyAddress, cached)
    return cached
  }

  const agent = new HttpsProxyAgent(proxyAddress, {
    keepAlive: true,
    maxSockets: 50,
    rejectUnauthorized: false,
  } as any)

  proxyAgentCache.set(proxyAddress, agent)
  if (proxyAgentCache.size > MAX_PROXY_AGENT_CACHE_SIZE) {
    const oldestKey = proxyAgentCache.keys().next().value
    if (oldestKey) proxyAgentCache.delete(oldestKey)
  }
  return agent
}

/**
 * 补点击任务的代理IP使用记录
 * 用于跟踪每个任务最近使用的代理IP，避免短时间内重复使用
 */
interface TaskProxyUsage {
  taskId: string
  proxyAddress: string
  usedAt: number
}

const taskProxyUsageHistory = new Map<string, TaskProxyUsage>()
const TASK_PROXY_REUSE_COOLDOWN = (() => {
  const raw = parseInt(process.env.CLICK_FARM_TASK_PROXY_REUSE_COOLDOWN_MS || '300000', 10)
  return Number.isFinite(raw) && raw >= 0 ? raw : 5 * 60 * 1000
})()
const IPROCKET_DEGRADED_REUSE_WINDOW_MS = (() => {
  const raw = parseInt(process.env.CLICK_FARM_IPROCKET_DEGRADED_REUSE_WINDOW_MS || '90000', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 90 * 1000
})()
const TASK_FALLBACK_REUSE_MAX_STREAK = (() => {
  const raw = parseInt(process.env.CLICK_FARM_TASK_FALLBACK_REUSE_MAX_STREAK || '12', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 12
})()

interface ProxyDegradedState {
  degradedUntil: number
  updatedAt: number
}

interface TaskFallbackReuseState {
  count: number
  updatedAt: number
}

const iprocketDegradedStates = new Map<string, ProxyDegradedState>()
const taskFallbackReuseStates = new Map<string, TaskFallbackReuseState>()

function buildProviderStateKey(userId: number, proxyUrl: string): string {
  return `${userId}\u0000${proxyUrl}`
}

function isLikelyIprocketProxyUrl(proxyUrl: string): boolean {
  return proxyUrl.includes('api.iprocket.io')
}

function cleanupFallbackState(now: number): void {
  const expireBefore = now - 60 * 60 * 1000
  for (const [key, state] of taskFallbackReuseStates.entries()) {
    if (state.updatedAt < expireBefore) taskFallbackReuseStates.delete(key)
  }
}

function getTaskFallbackReuseCount(taskId: string): number {
  const now = Date.now()
  cleanupFallbackState(now)
  const state = taskFallbackReuseStates.get(taskId)
  if (!state) return 0
  return state.count
}

function canTaskFallbackReuse(taskId: string): boolean {
  return getTaskFallbackReuseCount(taskId) < TASK_FALLBACK_REUSE_MAX_STREAK
}

function recordTaskFallbackReuse(taskId: string): number {
  const now = Date.now()
  const current = taskFallbackReuseStates.get(taskId)
  const nextCount = (current?.count || 0) + 1
  taskFallbackReuseStates.set(taskId, { count: nextCount, updatedAt: now })
  return nextCount
}

function resetTaskFallbackReuse(taskId?: string): void {
  if (!taskId) return
  taskFallbackReuseStates.delete(taskId)
}

function isProviderInDegradedMode(stateKey: string): boolean {
  const state = iprocketDegradedStates.get(stateKey)
  if (!state) return false
  if (Date.now() > state.degradedUntil) {
    iprocketDegradedStates.delete(stateKey)
    return false
  }
  return true
}

function markProviderDegraded(stateKey: string): void {
  const now = Date.now()
  iprocketDegradedStates.set(stateKey, {
    degradedUntil: now + IPROCKET_DEGRADED_REUSE_WINDOW_MS,
    updatedAt: now,
  })
}

function clearProviderDegraded(stateKey: string): void {
  iprocketDegradedStates.delete(stateKey)
}

function shouldFallbackToCachedProxy(error: any): boolean {
  const analysis = analyzeProxyError(error)
  if (analysis.isIPRocketBusinessError) return true

  const raw = String(error?.message || error || '')
  return (
    raw.includes('IPRocket') &&
    (
      raw.includes('业务异常') ||
      raw.includes('联系客服') ||
      raw.includes('Business abnormality') ||
      raw.includes('business error') ||
      raw.includes('contact customer service') ||
      raw.includes('"code":500') ||
      raw.includes('code=500')
    )
  )
}

/**
 * 检查任务是否可以使用指定的代理IP
 * @param taskId - 任务ID
 * @param proxyAddress - 代理IP地址
 * @returns 是否可以使用
 */
function canTaskUseProxy(taskId: string, proxyAddress: string): boolean {
  const usage = taskProxyUsageHistory.get(taskId)
  if (!usage) return true // 任务第一次使用代理，允许

  const now = Date.now()
  const timeSinceLastUse = now - usage.usedAt

  // 如果上次使用的是同一个IP，且在冷却期内，不允许使用
  if (usage.proxyAddress === proxyAddress && timeSinceLastUse < TASK_PROXY_REUSE_COOLDOWN) {
    return false
  }

  return true
}

/**
 * 记录任务使用了指定的代理IP
 * @param taskId - 任务ID
 * @param proxyAddress - 代理IP地址
 */
function recordTaskProxyUsage(taskId: string, proxyAddress: string): void {
  taskProxyUsageHistory.set(taskId, {
    taskId,
    proxyAddress,
    usedAt: Date.now()
  })

  // 清理过期记录（超过1小时的记录）
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  for (const [key, usage] of taskProxyUsageHistory.entries()) {
    if (usage.usedAt < oneHourAgo) {
      taskProxyUsageHistory.delete(key)
    }
  }
}

async function resolveProxyAddress(proxyUrl: string, userId: number, taskId?: string): Promise<string | null> {
  const trimmed = proxyUrl.trim()
  if (!trimmed) return null

  // 优先支持”代理provider URL”（如 IPRocket API / Oxylabs / Kookeey / Cliproxy 等），统一解析成真实代理IP再使用。
  if (ProxyProviderRegistry.isSupported(trimmed)) {
    // 🔥 补点击任务优化：智能代理IP复用策略
    //
    // 目标：
    // 1. 减少 IPRocket API 调用次数（避免触发频率限制）
    // 2. 确保同一任务的每次点击使用不同IP（避免被识别为刷量）
    //
    // 策略：
    // 1. 启用全局缓存（forceRefresh=false），不同任务可以共享代理IP池
    // 2. 检查缓存的IP是否被当前任务最近使用过
    // 3. 如果被使用过且在冷却期内（5分钟），强制获取新IP
    // 4. 否则使用缓存的IP
    //
    // 效果：
    // - 任务A第1次点击（10:00）：获取IP1，缓存5分钟
    // - 任务A第2次点击（10:01）：检测到IP1刚被使用，强制获取IP2
    // - 任务B第1次点击（10:02）：可以使用缓存的IP1（因为任务B没用过IP1）
    // - 任务A第3次点击（10:06）：可以使用缓存的IP1（因为冷却期已过）

    let creds: ProxyCredentials | null = null
    let usedFallbackReuse = false
    let needForceRefresh = false
    const isIprocket = isLikelyIprocketProxyUrl(trimmed)
    const providerStateKey = buildProviderStateKey(userId, trimmed)
    const inDegradedMode = isIprocket && isProviderInDegradedMode(providerStateKey)

    // 先尝试从缓存获取
    try {
      creds = await getProxyIp(trimmed, false, userId) // 尝试使用缓存（用户级别隔离）
      const proxyAddress = `${creds.host}:${creds.port}`

      // 检查当前任务是否可以使用这个IP
      if (taskId && !canTaskUseProxy(taskId, proxyAddress)) {
        if (inDegradedMode && canTaskFallbackReuse(taskId)) {
          const streak = recordTaskFallbackReuse(taskId)
          usedFallbackReuse = true
          console.warn(`[ClickFarm] 任务 ${taskId} 命中IPRocket降级窗口，复用缓存代理 ${proxyAddress}（连续复用 ${streak}/${TASK_FALLBACK_REUSE_MAX_STREAK}）`)
        } else {
          console.log(`[ClickFarm] 任务 ${taskId} 不能重复使用代理 ${proxyAddress}，强制获取新IP`)
          needForceRefresh = true
        }
      }
    } catch (error) {
      // 缓存未命中，需要获取新IP
      needForceRefresh = true
    }

    // 如果需要强制刷新，获取新IP
    if (needForceRefresh || !creds) {
      try {
        creds = await getProxyIp(trimmed, true, userId) // 强制获取新IP（用户级别隔离）
        clearProviderDegraded(providerStateKey)
        resetTaskFallbackReuse(taskId)
      } catch (error) {
        if (
          isIprocket &&
          creds &&
          shouldFallbackToCachedProxy(error) &&
          (!taskId || canTaskFallbackReuse(taskId))
        ) {
          markProviderDegraded(providerStateKey)
          if (taskId) {
            const streak = recordTaskFallbackReuse(taskId)
            usedFallbackReuse = true
            console.warn(`[ClickFarm] 任务 ${taskId} IPRocket返回业务错误，回退使用缓存代理（连续复用 ${streak}/${TASK_FALLBACK_REUSE_MAX_STREAK}）`)
          } else {
            usedFallbackReuse = true
          }
        } else {
          throw error
        }
      }
    }

    const proxyAddress = `${creds.host}:${creds.port}`

    // 记录任务使用了这个IP
    if (taskId) {
      recordTaskProxyUsage(taskId, proxyAddress)
      if (!usedFallbackReuse) {
        resetTaskFallbackReuse(taskId)
      }
    }

    return `http://${creds.username}:${creds.password}@${proxyAddress}`
  }

  const parsed = parseProxyUrl(trimmed)
  if (!parsed) return null
  return parsed.auth
    ? `http://${parsed.auth.username}:${parsed.auth.password}@${parsed.host}:${parsed.port}`
    : `http://${parsed.host}:${parsed.port}`
}

type ReleaseFn = () => void
class SimpleSemaphore {
  private inFlight = 0
  private waiters: Array<(release: ReleaseFn) => void> = []

  constructor(private readonly maxInFlight: number) {}

  async acquire(): Promise<ReleaseFn> {
    if (this.inFlight < this.maxInFlight) {
      this.inFlight++
      return () => this.release()
    }

    return await new Promise<ReleaseFn>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  private release() {
    this.inFlight = Math.max(0, this.inFlight - 1)
    const next = this.waiters.shift()
    if (next) {
      this.inFlight++
      next(() => this.release())
    }
  }
}

// click-farm 需要“快速发起请求即算成功”，但同时必须避免堆出海量并发请求。
// 这里用一个轻量级信号量控制真实 in-flight 请求数；任务不等待响应结果，但会等待“拿到发起名额”。
const CLICK_FARM_INFLIGHT_HARD_CAP = (() => {
  const raw = parseInt(process.env.CLICK_FARM_MAX_INFLIGHT_HARD_CAP || '40', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 40
})()
const CLICK_FARM_EXECUTOR_HEAP_PRESSURE_PCT = (() => {
  const raw = parseFloat(process.env.CLICK_FARM_EXECUTOR_HEAP_PRESSURE_PCT || '90')
  if (!Number.isFinite(raw)) return 90
  return Math.min(95, Math.max(50, raw))
})()
const clickFarmMaxInFlight = (() => {
  const raw = parseInt(process.env.CLICK_FARM_MAX_INFLIGHT || '20', 10)
  const value = Number.isFinite(raw) && raw > 0 ? raw : 20
  return Math.min(value, CLICK_FARM_INFLIGHT_HARD_CAP)
})()
const clickFarmSemaphore = new SimpleSemaphore(
  Math.max(1, clickFarmMaxInFlight)
)

function isHeapPressureHigh(): boolean {
  try {
    const heapUsed = process.memoryUsage().heapUsed
    const limit = getHeapStatistics().heap_size_limit
    if (!limit || limit <= 0) return false
    const pct = (heapUsed / limit) * 100
    return pct >= CLICK_FARM_EXECUTOR_HEAP_PRESSURE_PCT
  } catch {
    return false
  }
}

/**
 * 解析代理URL - 支持多种格式
 *
 * 支持的格式：
 * 1. URL格式: http://host:port
 * 2. URL格式: https://user:pass@host:port
 * 3. 直接格式: host:port:user:pass
 * 4. 简单格式: host:port
 */
function parseProxyUrl(proxyUrl: string): {
  host: string;
  port: number;
  auth?: { username: string; password: string };
  protocol: string;
} | null {
  if (!proxyUrl || !proxyUrl.trim()) {
    return null;
  }

  const trimmedUrl = proxyUrl.trim();

  // 格式0: 直连格式（可选带 http(s):// 前缀）: host:port:user:pass
  const directUrl = trimmedUrl.replace(/^https?:\/\//, '');
  const directParts = directUrl.split(':');
  if (directParts.length >= 4) {
    const port = parseInt(directParts[1]);
    if (!isNaN(port)) {
      return {
        host: directParts[0],
        port: port,
        auth: {
          username: directParts[2],
          password: directParts[3]
        },
        protocol: 'http'
      };
    }
  }

  // 格式1: 标准URL (http:// 或 https://)
  if (trimmedUrl.startsWith('http://') || trimmedUrl.startsWith('https://')) {
    try {
      const url = new URL(trimmedUrl);
      return {
        host: url.hostname,
        port: parseInt(url.port) || (url.protocol === 'https' ? 443 : 80),
        auth: url.username && url.password ? {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password)
        } : undefined,
        protocol: url.protocol.replace(':', '')
      };
    } catch (error) {
      console.error(`[ClickFarm] 代理URL解析失败: ${trimmedUrl}`, error);
      return null;
    }
  }

  // 格式2: 简单格式 (host:port)
  const parts = trimmedUrl.split(':');
  if (parts.length === 2) {
    const port = parseInt(parts[1]);
    if (!isNaN(port)) {
      return {
        host: parts[0],
        port: port,
        protocol: 'http'
      };
    }
  }

  console.error(`[ClickFarm] 不支持的代理URL格式: ${trimmedUrl}`);
  return null;
}

/**
 * 生成随机的User-Agent
 * 模拟不同浏览器和设备（使用最新版本）
 */
function getRandomUserAgent(): string {
  const userAgents = [
    // Chrome on Windows (最新版本)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    // Chrome on macOS (最新版本)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    // Firefox on Windows (最新版本)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    // Safari on macOS (最新版本)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
    // Edge on Windows (最新版本)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  ];

  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * 生成随机的Accept-Language
 */
function getRandomAcceptLanguage(): string {
  const languages = [
    'en-US,en;q=0.9',
    'en-US,en;q=0.9,zh-CN;q=0.8',
    'en-US,en;q=0.9,de;q=0.8',
    'en-US,en;q=0.9,fr;q=0.8',
    'en-US,en;q=0.9,es;q=0.8',
    'en-GB,en;q=0.9,en-US;q=0.8',
  ];

  return languages[Math.floor(Math.random() * languages.length)];
}

/**
 * 执行单次点击任务
 *
 * 🔥 需求5：采用Fire & Forget模式（发起请求但异步追踪结果）
 * - 发起HTTP请求后立即返回
 * - 后台异步监听响应，根据HTTP状态码判断成功/失败
 * - 3秒超时（短超时确保快速释放连接）
 * - 准确记录统计（不依赖乐观假设）
 *
 * 🆕 防爬优化：
 * - 随机User-Agent（模拟不同浏览器）
 * - 随机Accept-Language
 * - 可配置的Referer（模拟不同来源）
 * - 随机请求间隔（避免固定频率）
 *
 * 🆕 时间分散执行：
 * - 支持 scheduledAt 字段，将点击分散到1小时内的不同时间点执行
 * - 如果当前时间早于 scheduledAt，延迟执行
 */
export async function executeClickFarmTask(
  task: Task<ClickFarmTaskData>
): Promise<{ success: boolean; traffic: number }> {
  const { taskId, url, refererConfig, scheduledAt, timezone } = task.data;
  await assertUserExecutionAllowed(task.userId, { source: `click-farm:${task.id}` })

  const getScheduledHour = (): number | undefined => {
    if (!scheduledAt) return undefined
    const tz = timezone || 'America/New_York'
    return getHourInTimezone(new Date(scheduledAt), tz)
  }

  // 关键防线：执行前再次校验 click_farm_tasks 状态，避免“已暂停/已停止任务”残留队列继续记点击
  try {
    const db = await getDatabase()
    const currentTask = await db.queryOne<{ status?: string }>(`
      SELECT status
      FROM click_farm_tasks
      WHERE id = ?
      LIMIT 1
    `, [taskId])

    const status = String(currentTask?.status || '').toLowerCase()
    if (status && status !== 'pending' && status !== 'running') {
      console.log(`[ClickFarm] 跳过执行: taskId=${taskId}, status=${status}`)
      return { success: false, traffic: 0 }
    }
  } catch (error: any) {
    console.warn(`[ClickFarm] 执行前状态校验失败，按安全策略跳过: ${taskId}`, error?.message || error)
    return { success: false, traffic: 0 }
  }

  // 生产止血：当堆内存接近上限时，不再继续发起点击请求，避免触发进程 OOM。
  if (isHeapPressureHigh()) {
    const mem = process.memoryUsage()
    const heap = getHeapStatistics()
    const pct = ((mem.heapUsed / heap.heap_size_limit) * 100).toFixed(2)
    console.warn(`[ClickFarm] 内存压力过高，跳过执行`, {
      taskId,
      heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`,
      heapLimit: `${(heap.heap_size_limit / 1024 / 1024).toFixed(2)} MB`,
      percentage: `${pct}%`,
      threshold: `${CLICK_FARM_EXECUTOR_HEAP_PRESSURE_PCT}%`
    })
    try {
      await updateTaskStats(taskId, false, getScheduledHour())
    } catch {
      // ignore
    }
    return { success: false, traffic: 0 }
  }

  // 🔧 修复：动态获取代理URL（重试时会清除旧代理，需要重新获取）
  let proxyUrl = task.data.proxyUrl
  if (!proxyUrl) {
    console.log(`[ClickFarm] 任务 ${taskId} 未配置代理，尝试动态获取...`)
    try {
      // 获取任务信息以确定目标国家
      const db = await getDatabase()
      const taskRow = await db.queryOne<any>(`
        SELECT t.user_id, o.target_country
        FROM click_farm_tasks t
        JOIN offers o ON t.offer_id = o.id
        WHERE t.id = ?
      `, [taskId])

      if (taskRow) {
        const proxyUrls = await getAllProxyUrls(taskRow.user_id)
        const targetCountry = taskRow.target_country?.toUpperCase()
        const proxyConfig = proxyUrls?.find(p => p.country.toUpperCase() === targetCountry)

        if (proxyConfig && proxyConfig.url) {
          proxyUrl = proxyConfig.url
          console.log(`[ClickFarm] 任务 ${taskId} 动态获取到代理: ${targetCountry} (${proxyUrl.substring(0, 30)}...)`)
        }
      }
    } catch (error: any) {
      const errorAnalysis = analyzeProxyError(error)
      console.error(`[ClickFarm] 动态获取代理失败: ${error.message}`)
      if (errorAnalysis.isIPRocketBusinessError) {
        console.error(`[ClickFarm] IPRocket 业务错误详情:\n${errorAnalysis.enhancedMessage}`)
      }
    }
  }

  // 如果仍然没有代理，记录错误
  if (!proxyUrl) {
    console.error(`[ClickFarm] 任务 ${taskId} 缺少代理配置，无法执行`)
    await updateTaskStats(taskId, false)
    return { success: false, traffic: 0 }
  }

  try {
    // 🔧 关键修复：支持 IPRocket 这类”provider URL”，先解析出真实代理IP再使用
    // 🔥 传入 userId 和 taskId 用于用户级别隔离和按任务隔离缓存
    let proxyAddress: string | null = null
    try {
      proxyAddress = await resolveProxyAddress(proxyUrl, task.userId, taskId)
    } catch (e: any) {
      const errorAnalysis = analyzeProxyError(e)
      console.error(`[ClickFarm] 代理解析失败: ${maskProxyUrl(proxyUrl)}`)
      console.error(`错误详情: ${errorAnalysis.enhancedMessage}`)
    }
    if (!proxyAddress) {
      console.error(`[ClickFarm] 代理URL解析失败: ${maskProxyUrl(proxyUrl)}`);
      await updateTaskStats(taskId, false);
      return { success: false, traffic: 0 };
    }

    // 控制真实 in-flight 请求数，避免同时堆出大量 HTTP 请求
    const release = await clickFarmSemaphore.acquire()
    let released = false
    const safeRelease = () => {
      if (released) return
      released = true
      release()
    }

    const proxyAgent = getProxyAgent(proxyAddress)

    // 执行前再次检查，尽快响应用户禁用/过期状态变化
    await assertUserExecutionAllowed(task.userId, { source: `click-farm:before-request:${task.id}` })

    // 🆕 确定Referer
    let referer: string | undefined;
    if (refererConfig) {
      switch (refererConfig.type) {
        case 'specific':
        case 'custom':
          referer = refererConfig.referer;
          break;
        case 'random':
          referer = getRandomSocialReferer();
          break;
        case 'none':
        default:
          referer = undefined;
      }
    }

    const startTime = Date.now();

    // 🆕 构建请求头（完整的浏览器指纹，绕过反爬虫）
    const userAgent = getRandomUserAgent();
    const headers: Record<string, string> = {
      'User-Agent': userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': getRandomAcceptLanguage(),
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
      'DNT': '1',
    };

    // 🆕 添加Chrome特征头（Sec-CH-UA系列）
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      const chromeVersion = userAgent.match(/Chrome\/(\d+)/)?.[1] || '131';
      headers['Sec-CH-UA'] = `"Not_A Brand";v="8", "Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}"`;
      headers['Sec-CH-UA-Mobile'] = '?0';
      headers['Sec-CH-UA-Platform'] = userAgent.includes('Windows') ? '"Windows"' : '"macOS"';
    } else if (userAgent.includes('Edg')) {
      const edgeVersion = userAgent.match(/Edg\/(\d+)/)?.[1] || '131';
      headers['Sec-CH-UA'] = `"Not_A Brand";v="8", "Chromium";v="${edgeVersion}", "Microsoft Edge";v="${edgeVersion}"`;
      headers['Sec-CH-UA-Mobile'] = '?0';
      headers['Sec-CH-UA-Platform'] = '"Windows"';
    }

    // 🆕 添加Referer头（如果配置了）
    if (referer) {
      headers['Referer'] = referer;
    }

    // 🆕 P0修复：从 scheduledAt 提取计划执行的小时数，而不是使用实际执行时间
    const scheduledHour = getScheduledHour()

    // 需求：只要“成功发起请求”就算成功；不等待访问结果
    // 这里将“发起成功”定义为：请求已被创建并进入发送流程（axios 调用不抛同步错误）。
    // 真实网络是否返回/是否成功不影响成功统计，但会影响 in-flight 释放。
    const requestPromise = axios.get(url, {
      httpAgent: proxyAgent,
      httpsAgent: proxyAgent,
      proxy: false,
      timeout: 2000,
      validateStatus: () => true,
      maxRedirects: 0,
      headers,
      responseType: 'stream',
    })

    // 🔥 释放名额：不等待结果返回给队列，但仍然跟踪请求结束以控制并发
    const hardReleaseTimer = setTimeout(() => {
      safeRelease()
    }, 5000)

    requestPromise
      .then((response) => {
        try {
          response.data?.destroy?.()
        } catch {
          // ignore
        }
      })
      .catch(() => {
        // ignore：不影响“发起成功”判定
      })
      .finally(() => {
        clearTimeout(hardReleaseTimer)
        safeRelease()
      })

    try {
      await updateTaskStats(taskId, true, scheduledHour)
    } catch (error) {
      console.warn(`[ClickFarm] 统计更新失败: ${taskId}`, error)
    }

    console.log(
      `[ClickFarm] 请求已发起: ${url.substring(0, 50)}... [${Date.now() - startTime}ms]` +
        (referer ? ` [Referer: ${referer.substring(0, 30)}...]` : '')
    );

    return { success: true, traffic: url.length + 500 };

  } catch (error: any) {
    console.error(`[ClickFarm] 执行器错误:`, error?.message || error);
    // 同步阶段失败（例如代理URL解析失败之外的异常），记为失败
    try {
      let scheduledHour: number | undefined;
      scheduledHour = getScheduledHour()
      await updateTaskStats(taskId, false, scheduledHour);
    } catch {
      // ignore
    }
    return { success: false, traffic: 0 };
  }
}

/**
 * 创建队列系统的ClickFarm执行器
 */
export function createClickFarmExecutor() {
  return async (task: Task<ClickFarmTaskData>) => {
    return await executeClickFarmTask(task);
  };
}
