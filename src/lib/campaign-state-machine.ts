import { getDatabase } from './db'
import { markUrlSwapTargetsRemovedByCampaignId } from './url-swap'

export type CampaignServeStatus = 'ENABLED' | 'PAUSED' | 'REMOVED'
export type CampaignCreationStatus = 'draft' | 'pending' | 'synced' | 'failed'

export type CampaignRemovedReason =
  | 'offline'
  | 'draft_delete'
  | 'offer_unlink'
  | 'offer_delete'
  | 'publish_failed'
  | 'unknown_removed'

type NowToken = 'NOW'

export type CampaignTransitionAction =
  | 'PUBLISH_QUEUED'
  | 'PUBLISH_SUCCEEDED'
  | 'PUBLISH_FAILED'
  | 'TOGGLE_STATUS'
  | 'OFFLINE'
  | 'DRAFT_DELETE'
  | 'OFFER_UNLINK'
  | 'OFFER_DELETE'
  | 'CIRCUIT_BREAK_PAUSE'
  | 'PAUSE_OLD_CAMPAIGNS'

export type CampaignTransitionPayload = {
  finalStatus?: CampaignServeStatus
  status?: 'ENABLED' | 'PAUSED'
  googleCampaignId?: string | null
  googleAdGroupId?: string | null
  googleAdId?: string | null
  creationError?: string | null
  errorMessage?: string
  removedReason?: CampaignRemovedReason | string | null
}

export type CampaignStatePatch = {
  status?: CampaignServeStatus
  creationStatus?: CampaignCreationStatus
  creationError?: string | null
  isDeleted?: boolean
  deletedAt?: string | null | NowToken
  publishedAt?: string | null | NowToken
  lastSyncAt?: string | null | NowToken
  campaignId?: string | null
  googleCampaignId?: string | null
  googleAdGroupId?: string | null
  googleAdId?: string | null
  removedReason?: string | null
}

const nowToken: NowToken = 'NOW'

export function buildCampaignTransitionPatch(
  action: CampaignTransitionAction,
  payload?: CampaignTransitionPayload
): CampaignStatePatch {
  switch (action) {
    case 'PUBLISH_QUEUED':
      return {
        status: 'PAUSED',
        creationStatus: 'pending',
        creationError: null,
        isDeleted: false,
        deletedAt: null,
        removedReason: null,
      }

    case 'PUBLISH_SUCCEEDED':
      return {
        status: payload?.finalStatus === 'ENABLED' ? 'ENABLED' : 'PAUSED',
        creationStatus: 'synced',
        creationError: payload?.creationError ?? null,
        isDeleted: false,
        deletedAt: null,
        removedReason: null,
        campaignId: payload?.googleCampaignId ?? null,
        googleCampaignId: payload?.googleCampaignId ?? null,
        googleAdGroupId: payload?.googleAdGroupId ?? null,
        googleAdId: payload?.googleAdId ?? null,
        publishedAt: nowToken,
        lastSyncAt: nowToken,
      }

    case 'PUBLISH_FAILED':
      return {
        status: 'REMOVED',
        creationStatus: 'failed',
        creationError: payload?.errorMessage || payload?.creationError || '发布失败',
        removedReason: payload?.removedReason || 'publish_failed',
      }

    case 'TOGGLE_STATUS':
      return {
        status: payload?.status === 'ENABLED' ? 'ENABLED' : 'PAUSED',
      }

    case 'OFFLINE':
      return {
        status: 'REMOVED',
        removedReason: payload?.removedReason || 'offline',
      }

    case 'DRAFT_DELETE':
      return {
        status: 'REMOVED',
        isDeleted: true,
        deletedAt: nowToken,
        removedReason: payload?.removedReason || 'draft_delete',
      }

    case 'OFFER_UNLINK':
      return {
        status: 'REMOVED',
        removedReason: payload?.removedReason || 'offer_unlink',
      }

    case 'OFFER_DELETE':
      return {
        status: 'REMOVED',
        isDeleted: true,
        deletedAt: nowToken,
        removedReason: payload?.removedReason || 'offer_delete',
      }

    case 'CIRCUIT_BREAK_PAUSE':
    case 'PAUSE_OLD_CAMPAIGNS':
      return {
        status: 'PAUSED',
      }

    default:
      return {}
  }
}

