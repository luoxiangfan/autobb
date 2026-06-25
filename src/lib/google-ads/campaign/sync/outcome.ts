import { getDatabase } from '../../../db'
import type { SyncResult } from './types'

/* * 用户是否已在 admin MCC 分配页绑定 MCC（campaign sync 前置条件） */
export async function userHasGoogleAdsMccAssignments(userId: number): Promise<boolean> {
  const db = await getDatabase()
  const row = await db.queryOne<{ ok: number }>(
    `SELECT 1 AS ok FROM user_mcc_assignments WHERE user_id = ? LIMIT 1`,
    [userId]
  )
  return Boolean(row)
}

/* * 将 sync 结果映射为 sync_logs 行状态（含 warnings 可观测性） */
export function resolveGoogleAdsCampaignSyncLogOutcome(result: SyncResult): {
  status: 'success' | 'partial' | 'failed'
  errorMessage: string | null
} {
  const warningText = result.warnings.length > 0 ? result.warnings.join('; ') : null

  if (result.errors.length > 0) {
    const errorParts = result.errors.slice(0, 3).map((e) => `${e.campaignName}: ${e.error}`)
    if (warningText) {
      errorParts.push(warningText)
    }
    return {
      status: 'partial',
      errorMessage: errorParts.join('; '),
    }
  }

  if (warningText && result.syncedCount === 0) {
    return { status: 'partial', errorMessage: warningText }
  }

  return { status: 'success', errorMessage: warningText }
}
