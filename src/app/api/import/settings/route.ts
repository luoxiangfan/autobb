import { verifyAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { nowFunc as sqlNowFunc } from '@/lib/db-helpers'
import { z } from 'zod'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads-auth-assignment'
import {
  GOOGLE_ADS_OAUTH_CONFIG_KEYS,
  isGoogleAdsCredentialBackedSettingKey,
  isGoogleAdsSettingsAuthConflictError,
  isGoogleAdsSettingsValidationError,
  upsertGoogleAdsOAuthConfigFromSettings,
  type GoogleAdsOAuthConfigKey,
} from '@/lib/google-ads-settings-store'

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
export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized', message: '请先登录' }, { status: 401 })
    }
    const userIdNum = authResult.user.userId
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
    const nowSql = sqlNowFunc(db.type)

    const blockedKeys = ['google_ads:refresh_token', 'google_ads:access_token']

    let imported = 0
    let skipped = 0
    const errors: string[] = []
    const googleAdsOAuthFields: Partial<Record<GoogleAdsOAuthConfigKey, string>> = {}
    const genericEntries: ImportSettingEntry[] = []

    for (const [category, categorySettings] of Object.entries(settings)) {
      for (const [configKey, config] of Object.entries(categorySettings)) {
        const fullKey = `${category}:${configKey}`

        if (blockedKeys.includes(fullKey)) {
          skipped++
          errors.push(`跳过受保护的配置: ${fullKey}`)
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

    if (googleAdsFieldCount > 0) {
      try {
        await assertUserCanModifyGoogleAdsAuth(userIdNum, userIdNum, authResult.user.role)
        await upsertGoogleAdsOAuthConfigFromSettings(userIdNum, googleAdsOAuthFields)
        imported += googleAdsFieldCount
      } catch (error: unknown) {
        if (isGoogleAdsSettingsAuthConflictError(error)) {
          return NextResponse.json({ error: error.message }, { status: 409 })
        }
        if (isGoogleAdsSettingsValidationError(error)) {
          return NextResponse.json({ error: error.message }, { status: 400 })
        }
        const message = error instanceof Error ? error.message : '导入 Google Ads OAuth 配置失败'
        errors.push(message)
      }
    }

    for (const entry of genericEntries) {
      const { category, configKey, fullKey, value, dataType, isSensitive: configSensitive } = entry

      try {
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

        imported++
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '未知错误'
        errors.push(`导入 ${fullKey} 失败: ${message}`)
      }
    }

    const errorCount = errors.length
    const partial = imported > 0 && errorCount > 0
    const success = errorCount === 0

    return NextResponse.json({
      success,
      partial,
      message: success
        ? `成功导入 ${imported} 个配置项`
        : partial
          ? `部分导入成功：${imported} 项已写入，${errorCount} 项失败或受保护跳过`
          : `导入未完成：${errorCount} 项失败或受保护跳过`,
      summary: {
        imported,
        skipped,
        errors: errorCount,
      },
      errors: errorCount > 0 ? errors : undefined,
    })
  } catch (error: unknown) {
    console.error('导入配置失败:', error)
    const message = error instanceof Error ? error.message : '导入失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
