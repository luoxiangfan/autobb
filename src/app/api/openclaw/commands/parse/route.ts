import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { parseOpenclawCommandIntent } from '@/lib/openclaw/commands/intent-parser'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const parseSchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  intent: z.string().optional(),
})

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const rawBody = await request.json().catch(() => null)
  const parsed = parseSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.errors[0]?.message || '请求参数错误' },
      { status: 400 }
    )
  }

  try {
    const result = parseOpenclawCommandIntent(parsed.data)
    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    const message = error?.message || '命令解析失败'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
