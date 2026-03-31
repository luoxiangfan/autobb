import { NextRequest, NextResponse } from 'next/server'
import { revokeOpenclawToken } from '@/lib/openclaw/tokens'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const tokenId = parseInt(params.id, 10)
  if (!Number.isFinite(tokenId)) {
    return NextResponse.json({ error: 'Invalid token id' }, { status: 400 })
  }

  const revoked = await revokeOpenclawToken(auth.user.userId, tokenId)
  if (!revoked) {
    return NextResponse.json({ error: 'Token not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
