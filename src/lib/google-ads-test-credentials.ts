import { getDatabase } from './db'
import { formatAndValidateLoginCustomerId } from './google-ads-oauth'

export interface GoogleAdsTestCredentials {
  id: number
  user_id: number
  client_id: string
  client_secret: string
  refresh_token: string
  access_token?: string | null
  developer_token: string
  login_customer_id: string | null
  access_token_expires_at?: string | null
  is_active: number | boolean
  last_verified_at?: string | null
  created_at: string
  updated_at: string
}

function isActiveFlag(value: number | boolean | null | undefined): boolean {
  return value === true || value === 1
}

export async function getGoogleAdsTestCredentials(userId: number): Promise<GoogleAdsTestCredentials | null> {
  const db = await getDatabase()
  const isActiveCondition = db.type === 'postgres' ? 'is_active = true' : 'is_active = 1'

  const credentials = await db.queryOne<GoogleAdsTestCredentials>(`
    SELECT * FROM google_ads_test_credentials
    WHERE user_id = ? AND ${isActiveCondition}
  `, [userId])

  return credentials || null
}

export async function saveGoogleAdsTestCredentials(
  userId: number,
  credentials: {
    client_id: string
    client_secret: string
    refresh_token: string
    developer_token: string
    login_customer_id: string
    access_token?: string
    access_token_expires_at?: string
  }
): Promise<GoogleAdsTestCredentials> {
  const db = await getDatabase()

  const formattedLoginCustomerId = formatAndValidateLoginCustomerId(credentials.login_customer_id, 'test_login_customer_id')
  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const isActiveValue = db.type === 'postgres' ? true : 1

  const existing = await db.queryOne<GoogleAdsTestCredentials>(`
    SELECT * FROM google_ads_test_credentials WHERE user_id = ?
  `, [userId])

  if (existing) {
    await db.exec(`
      UPDATE google_ads_test_credentials
      SET client_id = ?,
          client_secret = ?,
          refresh_token = ?,
          developer_token = ?,
          login_customer_id = ?,
          access_token = ?,
          access_token_expires_at = ?,
          is_active = ?,
          last_verified_at = ${nowFunc},
          updated_at = ${nowFunc}
      WHERE user_id = ?
    `, [
      credentials.client_id,
      credentials.client_secret,
      credentials.refresh_token,
      credentials.developer_token,
      formattedLoginCustomerId,
      credentials.access_token || null,
      credentials.access_token_expires_at || null,
      isActiveValue,
      userId
    ])
  } else {
    await db.exec(`
      INSERT INTO google_ads_test_credentials (
        user_id, client_id, client_secret, refresh_token,
        developer_token, login_customer_id, access_token, access_token_expires_at,
        last_verified_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc})
    `, [
      userId,
      credentials.client_id,
      credentials.client_secret,
      credentials.refresh_token,
      credentials.developer_token,
      formattedLoginCustomerId,
      credentials.access_token || null,
      credentials.access_token_expires_at || null
    ])
  }

  const updated = await getGoogleAdsTestCredentials(userId)
  if (!updated) {
    throw new Error('保存Google Ads 测试凭证失败')
  }
  return updated
}

export async function deleteGoogleAdsTestCredentials(userId: number): Promise<void> {
  const db = await getDatabase()

  const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const isActiveValue = db.type === 'postgres' ? false : 0

  await db.exec(`
    UPDATE google_ads_test_credentials
    SET is_active = ?,
        refresh_token = ?,
        access_token = NULL,
        access_token_expires_at = NULL,
        last_verified_at = NULL,
        client_id = ?,
        client_secret = ?,
        developer_token = ?,
        login_customer_id = NULL,
        updated_at = ${nowFunc}
    WHERE user_id = ?
  `, [isActiveValue, '', '', '', '', userId])
}

export async function getGoogleAdsTestCredentialStatus(userId: number): Promise<{
  hasCredentials: boolean
  hasRefreshToken: boolean
  loginCustomerId?: string
  lastVerifiedAt?: string | null
  isActive?: boolean
  createdAt?: string
  updatedAt?: string
}> {
  const credentials = await getGoogleAdsTestCredentials(userId)
  if (!credentials) {
    return {
      hasCredentials: false,
      hasRefreshToken: false,
    }
  }

  return {
    hasCredentials: true,
    hasRefreshToken: !!credentials.refresh_token,
    loginCustomerId: credentials.login_customer_id || undefined,
    lastVerifiedAt: credentials.last_verified_at || null,
    isActive: isActiveFlag(credentials.is_active),
    createdAt: credentials.created_at,
    updatedAt: credentials.updated_at,
  }
}
