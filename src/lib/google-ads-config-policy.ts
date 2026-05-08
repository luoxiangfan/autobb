import { getDatabase } from './db'

export type GoogleAdsConfigScope = 'tenant' | 'user'

const GOOGLE_ADS_CONFIG_SCOPE_KEY = 'config_scope'

function normalizeScope(raw: unknown): GoogleAdsConfigScope {
  return String(raw ?? '').trim().toLowerCase() === 'user' ? 'user' : 'tenant'
}

/**
 * 获取用户的 Google Ads 配置策略：
 * - tenant: 使用管理员配置，用户只读
 * - user: 用户可维护自己的配置
 */
export async function getGoogleAdsConfigScope(userId: number): Promise<GoogleAdsConfigScope> {
  const db = await getDatabase()
  const row = await db.queryOne(
    `
      SELECT value
      FROM system_settings
      WHERE user_id = ?
        AND category = 'google_ads'
        AND key = ?
      LIMIT 1
    `,
    [userId, GOOGLE_ADS_CONFIG_SCOPE_KEY]
  ) as { value?: string | null } | undefined

  return normalizeScope(row?.value)
}

/**
 * 管理员设置用户的 Google Ads 配置策略
 */
export async function setGoogleAdsConfigScope(
  userId: number,
  scope: GoogleAdsConfigScope
): Promise<void> {
  const db = await getDatabase()
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const normalizedScope = normalizeScope(scope)

  const updated = await db.exec(
    `
      UPDATE system_settings
      SET value = ?, updated_at = ${nowFunc}
      WHERE user_id = ?
        AND category = 'google_ads'
        AND key = ?
    `,
    [normalizedScope, userId, GOOGLE_ADS_CONFIG_SCOPE_KEY]
  )

  if (updated.changes > 0) {
    return
  }

  await db.exec(
    `
      INSERT INTO system_settings (
        user_id, category, key, value, data_type, is_sensitive, is_required, description, created_at, updated_at
      )
      VALUES (?, 'google_ads', ?, ?, 'string', 0, 0, ?, ${nowFunc}, ${nowFunc})
    `,
    [
      userId,
      GOOGLE_ADS_CONFIG_SCOPE_KEY,
      normalizedScope,
      'Google Ads 配置归属策略：tenant=管理员统一维护，user=用户可自行维护',
    ]
  )
}

/**
 * 当前用户是否可维护 Google Ads 配置
 * 管理员永远可维护；普通用户仅在 scope=user 时可维护。
 */
export async function canMaintainGoogleAdsConfig(userId: number, role?: string): Promise<boolean> {
  if (role === 'admin') return true
  const scope = await getGoogleAdsConfigScope(userId)
  return scope === 'user'
}
