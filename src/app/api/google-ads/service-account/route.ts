import { NextResponse } from 'next/server'
import {
  deleteGoogleAdsServiceAccountForUser,
  listServiceAccounts,
  parseServiceAccountJson,
  replaceGoogleAdsServiceAccountForUser,
} from '@/lib/google-ads/service-account/service-account'
import { encrypt, withAuth } from '@/lib/auth'
import { assertUserCanModifyGoogleAdsAuth } from '@/lib/google-ads/auth/assignment'
import {
  assertNoConflictingGoogleAdsAuth,
  getGoogleAdsAuthContextMetadata,
  resolveGoogleAdsDisplayAuthType,
} from '@/lib/google-ads/auth/context'

export const POST = withAuth(async (req, user) => {
  const userId = user.userId
  const userRole = user.role

  try {
    await assertUserCanModifyGoogleAdsAuth(userId, userId, userRole)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  try {
    try {
      await assertNoConflictingGoogleAdsAuth(userId, 'service_account')
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }

    const { name, mccCustomerId, developerToken, serviceAccountJson } = await req.json()

    const { clientEmail, privateKey, projectId } = parseServiceAccountJson(serviceAccountJson)
    const encryptedPrivateKey = encrypt(privateKey)

    const id = await replaceGoogleAdsServiceAccountForUser(userId, {
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
})

export const GET = withAuth(async (_req, user) => {
  const userId = user.userId

  const ctx = await getGoogleAdsAuthContextMetadata(userId)
  const displayAuthType = resolveGoogleAdsDisplayAuthType(ctx)
  const allowListForDualStackCleanup = ctx.dualStack && ctx.canModify
  if (displayAuthType !== 'service_account' && !allowListForDualStackCleanup) {
    return NextResponse.json({ accounts: [] })
  }

  const accounts = await listServiceAccounts(userId)

  return NextResponse.json({ accounts })
})

export const DELETE = withAuth(async (req, user) => {
  const userId = user.userId
  const userRole = user.role

  try {
    await assertUserCanModifyGoogleAdsAuth(userId, userId, userRole)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 })
    }

    await deleteGoogleAdsServiceAccountForUser(userId, id)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
})
