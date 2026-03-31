import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createOpenclawToken, listOpenclawTokens } from '@/lib/openclaw/tokens'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'

const createTokenSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  scopes: z.array(z.string()).optional(),
})

export async function GET(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const tokens = await listOpenclawTokens(auth.user.userId)
  return NextResponse.json({ success: true, tokens })
}

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = createTokenSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  const { token, record } = await createOpenclawToken({
    userId: auth.user.userId,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
  })

  return NextResponse.json({ success: true, token, record })
}
