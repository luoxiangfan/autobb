import { z } from 'zod'
import { encrypt } from '../../crypto'
import {
  parseServiceAccountJson,
  replaceGoogleAdsServiceAccountForUser,
  type ReplaceGoogleAdsServiceAccountParams,
} from '@/lib/google-ads/service-account/service-account'
import { assertNoConflictingGoogleAdsAuth } from '@/lib/google-ads/auth/context'

export const GOOGLE_ADS_SERVICE_ACCOUNT_BACKUP_TYPE = 'google_ads_service_account' as const
export const GOOGLE_ADS_SERVICE_ACCOUNT_BACKUP_VERSION = '1.0' as const

export type GoogleAdsServiceAccountBackupEntry = {
  name: string
  mccCustomerId: string
  developerToken: string | null
  serviceAccountEmail: string
  projectId: string | null
  apiAccessLevel?: string
  /** 完整 Google Cloud 服务账号 JSON（仅 includeSensitive 导出） */
  serviceAccountJson: string | null
}

export type GoogleAdsServiceAccountBackupPayload = {
  version: typeof GOOGLE_ADS_SERVICE_ACCOUNT_BACKUP_VERSION
  type: typeof GOOGLE_ADS_SERVICE_ACCOUNT_BACKUP_TYPE
  exportedAt: string
  userId: number
  includeSensitive: boolean
  notes: {
    requiresIncludeSensitiveForRestore: string
    settingsBackupSeparate: string
  }
  serviceAccount: GoogleAdsServiceAccountBackupEntry
}

export class GoogleAdsServiceAccountBackupValidationError extends Error {
  readonly name = 'GoogleAdsServiceAccountBackupValidationError'

  constructor(message: string) {
    super(message)
  }
}

export class GoogleAdsServiceAccountBackupConflictError extends GoogleAdsServiceAccountBackupValidationError {
  readonly conflict = true
}

export function isGoogleAdsServiceAccountBackupValidationError(
  error: unknown
): error is GoogleAdsServiceAccountBackupValidationError {
  return error instanceof GoogleAdsServiceAccountBackupValidationError
}

export function isGoogleAdsServiceAccountBackupConflictError(
  error: unknown
): error is GoogleAdsServiceAccountBackupConflictError {
  return error instanceof GoogleAdsServiceAccountBackupConflictError
}

const serviceAccountEntrySchema = z.object({
  name: z.string().min(1),
  mccCustomerId: z.string().min(1),
  developerToken: z.string().min(1),
  serviceAccountEmail: z.string().optional(),
  projectId: z.string().nullable().optional(),
  apiAccessLevel: z.string().optional(),
  serviceAccountJson: z.string().min(1),
})

export const googleAdsServiceAccountBackupImportSchema = z.object({
  version: z.string().optional(),
  type: z.literal(GOOGLE_ADS_SERVICE_ACCOUNT_BACKUP_TYPE).optional(),
  serviceAccount: serviceAccountEntrySchema,
})

export type GoogleAdsServiceAccountBackupImportInput = z.infer<
  typeof googleAdsServiceAccountBackupImportSchema
>

function maskSensitiveBackupValue(raw: string): string {
  if (raw.length > 8) {
    return `${raw.slice(0, 4)}****${raw.slice(-4)}`
  }
  return '****'
}

function looksMasked(value: string): boolean {
  return value.includes('****')
}

export function buildServiceAccountJsonForBackup(params: {
  serviceAccountEmail: string
  privateKey: string
  projectId?: string | null
}): string {
  return JSON.stringify({
    type: 'service_account',
    project_id: params.projectId ?? undefined,
    private_key: params.privateKey,
    client_email: params.serviceAccountEmail,
  })
}

