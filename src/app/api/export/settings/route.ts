import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { decrypt } from '@/lib/auth'
import {
  isGoogleAdsCredentialBackedSettingKey,
  overlayGoogleAdsOAuthFieldsForSettingsExport,
  type SettingsExportEntry,
} from '@/lib/google-ads/settings/settings-store'

/**
 * GET /api/export/settings
 * 导出用户的配置数据
 * 注意：敏感信息（如API密钥）会被脱敏处理
 */
export const dynamic = 'force-dynamic'

export const GET = withAuth(async (request, user) => {
  try {
    const userId = user.userId

    const { searchParams } = new URL(request.url)
    const includeSensitive = searchParams.get('include_sensitive') === 'true'

    const db = await getDatabase()
    const userIdNum = userId

    const settings = (await db.query(
      `
      SELECT
        category,
        key,
        value,
        encrypted_value,
        data_type,
        is_sensitive,
        is_required,
        description
      FROM system_settings
      WHERE user_id IS NULL OR user_id = ?
      ORDER BY category, key
    `,
      [userIdNum]
    )) as Array<{
      category: string
      key: string
      value: string | null
      encrypted_value: string | null
      data_type: string
      is_sensitive: number | boolean
      is_required: number | boolean
      description: string | null
    }>

    const settingsMap = new Map<string, (typeof settings)[number]>()
    for (const setting of settings) {
      const key = `${setting.category}:${setting.key}`
      settingsMap.set(key, setting)
    }

    const exportData: Record<string, Record<string, SettingsExportEntry>> = {}

    for (const setting of settingsMap.values()) {
      if (setting.category === 'google_ads' && isGoogleAdsCredentialBackedSettingKey(setting.key)) {
        continue
      }

      if (!exportData[setting.category]) {
        exportData[setting.category] = {}
      }

      let value = setting.value
      const isSensitive = setting.is_sensitive === true

      if (isSensitive) {
        if (includeSensitive && setting.encrypted_value) {
          try {
            value = decrypt(setting.encrypted_value)
          } catch {
            value = null
          }
        } else if (setting.encrypted_value) {
          try {
            const decrypted = decrypt(setting.encrypted_value)
            if (decrypted && decrypted.length > 8) {
              value = decrypted.substring(0, 4) + '****' + decrypted.substring(decrypted.length - 4)
            } else {
              value = '****'
            }
          } catch {
            value = '****'
          }
        } else {
          value = null
        }
      }

      exportData[setting.category][setting.key] = {
        value,
        dataType: setting.data_type,
        isSensitive,
        description: setting.description,
      }
    }

    await overlayGoogleAdsOAuthFieldsForSettingsExport(exportData, userIdNum, {
      includeSensitive,
    })

    const exportPayload = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      userId: userIdNum,
      includeSensitive,
      notes: {
        googleAdsOAuthRequiresReauth:
          'OAuth refresh_token 不会导出；导入后须在设置页重新完成 OAuth 授权才能调用 Google Ads API。',
        googleAdsServiceAccountNotIncluded:
          '服务账号请使用「Google Ads 服务账号备份」单独导出（/api/export/google-ads-service-account）。',
      },
      settings: exportData,
    }

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="settings_${new Date().toISOString().split('T')[0]}.json"`,
      },
    })
  } catch (error: unknown) {
    console.error('导出配置失败:', error)
    const message = error instanceof Error ? error.message : '导出失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
})