export function normalizeCampaignTransitionPatch(patch: CampaignStatePatch): CampaignStatePatch {
  const normalized: CampaignStatePatch = { ...patch }

  if (normalized.isDeleted === true) {
    normalized.status = 'REMOVED'
    if (normalized.deletedAt === undefined) {
      normalized.deletedAt = nowToken
    }
  }

  if (normalized.creationStatus === 'draft') {
    normalized.status = normalized.status || 'PAUSED'
    normalized.creationError = null
    normalized.campaignId = null
    normalized.googleCampaignId = null
    normalized.googleAdGroupId = null
    normalized.googleAdId = null
  }

  if (normalized.creationStatus === 'pending' && !normalized.status) {
    normalized.status = 'PAUSED'
  }

  if (normalized.creationStatus === 'failed' && !normalized.status) {
    normalized.status = 'PAUSED'
  }

  if (normalized.status === 'ENABLED' && !normalized.creationStatus) {
    normalized.creationStatus = 'synced'
  }

  if (normalized.creationStatus === 'synced' && normalized.creationError === undefined) {
    normalized.creationError = null
  }

  if (normalized.status && normalized.status !== 'REMOVED' && normalized.removedReason === undefined) {
    normalized.removedReason = null
  }

  return normalized
}

const dedupeCampaignIds = (campaignIds: number[]) => {
  const uniq = new Set<number>()
  campaignIds.forEach((id) => {
    if (Number.isFinite(id) && id > 0) {
      uniq.add(id)
    }
  })
  return Array.from(uniq)
}

const normalizeGoogleCampaignIds = (ids: string[]) => {
  const uniq = new Set<string>()
  ids.forEach((id) => {
    const normalized = String(id || '').trim()
    if (normalized) uniq.add(normalized)
  })
  return Array.from(uniq)
}

const sqlNowExpr = (dbType: 'sqlite' | 'postgres') =>
  dbType === 'postgres' ? 'NOW()' : "datetime('now')"

const sqlPublishedAtNowExpr = (dbType: 'sqlite' | 'postgres') =>
  dbType === 'postgres'
    ? "COALESCE(NULLIF(published_at::text, '')::timestamptz, NOW())"
    : "COALESCE(NULLIF(published_at, ''), datetime('now'))"

type PatchSqlField =
  | { sql: string; type: 'param'; value: any }
  | { sql: string; type: 'raw' }

const toPatchSqlFields = (patch: CampaignStatePatch, dbType: 'sqlite' | 'postgres'): PatchSqlField[] => {
  const nowExpr = sqlNowExpr(dbType)
  const fields: PatchSqlField[] = []

  if (patch.status !== undefined) {
    fields.push({ sql: 'status = ?', type: 'param', value: patch.status })
  }

  if (patch.creationStatus !== undefined) {
    fields.push({ sql: 'creation_status = ?', type: 'param', value: patch.creationStatus })
  }

  if (patch.creationError !== undefined) {
    fields.push({ sql: 'creation_error = ?', type: 'param', value: patch.creationError })
  }

  if (patch.isDeleted !== undefined) {
    fields.push({ sql: 'is_deleted = ?', type: 'param', value: patch.isDeleted })
  }

  if (patch.deletedAt !== undefined) {
    if (patch.deletedAt === nowToken) {
      fields.push({ sql: `deleted_at = ${nowExpr}`, type: 'raw' })
    } else if (patch.deletedAt === null) {
      fields.push({ sql: 'deleted_at = NULL', type: 'raw' })
    } else {
      fields.push({ sql: 'deleted_at = ?', type: 'param', value: patch.deletedAt })
    }
  }

  if (patch.publishedAt !== undefined) {
    if (patch.publishedAt === nowToken) {
      fields.push({
        sql: `published_at = ${sqlPublishedAtNowExpr(dbType)}`,
        type: 'raw',
      })
    } else if (patch.publishedAt === null) {
      fields.push({ sql: 'published_at = NULL', type: 'raw' })
    } else {
      fields.push({ sql: 'published_at = ?', type: 'param', value: patch.publishedAt })
    }
  }

  if (patch.lastSyncAt !== undefined) {
    if (patch.lastSyncAt === nowToken) {
      fields.push({ sql: `last_sync_at = ${nowExpr}`, type: 'raw' })
    } else if (patch.lastSyncAt === null) {
      fields.push({ sql: 'last_sync_at = NULL', type: 'raw' })
    } else {
      fields.push({ sql: 'last_sync_at = ?', type: 'param', value: patch.lastSyncAt })
    }
  }

  if (patch.campaignId !== undefined) {
    fields.push({ sql: 'campaign_id = ?', type: 'param', value: patch.campaignId })
  }

  if (patch.googleCampaignId !== undefined) {
    fields.push({ sql: 'google_campaign_id = ?', type: 'param', value: patch.googleCampaignId })
  }

  if (patch.googleAdGroupId !== undefined) {
    fields.push({ sql: 'google_ad_group_id = ?', type: 'param', value: patch.googleAdGroupId })
  }

  if (patch.googleAdId !== undefined) {
    fields.push({ sql: 'google_ad_id = ?', type: 'param', value: patch.googleAdId })
  }

  if (patch.removedReason !== undefined) {
    fields.push({ sql: 'removed_reason = ?', type: 'param', value: patch.removedReason })
  }

  fields.push({ sql: `updated_at = ${nowExpr}`, type: 'raw' })

  return fields
}

