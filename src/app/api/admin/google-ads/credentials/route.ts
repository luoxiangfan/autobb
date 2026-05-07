import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyAuth } from '@/lib/auth'
import { clearUserSettings, updateSetting } from '@/lib/settings'
import { getDatabase } from '@/lib/db'
import { deleteGoogleAdsCredentials } from '@/lib/google-ads-oauth'
import {
  getGoogleAdsCredentialSource,
  getOrgSharedGoogleAdsAppCredentials,
} from '@/lib/google-ads-credential-policy'

export const dynamic = 'force-dynamic'

function maskSecret(value: string, visiblePrefix = 6): string {
  const v = String(value || '')
  if (!v) return ''
  if (v.length <= visiblePrefix) return '***'
  return `${v.slice(0, visiblePrefix)}…`
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    if (auth.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const org = await getOrgSharedGoogleAdsAppCredentials()
    const db = await getDatabase()

    const users = await db.query(
      `
      SELECT u.id, u.username, u.email
      FROM users u
      ORDER BY u.id ASC
      `
    ) as Array<{ id: number; username: string | null; email: string | null }>

    const rows = []
    for (const u of users) {
      const credentialSource = await getGoogleAdsCredentialSource(u.id)
      const cred = await db.queryOne(
        `SELECT refresh_token FROM google_ads_credentials WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
        [u.id]
      ) as { refresh_token: string | null } | undefined
      rows.push({
        id: u.id,
        username: u.username,
        email: u.email,
        credentialSource,
        hasRefreshToken: Boolean(cred?.refresh_token && String(cred.refresh_token).trim()),
      })
    }

    return NextResponse.json({
      success: true,
      orgShared: org
        ? {
            clientIdPreview: maskSecret(org.client_id, 12),
            developerTokenPreview: maskSecret(org.developer_token, 8),
            hasClientSecret: Boolean(org.client_secret),
          }
        : null,
      users: rows,
    })
  } catch (error: any) {
    console.error('[admin/google-ads/credentials] GET failed:', error)
    return NextResponse.json({ error: error.message || '获取失败' }, { status: 500 })
  }
}

const putSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('org_shared'),
    client_id: z.string(),
    client_secret: z.string(),
    developer_token: z.string(),
  }),
  z.object({
    action: z.literal('user_policy'),
    userId: z.number().int().positive(),
    credential_source: z.enum(['inherit_org', 'dedicated_user']),
  }),
  z.object({
    action: z.literal('clear_user_google_ads'),
    userId: z.number().int().positive(),
  }),
])

export async function PUT(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    if (auth.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const body = await request.json()
    const parsed = putSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message || '参数无效' }, { status: 400 })
    }

    const data = parsed.data

    if (data.action === 'org_shared') {
      const clientId = data.client_id.trim()
      const developerToken = data.developer_token.trim()
      let clientSecret = data.client_secret.trim()
      if (!clientSecret) {
        const existing = await getOrgSharedGoogleAdsAppCredentials()
        clientSecret = existing?.client_secret || ''
      }
      if (!clientId || !clientSecret || !developerToken) {
        return NextResponse.json(
          { error: 'Client ID、Client Secret（新填写或沿用已有）、Developer Token 均不能为空' },
          { status: 400 }
        )
      }
      await updateSetting('google_ads_shared', 'client_id', clientId, undefined)
      await updateSetting('google_ads_shared', 'client_secret', clientSecret, undefined)
      await updateSetting('google_ads_shared', 'developer_token', developerToken, undefined)
      return NextResponse.json({ success: true, message: '组织级 Google Ads 应用凭证已保存' })
    }

    if (data.action === 'user_policy') {
      await updateSetting(
        'google_ads',
        'credential_source',
        data.credential_source,
        data.userId
      )
      return NextResponse.json({ success: true, message: '用户策略已更新' })
    }

    if (data.action === 'clear_user_google_ads') {
      const keys = [
        'client_id',
        'client_secret',
        'developer_token',
        'login_customer_id',
        'use_service_account',
        'credential_source',
      ]
      await clearUserSettings('google_ads', keys, data.userId)
      await deleteGoogleAdsCredentials(data.userId)
      return NextResponse.json({
        success: true,
        message: '已清空该用户的 Google Ads 用户级配置与 OAuth 凭证表记录',
      })
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  } catch (error: any) {
    console.error('[admin/google-ads/credentials] PUT failed:', error)
    return NextResponse.json({ error: error.message || '保存失败' }, { status: 500 })
  }
}
