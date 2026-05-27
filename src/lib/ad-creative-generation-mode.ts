/**
 * 广告创意生成模式：快速 / 均衡 / 标准（原模式）
 */

import { AD_CREATIVE_MAX_AUTO_RETRIES } from './ad-creative-quality-constants'

export type AdCreativeGenerationMode = 'fast' | 'balanced' | 'original'

export const AD_CREATIVE_GENERATION_MODES: AdCreativeGenerationMode[] = [
  'fast',
  'balanced',
  'original',
]

/** 未指定或无效时的默认生成模式（与历史行为一致） */
export const AD_CREATIVE_GENERATION_MODE_DEFAULT: AdCreativeGenerationMode = 'original'

export const CREATIVE_GENERATION_MODE_INVALID_MESSAGE =
  'generationMode 仅支持 fast / balanced / original（兼容：快速 / 均衡 / 标准 / 原模式）'

export const AD_CREATIVE_GENERATION_MODE_LABELS: Record<AdCreativeGenerationMode, string> = {
  fast: '快速',
  balanced: '均衡',
  original: '标准',
}

/** 下拉框展示用短文案（避免与描述前半段重复拼接） */
export const AD_CREATIVE_GENERATION_MODE_SELECT_LABELS: Record<AdCreativeGenerationMode, string> = {
  fast: '快速',
  balanced: '均衡',
  original: '标准（默认）',
}

export const AD_CREATIVE_GENERATION_MODE_DESCRIPTIONS: Record<AdCreativeGenerationMode, string> = {
  fast: '速度优先：单次生成、跳过关键词 AI 补全与竞争定位 AI 增强，尽量保证可用质量',
  balanced: '速度与质量折中：最多 1 次自动重试，保留关键词补全但跳过部分 AI 增强',
  original: '标准质量流程（默认）：最多 2 次自动重试、关键词补全与竞争定位 AI 增强',
}

export const AD_CREATIVE_GENERATION_MODE_STORAGE_KEY = 'ad_creative_generation_mode'

export interface CreativeGenerationRuntime {
  mode: AdCreativeGenerationMode
  profile: AdCreativeGenerationModeProfile
  maxRetries: number
}

export interface AdCreativeGenerationModeProfile {
  maxRetries: number
  delayMs: number
  enableSupplementation: boolean
  skipSupplementAiRanking: boolean
  skipCompetitivePositioningAi: boolean
}

const MODE_PROFILES: Record<AdCreativeGenerationMode, AdCreativeGenerationModeProfile> = {
  fast: {
    maxRetries: 0,
    delayMs: 0,
    enableSupplementation: false,
    skipSupplementAiRanking: true,
    skipCompetitivePositioningAi: true,
  },
  balanced: {
    maxRetries: 1,
    delayMs: 500,
    enableSupplementation: true,
    skipSupplementAiRanking: true,
    skipCompetitivePositioningAi: true,
  },
  original: {
    maxRetries: AD_CREATIVE_MAX_AUTO_RETRIES,
    delayMs: 1000,
    enableSupplementation: true,
    skipSupplementAiRanking: false,
    skipCompetitivePositioningAi: false,
  },
}

const MODE_ALIASES: Record<string, AdCreativeGenerationMode> = {
  fast: 'fast',
  quick: 'fast',
  快速: 'fast',
  balanced: 'balanced',
  balance: 'balanced',
  均衡: 'balanced',
  original: 'original',
  standard: 'original',
  legacy: 'original',
  full: 'original',
  标准: 'original',
  完整: 'original',
  原模式: 'original',
  目前的模式: 'original',
  当前模式: 'original',
}

export function getDefaultAdCreativeGenerationMode(): AdCreativeGenerationMode {
  const raw = String(
    process.env.AD_CREATIVE_GENERATION_MODE_DEFAULT || AD_CREATIVE_GENERATION_MODE_DEFAULT
  ).trim().toLowerCase()
  return MODE_ALIASES[raw] || AD_CREATIVE_GENERATION_MODE_DEFAULT
}

export function normalizeAdCreativeGenerationMode(value: unknown): AdCreativeGenerationMode {
  if (typeof value !== 'string') {
    return getDefaultAdCreativeGenerationMode()
  }
  const key = value.trim().toLowerCase()
  return MODE_ALIASES[key] || getDefaultAdCreativeGenerationMode()
}

