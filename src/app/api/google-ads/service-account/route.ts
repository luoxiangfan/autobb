import { NextRequest, NextResponse } from 'next/server'
import {
  deleteGoogleAdsServiceAccountForUser,
  listServiceAccounts,
  parseServiceAccountJson,
  replaceGoogleAdsServiceAccountForUser,
} from '@/lib/google-ads/service-account/service-account'
import { encrypt } from '@/lib/auth'
import { verifyAuth, findUserById } from '@/lib/auth'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads/auth/assignment'
import {
  assertNoConflictingGoogleAdsAuth,
  getGoogleAdsAuthContextMetadata,
  resolveGoogleAdsDisplayAuthType,
} from '@/lib/google-ads/auth/context'

async function getAuthenticatedUser(request: NextRequest) {
  const authResult = await verifyAuth(request)
  if (!authResult.authenticated || !authResult.user) return null
  return await findUserById(authResult.user.userId)
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await assertUserCanModifyGoogleAdsAuth(user.id, user.id, user.role)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  try {
    try {
      await assertNoConflictingGoogleAdsAuth(user.id, 'service_account')
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    const { name, mccCustomerId, developerToken, serviceAccountJson } = await req.json()

    const { clientEmail, privateKey, projectId } = parseServiceAccountJson(serviceAccountJson)
    const encryptedPrivateKey = encrypt(privateKey)

    const id = await replaceGoogleAdsServiceAccountForUser(user.id, {
      name,
      mccCustomerId,
      developerToken,
      serviceAccountEmail: clientEmail,
      encryptedPrivateKey,
      projectId: projectId ?? null,
    })

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

  const ctx = await getGoogleAdsAuthContextMetadata(user.id)
  const displayAuthType = resolveGoogleAdsDisplayAuthType(ctx)
  const allowListForDualStackCleanup = ctx.dualStack && ctx.canModify
  if (displayAuthType !== 'service_account' && !allowListForDualStackCleanup) {
    return NextResponse.json({ accounts: [] })
  }

  const accounts = await listServiceAccounts(user.id)

  return NextResponse.json({ accounts })
}

export async function DELETE(req: NextRequest) {
  const user = await getAuthenticatedUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await assertUserCanModifyGoogleAdsAuth(user.id, user.id, user.role)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    await deleteGoogleAdsServiceAccountForUser(user.id, id)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}
