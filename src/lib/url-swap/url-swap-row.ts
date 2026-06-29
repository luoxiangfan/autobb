/**
 * DB row parsing and normalization for url-swap tasks.
 */
import { parseJsonField } from '@/lib/db'
import type { SwapHistoryEntry, UrlSwapMode, UrlSwapTask } from './url-swap-types'
import { normalizeAffiliateLinksInput, findInvalidAffiliateLinks } from './url-swap-link-utils'

export function calculateUrlSwapProgress(row: any): number {
  const status = String(row?.status || '')
  if (status === 'completed') return 100

  const durationDaysRaw = row?.duration_days
  const durationDays =
    typeof durationDaysRaw === 'number'
      ? durationDaysRaw
      : parseInt(String(durationDaysRaw ?? ''), 10)
  if (!Number.isFinite(durationDays)) return 0
  if (durationDays === -1) return 0
  if (durationDays <= 0) return 0

  const startedAtRaw = row?.started_at
  if (!startedAtRaw) return 0
  const startedAtMs = new Date(startedAtRaw).getTime()
  if (!Number.isFinite(startedAtMs)) return 0

  const elapsedMs = Date.now() - startedAtMs
  const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24))
  if (elapsedDays <= 0) return 0

  return Math.min(100, Math.round((elapsedDays / durationDays) * 100))
}

function attachHasEnabledCampaign<T extends { has_enabled_campaign?: boolean }>(
  task: T,
  row: { has_enabled_campaign?: unknown }
): T {
  if (row.has_enabled_campaign !== undefined && row.has_enabled_campaign !== null) {
    task.has_enabled_campaign = Boolean(row.has_enabled_campaign)
  }
  return task
}

export function parseUrlSwapTask(row: any): UrlSwapTask {
  const swapMode = normalizeUrlSwapMode(row.swap_mode)
  const manualAffiliateLinks = parseStringArrayJson(row.manual_affiliate_links)
  const manualCursorRaw = row.manual_suffix_cursor
  const manualSuffixCursor =
    typeof manualCursorRaw === 'number'
      ? manualCursorRaw
      : parseInt(String(manualCursorRaw ?? '0'), 10)

  const task: UrlSwapTask = {
    id: row.id,
    user_id: row.user_id,
    offer_id: row.offer_id,
    swap_interval_minutes: row.swap_interval_minutes,
    enabled: Boolean(row.enabled),
    duration_days: row.duration_days,
    swap_mode: swapMode,
    manual_affiliate_links: manualAffiliateLinks,
    manual_suffix_cursor:
      Number.isFinite(manualSuffixCursor) && manualSuffixCursor >= 0 ? manualSuffixCursor : 0,
    google_customer_id: row.google_customer_id,
    google_campaign_id: row.google_campaign_id,
    current_final_url: row.current_final_url,
    current_final_url_suffix: row.current_final_url_suffix,
    progress: calculateUrlSwapProgress(row),
    total_swaps: row.total_swaps || 0,
    success_swaps: row.success_swaps || 0,
    failed_swaps: row.failed_swaps || 0,
    url_changed_count: row.url_changed_count || 0,
    consecutive_failures: row.consecutive_failures || 0,
    swap_history: parseJsonField<SwapHistoryEntry[]>(row.swap_history, []),
    status: row.status,
    error_message: row.error_message,
    error_at: row.error_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    next_swap_at: row.next_swap_at,
    is_deleted: Boolean(row.is_deleted),
    deleted_at: row.deleted_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }

  return attachHasEnabledCampaign(task, row)
}

export function normalizeNullableString(input: unknown): string | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function normalizeUrlSwapMode(input: unknown): UrlSwapMode {
  return input === 'manual' ? 'manual' : 'auto'
}

export function normalizeManualAffiliateLinks(input: unknown): string[] {
  const normalized = normalizeAffiliateLinksInput(input)
  const invalidLinks = findInvalidAffiliateLinks(normalized)
  if (invalidLinks.length > 0) {
    throw new Error('方式二推广链接需包含 http/https 协议')
  }

  const out: string[] = []
  const seen = new Set<string>()
  for (const value of normalized) {
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }

  return out
}

function parseStringArrayJson(input: unknown): string[] {
  const parsed = parseJsonField<unknown[]>(input, [])
  if (!Array.isArray(parsed)) return []
  return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}