export function getAdCreativeGenerationModeLabel(mode: unknown): string {
  if (typeof mode === 'string') {
    const parsed = resolveGenerationModeInput(mode)
    if (parsed) {
      return AD_CREATIVE_GENERATION_MODE_LABELS[parsed]
    }
    const trimmed = mode.trim()
    if (trimmed) return trimmed
  }
  return AD_CREATIVE_GENERATION_MODE_LABELS[normalizeAdCreativeGenerationMode(mode)]
}

/** 解析任务/DB 中的模式值：已知别名 → 规范枚举；未知字符串原样保留 */
export function resolveStoredGenerationMode(
  value: unknown
): AdCreativeGenerationMode | string | null {
  if (value == null || value === '') return null
  const raw = String(value).trim()
  if (!raw) return null
  return resolveGenerationModeInput(raw) ?? raw
}

export function resolveGenerationModeInput(raw: unknown): AdCreativeGenerationMode | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  const key = raw.trim().toLowerCase()
  return MODE_ALIASES[key] ?? null
}

export type GenerationModeFromBodyResult =
  | { provided: false }
  | { provided: true; mode: AdCreativeGenerationMode }
  | { provided: true; invalid: true }

export function getGenerationModeFromRequestBody(body: unknown): GenerationModeFromBodyResult {
  if (!body || typeof body !== 'object') return { provided: false }
  const record = body as Record<string, unknown>
  const raw = record.generation_mode ?? record.generationMode
  if (raw == null || raw === '') return { provided: false }
  const mode = resolveGenerationModeInput(String(raw))
  if (!mode) return { provided: true, invalid: true }
  return { provided: true, mode }
}

export function getAdCreativeGenerationModeProfile(
  mode?: AdCreativeGenerationMode | string | null
): AdCreativeGenerationModeProfile {
  const normalized = typeof mode === 'string'
    ? normalizeAdCreativeGenerationMode(mode)
    : (mode || getDefaultAdCreativeGenerationMode())
  return MODE_PROFILES[normalized]
}

function resolveModeAndProfileFromRequest(body: unknown): {
  mode: AdCreativeGenerationMode
  profile: AdCreativeGenerationModeProfile
} {
  const parsed = getGenerationModeFromRequestBody(body)
  const mode = parsed && 'mode' in parsed && parsed.mode
    ? parsed.mode
    : getDefaultAdCreativeGenerationMode()
  return {
    mode,
    profile: getAdCreativeGenerationModeProfile(mode),
  }
}

/** 从请求体解析模式 + 配置，并将 maxRetries 限制在模式上限内 */
export function resolveCreativeGenerationRuntime(body: unknown): {
  runtime: CreativeGenerationRuntime
  invalidMode: boolean
} {
  const modeParsed = getGenerationModeFromRequestBody(body)
  if ('invalid' in modeParsed && modeParsed.invalid) {
    return {
      runtime: {
        mode: getDefaultAdCreativeGenerationMode(),
        profile: getAdCreativeGenerationModeProfile(getDefaultAdCreativeGenerationMode()),
        maxRetries: AD_CREATIVE_MAX_AUTO_RETRIES,
      },
      invalidMode: true,
    }
  }

  const { mode, profile } = resolveModeAndProfileFromRequest(body)
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const requestedMaxRetries = Number(record.maxRetries)
  const maxRetries = Math.max(
    0,
    Math.min(
      AD_CREATIVE_MAX_AUTO_RETRIES,
      profile.maxRetries,
      Number.isFinite(requestedMaxRetries)
        ? Math.floor(requestedMaxRetries)
        : profile.maxRetries
    )
  )

  return {
    runtime: { mode, profile, maxRetries },
    invalidMode: false,
  }
}

export function loadStoredAdCreativeGenerationMode(): AdCreativeGenerationMode {
  if (typeof window === 'undefined') {
    return getDefaultAdCreativeGenerationMode()
  }
  try {
    const raw = window.localStorage.getItem(AD_CREATIVE_GENERATION_MODE_STORAGE_KEY)
    if (!raw) return getDefaultAdCreativeGenerationMode()
    return normalizeAdCreativeGenerationMode(raw)
  } catch {
    return getDefaultAdCreativeGenerationMode()
  }
}

export function saveStoredAdCreativeGenerationMode(mode: AdCreativeGenerationMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(AD_CREATIVE_GENERATION_MODE_STORAGE_KEY, mode)
  } catch {
    // ignore quota / privacy mode errors
  }
}
