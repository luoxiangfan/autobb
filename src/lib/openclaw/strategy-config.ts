import { getOpenclawSettingsMap, parseBoolean, parseJsonArray, parseNumber } from '@/lib/openclaw/settings'

export type OpenclawStrategyConfig = {
  enabled: boolean
  cron: string
  maxOffersPerRun: number
  defaultBudget: number
  maxCpc: number
  minCpc: number
  dailyBudgetCap: number
  dailySpendCap: number
  targetRoas: number
  priorityAsins?: string[]
  enableAutoPublish: boolean
  enableAutoPause: boolean
  enableAutoAdjustCpc: boolean
  allowAffiliateFetch: boolean
  enforceAutoadsOnly: boolean
  dryRun: boolean
}

const MAX_DAILY_BUDGET_CAP = 1000
const MAX_DAILY_SPEND_CAP = 100

function toFiniteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeAsinList(values: unknown[] | undefined): string[] | undefined {
  if (!values || values.length === 0) return undefined
  const normalized = values
    .map((entry) => String(entry || '').trim().toUpperCase())
    .filter((entry, index, array) => /^[A-Z0-9_-]{4,20}$/.test(entry) && array.indexOf(entry) === index)
  return normalized.length > 0 ? normalized : undefined
}

function parsePriorityAsins(value: string | null | undefined): string[] | undefined {
  const fromJson = normalizeAsinList(parseJsonArray(value))
  if (fromJson && fromJson.length > 0) return fromJson
  if (!value) return undefined

  const fallback = value
    .split(/[,\s\n\r\t]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean)
  return normalizeAsinList(fallback)
}

export function normalizeOpenclawStrategyConfig(raw: OpenclawStrategyConfig): OpenclawStrategyConfig {
  const dailyBudgetCap = clampNumber(
    toFiniteNumber(raw.dailyBudgetCap, MAX_DAILY_BUDGET_CAP),
    1,
    MAX_DAILY_BUDGET_CAP
  )
  const dailySpendCap = clampNumber(
    toFiniteNumber(raw.dailySpendCap, MAX_DAILY_SPEND_CAP),
    1,
    MAX_DAILY_SPEND_CAP
  )
  const campaignBudgetCap = Math.max(1, Math.min(dailyBudgetCap, dailySpendCap))

  const minCpc = Math.max(0.01, toFiniteNumber(raw.minCpc, 0.1))
  const maxCpc = Math.max(minCpc, toFiniteNumber(raw.maxCpc, 1.2))
  const maxOffersPerRun = Math.max(1, Math.floor(toFiniteNumber(raw.maxOffersPerRun, 3)))
  const defaultBudget = clampNumber(toFiniteNumber(raw.defaultBudget, 20), 1, campaignBudgetCap)
  const targetRoas = Math.max(0.1, toFiniteNumber(raw.targetRoas, 1))
  const cron = (raw.cron || '0 9 * * *').trim() || '0 9 * * *'

  const normalizedPriorityAsins = normalizeAsinList(raw.priorityAsins)

  return {
    ...raw,
    cron,
    maxOffersPerRun,
    defaultBudget,
    maxCpc,
    minCpc,
    dailyBudgetCap,
    dailySpendCap,
    targetRoas,
    priorityAsins: normalizedPriorityAsins && normalizedPriorityAsins.length > 0 ? normalizedPriorityAsins : undefined,
  }
}

export async function getOpenclawStrategyConfig(userId: number): Promise<OpenclawStrategyConfig> {
  const settingMap = await getOpenclawSettingsMap(userId)

  const priorityAsins = parsePriorityAsins(settingMap.openclaw_strategy_priority_asins)

  return normalizeOpenclawStrategyConfig({
    enabled: parseBoolean(settingMap.openclaw_strategy_enabled, false),
    cron: (settingMap.openclaw_strategy_cron || '0 9 * * *').trim(),
    maxOffersPerRun: parseNumber(settingMap.openclaw_strategy_max_offers_per_run, 3) ?? 3,
    defaultBudget: parseNumber(settingMap.openclaw_strategy_default_budget, 20) ?? 20,
    maxCpc: parseNumber(settingMap.openclaw_strategy_max_cpc, 1.2) ?? 1.2,
    minCpc: parseNumber(settingMap.openclaw_strategy_min_cpc, 0.1) ?? 0.1,
    dailyBudgetCap: parseNumber(settingMap.openclaw_strategy_daily_budget_cap, MAX_DAILY_BUDGET_CAP) ?? MAX_DAILY_BUDGET_CAP,
    dailySpendCap: parseNumber(settingMap.openclaw_strategy_daily_spend_cap, MAX_DAILY_SPEND_CAP) ?? MAX_DAILY_SPEND_CAP,
    targetRoas: parseNumber(settingMap.openclaw_strategy_target_roas, 1) ?? 1,
    priorityAsins,
    enableAutoPublish: parseBoolean(settingMap.openclaw_strategy_enable_auto_publish, true),
    enableAutoPause: parseBoolean(settingMap.openclaw_strategy_enable_auto_pause, true),
    enableAutoAdjustCpc: parseBoolean(settingMap.openclaw_strategy_enable_auto_adjust_cpc, true),
    allowAffiliateFetch: parseBoolean(settingMap.openclaw_strategy_allow_affiliate_fetch, true),
    enforceAutoadsOnly: parseBoolean(settingMap.openclaw_strategy_enforce_autoads_only, true),
    dryRun: parseBoolean(settingMap.openclaw_strategy_dry_run, false),
  })
}