export function buildGoogleAdsServiceAccountBackupPayload(params: {
  userId: number
  includeSensitive: boolean
  account: {
    name: string
    mccCustomerId: string
    developerToken: string
    serviceAccountEmail: string
    privateKey: string
    projectId?: string | null
    apiAccessLevel?: string
  }
}): GoogleAdsServiceAccountBackupPayload {
  const { userId, includeSensitive, account } = params

  return {
    version: GOOGLE_ADS_SERVICE_ACCOUNT_BACKUP_VERSION,
    type: GOOGLE_ADS_SERVICE_ACCOUNT_BACKUP_TYPE,
    exportedAt: new Date().toISOString(),
    userId,
    includeSensitive,
    notes: {
      requiresIncludeSensitiveForRestore:
        '恢复服务账号须导出时勾选「包含敏感信息」，否则备份不含 private_key，无法导入。',
      settingsBackupSeparate:
        'OAuth 与其它 system_settings 请使用 settings 导出；本文件仅含 Google Ads 服务账号配置。',
    },
    serviceAccount: {
      name: account.name,
      mccCustomerId: account.mccCustomerId,
      developerToken: includeSensitive
        ? account.developerToken
        : maskSensitiveBackupValue(account.developerToken),
      serviceAccountEmail: account.serviceAccountEmail,
      projectId: account.projectId ?? null,
      ...(account.apiAccessLevel ? { apiAccessLevel: account.apiAccessLevel } : {}),
      serviceAccountJson: includeSensitive
        ? buildServiceAccountJsonForBackup({
            serviceAccountEmail: account.serviceAccountEmail,
            privateKey: account.privateKey,
            projectId: account.projectId,
          })
        : null,
    },
  }
}

function assertRestorableBackupEntry(
  entry: GoogleAdsServiceAccountBackupImportInput['serviceAccount']
): void {
  if (looksMasked(entry.developerToken) || looksMasked(entry.serviceAccountJson)) {
    throw new GoogleAdsServiceAccountBackupValidationError(
      '备份文件不含完整敏感信息，请使用勾选「包含敏感信息」导出的文件后再导入'
    )
  }
}

export async function importGoogleAdsServiceAccountFromBackup(
  userId: number,
  input: GoogleAdsServiceAccountBackupImportInput
): Promise<{ serviceAccountId: string }> {
  const parsed = googleAdsServiceAccountBackupImportSchema.parse(input)
  assertRestorableBackupEntry(parsed.serviceAccount)

  try {
    await assertNoConflictingGoogleAdsAuth(userId, 'service_account')
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : '当前已配置 OAuth 认证，无法导入服务账号'
    throw new GoogleAdsServiceAccountBackupConflictError(message)
  }

  let parsedJson: ReturnType<typeof parseServiceAccountJson>
  try {
    parsedJson = parseServiceAccountJson(parsed.serviceAccount.serviceAccountJson)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '无效的服务账号 JSON'
    throw new GoogleAdsServiceAccountBackupValidationError(message)
  }

  const { clientEmail, privateKey, projectId } = parsedJson

  if (
    parsed.serviceAccount.serviceAccountEmail &&
    parsed.serviceAccount.serviceAccountEmail.trim().toLowerCase() !==
      clientEmail.trim().toLowerCase()
  ) {
    throw new GoogleAdsServiceAccountBackupValidationError(
      'serviceAccountEmail 与 serviceAccountJson.client_email 不一致'
    )
  }

  const replaceParams: ReplaceGoogleAdsServiceAccountParams = {
    name: parsed.serviceAccount.name.trim(),
    mccCustomerId: parsed.serviceAccount.mccCustomerId.trim(),
    developerToken: parsed.serviceAccount.developerToken.trim(),
    serviceAccountEmail: clientEmail,
    encryptedPrivateKey: encrypt(privateKey),
    projectId: projectId ?? parsed.serviceAccount.projectId ?? null,
  }

  const serviceAccountId = await replaceGoogleAdsServiceAccountForUser(userId, replaceParams)
  return { serviceAccountId }
}
