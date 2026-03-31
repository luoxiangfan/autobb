import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyOpenclawSessionAuth } from '@/lib/openclaw/request-auth'
import { resolveOpenclawUserFromBindingDebug } from '@/lib/openclaw/bindings'

export const dynamic = 'force-dynamic'

const diagnoseSchema = z.object({
  channel: z.string().min(1),
  senderId: z.string().min(1),
  accountId: z.string().optional(),
  tenantKey: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await verifyOpenclawSessionAuth(request)
  if (!auth.authenticated) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = diagnoseSchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  const resolution = await resolveOpenclawUserFromBindingDebug(
    parsed.data.channel,
    parsed.data.senderId,
    {
      accountId: parsed.data.accountId,
      tenantKey: parsed.data.tenantKey,
    }
  )

  return NextResponse.json({
    success: true,
    resolution,
    expectedUserId: auth.user.userId,
    matchesCurrentUser: resolution.userId === auth.user.userId,
  })
}
