import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseServiceAccountJson } from '@/lib/google-ads-service-account'
import { encrypt } from '@/lib/crypto'
import { verifyAuth } from '@/lib/auth'
import {
  canMaintainGoogleAdsConfig,
  getGoogleAdsConfigScope,
} from '@/lib/google-ads-config-policy'

function normalizeUserIdForDb(dbType: string, userId: number): string | number {
  return dbType === 'postgres' ? userId : String(userId)
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { name, mccCustomerId, developerToken, serviceAccountJson, targetUserId } = await req.json()

    const { clientEmail, privateKey, projectId } = parseServiceAccountJson(serviceAccountJson)
    const encryptedPrivateKey = encrypt(privateKey)

    const db = await getDatabase()
    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
    const isAdmin = auth.user.role === 'admin'
    const resolvedTargetUserId =
      typeof targetUserId === 'number' && Number.isFinite(targetUserId)
        ? targetUserId
        : undefined

    const shouldWriteTenantDefault = isAdmin && !resolvedTargetUserId
    const effectiveUserId = resolvedTargetUserId ?? auth.user.userId
    const effectiveUserIdParam = normalizeUserIdForDb(db.type, effectiveUserId)

    if (!shouldWriteTenantDefault && !isAdmin) {
      const canMaintain = await canMaintainGoogleAdsConfig(auth.user.userId, auth.user.role)
      if (!canMaintain) {
        return NextResponse.json(
          {
            error:
              '当前账号的 Google Ads 配置由管理员统一维护，您仅可查看。若需自行维护，请联系管理员切换为“用户独立配置”。',
          },
          { status: 403 }
        )
      }
    }

    if (resolvedTargetUserId && !isAdmin) {
      return NextResponse.json({ error: '仅管理员可为其他用户配置服务账号' }, { status: 403 })
    }

    // 同一作用域只保留一条生效记录
    if (shouldWriteTenantDefault) {
      await db.exec(
        `
        DELETE FROM google_ads_service_accounts
        WHERE user_id IS NULL
      `
      )
    } else {
      await db.exec(
        `
        DELETE FROM google_ads_service_accounts
        WHERE user_id = ?
      `,
        [effectiveUserIdParam]
      )
    }

    await db.exec(
      `
      INSERT INTO google_ads_service_accounts (
        id, user_id, name, mcc_customer_id, developer_token,
        service_account_email, private_key, project_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `,
      [
        id,
        shouldWriteTenantDefault ? null : effectiveUserIdParam,
        name,
        mccCustomerId,
        developerToken,
        clientEmail,
        encryptedPrivateKey,
        projectId,
      ]
    )

    return NextResponse.json({
      success: true,
      id,
      scope: shouldWriteTenantDefault ? 'tenant' : 'user',
      targetUserId: shouldWriteTenantDefault ? null : effectiveUserId,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = await getDatabase()
  const searchParams = req.nextUrl.searchParams
  const targetUserIdParam = searchParams.get('targetUserId')
  const includeAll = searchParams.get('all') === 'true'

  const isAdmin = auth.user.role === 'admin'
  const targetUserId = targetUserIdParam ? Number(targetUserIdParam) : undefined

  if ((includeAll || (targetUserId && targetUserId !== auth.user.userId)) && !isAdmin) {
    return NextResponse.json({ error: '仅管理员可查看其他用户的服务账号配置' }, { status: 403 })
  }

  if (includeAll && isAdmin) {
    const accounts = await db.query(
      `
      SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at, user_id
      FROM google_ads_service_accounts
      ORDER BY CASE WHEN user_id IS NULL THEN 0 ELSE 1 END, created_at DESC
    `
    )
    return NextResponse.json({ accounts })
  }

  const effectiveUserId = targetUserId ?? auth.user.userId
  const uid = normalizeUserIdForDb(db.type, effectiveUserId)
  const accounts = await db.query(
    `
      SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at, user_id
      FROM google_ads_service_accounts
      WHERE user_id IS NULL OR user_id = ?
      ORDER BY CASE WHEN user_id IS NULL THEN 0 ELSE 1 END, created_at DESC
    `,
    [uid]
  )

  const configScope = await getGoogleAdsConfigScope(effectiveUserId)
  const canMaintainConfig =
    isAdmin || (effectiveUserId === auth.user.userId
      ? await canMaintainGoogleAdsConfig(auth.user.userId, auth.user.role)
      : false)

  return NextResponse.json({
    accounts,
    configScope,
    canMaintainConfig,
    targetUserId: effectiveUserId,
  })
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const targetUserIdParam = searchParams.get('targetUserId')
    const targetUserId = targetUserIdParam ? Number(targetUserIdParam) : undefined

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const db = await getDatabase()
    const isAdmin = auth.user.role === 'admin'

    if (targetUserId && targetUserId !== auth.user.userId && !isAdmin) {
      return NextResponse.json({ error: '仅管理员可删除其他用户的服务账号配置' }, { status: 403 })
    }

    const effectiveUserId = targetUserId ?? auth.user.userId
    const uid = normalizeUserIdForDb(db.type, effectiveUserId)

    if (!isAdmin) {
      const canMaintain = await canMaintainGoogleAdsConfig(auth.user.userId, auth.user.role)
      if (!canMaintain) {
        return NextResponse.json(
          { error: '当前账号无权删除 Google Ads 服务账号配置' },
          { status: 403 }
        )
      }
      await db.exec(
        `
        DELETE FROM google_ads_service_accounts
        WHERE id = ? AND user_id = ?
      `,
        [id, uid]
      )
    } else if (!targetUserId) {
      await db.exec(
        `
        DELETE FROM google_ads_service_accounts
        WHERE id = ? AND user_id IS NULL
      `,
        [id]
      )
    } else {
      await db.exec(
        `
        DELETE FROM google_ads_service_accounts
        WHERE id = ? AND user_id = ?
      `,
        [id, uid]
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
