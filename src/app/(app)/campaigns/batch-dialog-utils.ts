import type { BatchOfflineAccountIssue } from './types'

export function buildBatchAccountStatusSummary(
  accountIssues: BatchOfflineAccountIssue[]
): string | null {
  if (accountIssues.length === 0) return null

  const grouped = new Map<string, number>()
  accountIssues.forEach((item) => {
    const status = item.accountStatus || 'UNKNOWN'
    grouped.set(status, (grouped.get(status) || 0) + 1)
  })

  return Array.from(grouped.entries())
    .map(([status, count]) => `${status}（${count}个）`)
    .join('，')
}

export function buildBatchAccountIssueSampleNames(
  accountIssues: BatchOfflineAccountIssue[],
  limit: number = 3
): string {
  return accountIssues
    .slice(0, limit)
    .map((item) => item.campaign.campaignName)
    .join('、')
}
