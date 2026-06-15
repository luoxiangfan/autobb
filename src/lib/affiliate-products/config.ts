import { getDatabase } from '@/lib/db'
import { getUserOnlySetting } from '@/lib/common'
import { resolveAffiliateSettingCategory } from '@/lib/openclaw/settings'
import type { AffiliatePlatform } from './types'
import { PLATFORM_KEY_REQUIREMENTS, type PlatformConfigCheck } from './constants'

export async function getUserScopedSettingMap(
  userId: number,
  keys: string[]
): Promise<Record<string, string>> {
  const values = await Promise.all(
    keys.map(async (key) => {
      const category = resolveAffiliateSettingCategory(key)
      const record = await getUserOnlySetting(category, key, userId)
      return [key, (record?.value || '').trim()] as const
    })
  )

  return values.reduce<Record<string, string>>((acc, [key, value]) => {
    acc[key] = value
    return acc
  }, {})
}

export async function upsertUserSystemSetting(params: {
  userId: number
  key: string
  value: string
  description: string
}): Promise<void> {
  const db = await getDatabase()
  const nowExpr = 'NOW()'
  const falseValue = false

  const existing = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM system_settings
      WHERE user_id = ?
        AND category = 'system'
        AND key = ?
      LIMIT 1
    `,
    [params.userId, params.key]
  )

  if (existing?.id) {
    await db.exec(
      `
        UPDATE system_settings
        SET value = ?, updated_at = ${nowExpr}
        WHERE id = ?
      `,
      [params.value, existing.id]
    )
    return
  }

  await db.exec(
    `
      INSERT INTO system_settings (
        user_id,
        category,
        key,
        value,
        data_type,
        is_sensitive,
        is_required,
        description
      ) VALUES (?, 'system', ?, ?, 'string', ?, ?, ?)
    `,
    [params.userId, params.key, params.value, falseValue, falseValue, params.description]
  )
}

export async function checkAffiliatePlatformConfig(
  userId: number,
  platform: AffiliatePlatform
): Promise<PlatformConfigCheck> {
  const requiredKeys = PLATFORM_KEY_REQUIREMENTS[platform]
  const optionalKeys =
    platform === 'partnerboost'
      ? [
          'partnerboost_base_url',
          'partnerboost_products_page_size',
          'partnerboost_products_page',
          'partnerboost_products_default_filter',
          'partnerboost_products_country_code',
          'partnerboost_products_brand_id',
          'partnerboost_products_sort',
          'partnerboost_products_asins',
          'partnerboost_products_relationship',
          'partnerboost_products_is_original_currency',
          'partnerboost_products_has_promo_code',
          'partnerboost_products_has_acc',
          'partnerboost_products_filter_sexual_wellness',
          'partnerboost_products_link_batch_size',
          'partnerboost_asin_link_batch_size',
          'partnerboost_request_delay_ms',
          'partnerboost_rate_limit_max_retries',
          'partnerboost_rate_limit_base_delay_ms',
          'partnerboost_rate_limit_max_delay_ms',
          'partnerboost_link_country_code',
          'partnerboost_link_uid',
          'partnerboost_link_return_partnerboost_link',
        ]
      : [
          'yeahpromos_start_date',
          'yeahpromos_end_date',
          'yeahpromos_is_amazon',
          'yeahpromos_page',
          'yeahpromos_limit',
          'yeahpromos_request_delay_ms',
          'yeahpromos_rate_limit_max_retries',
          'yeahpromos_rate_limit_base_delay_ms',
          'yeahpromos_rate_limit_max_delay_ms',
          'yeahpromos_marketplace_templates_json',
        ]

  const values = await getUserScopedSettingMap(userId, [...requiredKeys, ...optionalKeys])
  const missingKeys = requiredKeys.filter((key) => !values[key])

  return {
    configured: missingKeys.length === 0,
    missingKeys,
    values,
  }
}
