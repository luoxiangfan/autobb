import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseServiceAccountJson } from '@/lib/google-ads-service-account'
import { encrypt } from '@/lib/crypto'
import { verifyAuth } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (auth.user.role !== 'admin') {
    return NextResponse.json(
      { error: '仅管理员可配置全租户 Google Ads 服务账号' },
      { status: 403 }
    )
  }

  try {
    const { name, mccCustomerId, developerToken, serviceAccountJson } = await req.json()

    const { clientEmail, privateKey, projectId } = parseServiceAccountJson(serviceAccountJson)
    const encryptedPrivateKey = encrypt(privateKey)

    const db = await getDatabase()
    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 全租户唯一：删除旧的全局服务账号后再插入（user_id IS NULL）
    await db.exec(
      `
      DELETE FROM google_ads_service_accounts
      WHERE user_id IS NULL
    `
    )

    await db.exec(
      `
      INSERT INTO google_ads_service_accounts (
        id, user_id, name, mcc_customer_id, developer_token,
        service_account_email, private_key, project_id,
        created_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `,
      [id, name, mccCustomerId, developerToken, clientEmail, encryptedPrivateKey, projectId]
    )

    return NextResponse.json({ success: true, id })
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
  const uid = db.type === 'postgres' ? auth.user.userId : String(auth.user.userId)
  const accounts = await db.query(
    `
    SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at, user_id
    FROM google_ads_service_accounts
    WHERE user_id IS NULL OR user_id = ?
    ORDER BY CASE WHEN user_id IS NULL THEN 0 ELSE 1 END, created_at DESC
  `,
    [uid]
  )

  return NextResponse.json({ accounts })
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (auth.user.role !== 'admin') {
    return NextResponse.json({ error: '仅管理员可删除全租户服务账号配置' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const db = await getDatabase()
    await db.exec(
      `
      DELETE FROM google_ads_service_accounts
      WHERE id = ? AND user_id IS NULL
    `,
      [id]
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
