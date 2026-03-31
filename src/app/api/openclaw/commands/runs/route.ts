import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { listOpenclawCommandRuns } from '@/lib/openclaw/commands/runs-service'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const runsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  status: z.string().optional(),
  riskLevel: z.string().optional(),
  createdAfter: z.string().optional(),
  channel: z.string().optional(),
  senderId: z.string().optional(),
  sender_id: z.string().optional(),
  senderOpenId: z.string().optional(),
  sender_open_id: z.string().optional(),
  accountId: z.string().optional(),
  account_id: z.string().optional(),
  tenantKey: z.string().optional(),
  tenant_key: z.string().optional(),
})

function normalizeQueryValue(value: string | null): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

export async function GET(request: NextRequest) {
  try {
    const queryObject = {
      page: request.nextUrl.searchParams.get('page') || undefined,
      limit: request.nextUrl.searchParams.get('limit') || undefined,
      status: request.nextUrl.searchParams.get('status') || undefined,
      riskLevel: request.nextUrl.searchParams.get('riskLevel') || undefined,
      createdAfter: request.nextUrl.searchParams.get('createdAfter') || undefined,
      channel: normalizeQueryValue(request.nextUrl.searchParams.get('channel')),
      senderId: normalizeQueryValue(request.nextUrl.searchParams.get('senderId')),
      sender_id: normalizeQueryValue(request.nextUrl.searchParams.get('sender_id')),
      senderOpenId: normalizeQueryValue(request.nextUrl.searchParams.get('senderOpenId')),
      sender_open_id: normalizeQueryValue(request.nextUrl.searchParams.get('sender_open_id')),
      accountId: normalizeQueryValue(request.nextUrl.searchParams.get('accountId')),
      account_id: normalizeQueryValue(request.nextUrl.searchParams.get('account_id')),
      tenantKey: normalizeQueryValue(request.nextUrl.searchParams.get('tenantKey')),
      tenant_key: normalizeQueryValue(request.nextUrl.searchParams.get('tenant_key')),
    }

    const parsedQuery = runsQuerySchema.safeParse(queryObject)
    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: parsedQuery.error.errors[0]?.message || '请求参数错误' },
        { status: 400 }
      )
    }

    const auth = await resolveOpenclawRequestUser(request, {
      channel: parsedQuery.data.channel,
      senderId: parsedQuery.data.senderId
        || parsedQuery.data.sender_id
        || parsedQuery.data.senderOpenId
        || parsedQuery.data.sender_open_id,
      accountId: parsedQuery.data.accountId || parsedQuery.data.account_id,
      tenantKey: parsedQuery.data.tenantKey || parsedQuery.data.tenant_key,
    })
    if (!auth) {
      return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
    }

    const result = await listOpenclawCommandRuns({
      userId: auth.userId,
      page: parsedQuery.data.page,
      limit: parsedQuery.data.limit,
      status: parsedQuery.data.status,
      riskLevel: parsedQuery.data.riskLevel,
      createdAfter: parsedQuery.data.createdAfter,
    })

    return NextResponse.json({ success: true, ...result })
  } catch (error: any) {
    console.error('[openclaw][commands/runs] request failed:', error)
    const message = error?.message || '命令运行记录查询失败'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
