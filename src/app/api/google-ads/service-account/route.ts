import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { parseServiceAccountJson } from '@/lib/google-ads-service-account'
import { encrypt } from '@/lib/crypto'
import { getUserIdFromRequest, findUserById } from '@/lib/auth'

async function getAuthenticatedUser(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) return null
  return await findUserById(userId)
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { name, mccCustomerId, developerToken, serviceAccountJson } = await req.json()

    const { clientEmail, privateKey, projectId } = parseServiceAccountJson(serviceAccountJson)
    const encryptedPrivateKey = encrypt(privateKey)

    const db = getDatabase()
    const id = crypto.randomUUID()
    const nowFunc = db.type === 'postgres' ? 'NOW()' : "datetime('now')"

    // 🔧 修复：只保留1个服务账号，先删除旧的，再插入新的
    await db.exec(`
      DELETE FROM google_ads_service_accounts
      WHERE user_id = ?
    `, [user.id])

    await db.exec(`
      INSERT INTO google_ads_service_accounts (
        id, user_id, name, mcc_customer_id, developer_token,
        service_account_email, private_key, project_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowFunc}, ${nowFunc})
    `, [id, user.id, name, mccCustomerId, developerToken, clientEmail, encryptedPrivateKey, projectId])

    return NextResponse.json({ success: true, id })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getDatabase()
  const accounts = await db.query(`
    SELECT id, name, mcc_customer_id, service_account_email, is_active, created_at
    FROM google_ads_service_accounts
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [user.id])

  return NextResponse.json({ accounts })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    const db = getDatabase()
    await db.exec(`
      DELETE FROM google_ads_service_accounts
      WHERE id = ? AND user_id = ?
    `, [id, user.id])

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
