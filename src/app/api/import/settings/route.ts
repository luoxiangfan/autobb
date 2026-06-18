import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { encrypt } from '@/lib/auth'
import { nowFunc as sqlNowFunc } from '@/lib/db'
import { z } from 'zod'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads/auth/assignment'
import {
  GOOGLE_ADS_OAUTH_CONFIG_KEYS,
  isGoogleAdsCredentialBackedSettingKey,
  isGoogleAdsSettingsAuthConflictError,
  isGoogleAdsSettingsValidationError,
  upsertGoogleAdsOAuthConfigFromSettings,
  type GoogleAdsOAuthConfigKey,
} from '@/lib/google-ads/settings/settings-store'

// 配置导入验证Schema
const importSettingsSchema = z.object({
  version: z.string().optional(),
  settings: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        value: z.union([z.string(), z.null()]),
        dataType: z.string().optional(),
        isSensitive: z.boolean().optional(),
        description: z.string().optional(),
      })
    )
  ),
})

type ImportSettingEntry = {
  category: string
  configKey: string
  fullKey: string
  value: string
  dataType?: string
  isSensitive?: boolean
}

/**
 * POST /api/import/settings
 * 导入用户配置数据
 */
export const POST = withAuth(async (request, user) => {
  try {
    const userIdNum = user.userId
    const body = await request.json()

    const validationResult = importSettingsSchema.safeParse(body)
    if (!validationResult.success) {
      return NextResponse.json(
        {
          error: '无效的配置文件格式',
          details: validationResult.error.issues,
        },
        { status: 400 }
      )
    }

    const { settings } = validationResult.data
    const db = await getDatabase()
    const nowSql = sqlNowFunc()

    const blockedKeys = ['google_ads:refresh_token', 'google_ads:access_token']

    let imported = 0
    let skipped = 0
    const errors: string[] = []
    const warnings: string[] = []
    const googleAdsOAuthFields: Partial<Record<GoogleAdsOAuthConfigKey, string>> = {}
    const genericEntries: ImportSettingEntry[] = []

    for (const [category, categorySettings] of Object.entries(settings)) {
      for (const [configKey, config] of Object.entries(categorySettings)) {
        const fullKey = `${category}:${configKey}`

        if (blockedKeys.includes(fullKey)) {
          skipped++
          warnings.push(`跳过受保护的配置: ${fullKey}`)
          continue
        }

        if (config.value && config.value.includes('****')) {
          skipped++
          continue
        }

        if (config.value === null || config.value === '') {
          skipped++
          continue
        }

        if (category === 'google_ads' && isGoogleAdsCredentialBackedSettingKey(configKey)) {
          googleAdsOAuthFields[configKey as GoogleAdsOAuthConfigKey] = config.value
          continue
        }

        genericEntries.push({
          category,
          configKey,
          fullKey,
          value: config.value,
          dataType: config.dataType,
          isSensitive: config.isSensitive,
        })
      }
    }

    const googleAdsFieldCount = GOOGLE_ADS_OAUTH_CONFIG_KEYS.filter((key) =>
      googleAdsOAuthFields[key]?.trim()
    ).length

    const importGenericEntry = async (entry: ImportSettingEntry) => {
      const { category, configKey, value, dataType, isSensitive: configSensitive } = entry

      const existing = await db.queryOne<{ id: number; is_sensitive: number | boolean }>(
        `
            SELECT id, is_sensitive FROM system_settings
            WHERE category = ? AND key = ? AND (user_id IS NULL OR user_id = ?)
            ORDER BY user_id DESC LIMIT 1
          `,
        [category, configKey, userIdNum]
      )

      const isSensitive =
        configSensitive || existing?.is_sensitive === 1 || existing?.is_sensitive === true

      if (existing) {
        if (isSensitive) {
          await db.exec(
            `
                UPDATE system_settings
                SET encrypted_value = ?, value = NULL, updated_at = ${nowSql}
                WHERE category = ? AND key = ? AND (user_id IS NULL OR user_id = ?)
              `,
            [encrypt(value), category, configKey, userIdNum]
          )
        } else {
          await db.exec(
            `
                UPDATE system_settings
                SET value = ?, updated_at = ${nowSql}
                WHERE category = ? AND key = ? AND (user_id IS NULL OR user_id = ?)
              `,
            [value, category, configKey, userIdNum]
          )
        }
      } else if (isSensitive) {
        await db.exec(
          `
              INSERT INTO system_settings (user_id, category, key, encrypted_value, data_type, is_sensitive, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 1, ${nowSql}, ${nowSql})
            `,
          [userIdNum, category, configKey, encrypt(value), dataType || 'string']
        )
      } else {
        await db.exec(
          `
              INSERT INTO system_settings (user_id, category, key, value, data_type, is_sensitive, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, 0, ${nowSql}, ${nowSql})
            `,
          [userIdNum, category, configKey, value, dataType || 'string']
        )
      }
    }

    const genericEntryCount = genericEntries.length
    const hasDbWork = googleAdsFieldCount > 0 || genericEntryCount > 0

    if (hasDbWork) {
      try {
        if (googleAdsFieldCount > 0) {
          await assertUserCanModifyGoogleAdsAuth(userIdNum, userIdNum, user.role)
        }

        await db.transaction(async () => {
          if (googleAdsFieldCount > 0) {
            await upsertGoogleAdsOAuthConfigFromSettings(userIdNum, googleAdsOAuthFields, {
              db,
              skipAuthContextInvalidate: true,
            })
          }
          for (const entry of genericEntries) {
            await importGenericEntry(entry)
          }
        })

        if (googleAdsFieldCount > 0) {
          const { invalidateGoogleAdsAuthContextForCredentialUser } =
            await import('@/lib/google-ads/auth/context')
          await invalidateGoogleAdsAuthContextForCredentialUser(userIdNum)
        }

        imported += googleAdsFieldCount + genericEntryCount
      } catch (error: unknown) {
        if (isGoogleAdsSettingsAuthConflictError(error)) {
          return NextResponse.json({ error: error.message }, { status: 409 })
        }
        if (isGoogleAdsSettingsValidationError(error)) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        const message = error instanceof Error ? error.message : '导入配置失败'
        errors.push(message)
      }
    }

    const errorCount = errors.length
    const warningCount = warnings.length
    const partial = imported > 0 && errorCount > 0
    const success = errorCount === 0

    return NextResponse.json({
      success,
      partial,
      message: success
        ? warningCount > 0
          ? `成功导入 ${imported} 个配置项（${warningCount} 条提示）`
          : `成功导入 ${imported} 个配置项`
        : partial
          ? `部分导入成功：${imported} 项已写入，${errorCount} 项失败`
          : `导入未完成：${errorCount} 项失败`,
      summary: {
        imported,
        skipped,
        errors: errorCount,
        warnings: warningCount,
      },
      errors: errorCount > 0 ? errors : undefined,
      warnings: warningCount > 0 ? warnings : undefined,
    })
  } catch (error: unknown) {
    console.error('导入配置失败:', error)
    const message = error instanceof Error ? error.message : '导入失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