export async function applyCampaignTransition(params: {
  userId: number
  campaignId: number
  action: CampaignTransitionAction
  payload?: CampaignTransitionPayload
}) {
  return applyCampaignTransitionByIds({
    userId: params.userId,
    campaignIds: [params.campaignId],
    action: params.action,
    payload: params.payload,
  })
}

export async function applyCampaignTransitionByIds(params: {
  userId: number
  campaignIds: number[]
  action: CampaignTransitionAction
  payload?: CampaignTransitionPayload
}) {
  const uniqueCampaignIds = dedupeCampaignIds(params.campaignIds)

  if (uniqueCampaignIds.length === 0) {
    return {
      updatedCount: 0,
      matchedCampaignIds: [] as number[],
    }
  }

  const db = await getDatabase()

  const basePatch = buildCampaignTransitionPatch(params.action, params.payload)
  const patch = normalizeCampaignTransitionPatch(basePatch)
  const sqlFields = toPatchSqlFields(patch, db.type)

  const setFragments: string[] = []
  const values: any[] = []

  sqlFields.forEach((field) => {
    setFragments.push(field.sql)
    if (field.type === 'param') {
      values.push(field.value)
    }
  })

  const inPlaceholders = uniqueCampaignIds.map(() => '?').join(', ')

  const result = await db.exec(
    `
      UPDATE campaigns
      SET ${setFragments.join(', ')}
      WHERE user_id = ?
        AND id IN (${inPlaceholders})
    `,
    [...values, params.userId, ...uniqueCampaignIds]
  )

  if (patch.status === 'REMOVED') {
    for (const campaignId of uniqueCampaignIds) {
      await markUrlSwapTargetsRemovedByCampaignId(campaignId, params.userId)
    }
  }

  return {
    updatedCount: result.changes || 0,
    matchedCampaignIds: uniqueCampaignIds,
  }
}

export async function applyCampaignTransitionByGoogleCampaignIds(params: {
  userId: number
  googleCampaignIds: string[]
  action: CampaignTransitionAction
  payload?: CampaignTransitionPayload
  googleAdsAccountId?: number
}) {
  const normalizedIds = normalizeGoogleCampaignIds(params.googleCampaignIds)

  if (normalizedIds.length === 0) {
    return {
      updatedCount: 0,
      matchedCampaignIds: [] as number[],
    }
  }

  const db = await getDatabase()
  const placeholders = normalizedIds.map(() => '?').join(', ')

  const queryParams: any[] = [params.userId]
  let accountFilterSql = ''

  if (params.googleAdsAccountId !== undefined) {
    accountFilterSql = 'AND google_ads_account_id = ?'
    queryParams.push(params.googleAdsAccountId)
  }

  const rows = await db.query<{ id: number }>(
    `
      SELECT id
      FROM campaigns
      WHERE user_id = ?
        ${accountFilterSql}
        AND (
          (google_campaign_id IS NOT NULL AND google_campaign_id IN (${placeholders}))
          OR (campaign_id IS NOT NULL AND campaign_id IN (${placeholders}))
        )
    `,
    [...queryParams, ...normalizedIds, ...normalizedIds]
  )

  const campaignIds = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id))

  return applyCampaignTransitionByIds({
    userId: params.userId,
    campaignIds,
    action: params.action,
    payload: params.payload,
  })
}
