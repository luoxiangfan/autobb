import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  saveKnowledgeEntry,
  generateKnowledgeSummary,
  determineStrategyMode,
  getRecentKnowledge,
} from '@/lib/openclaw/strategy-store'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const saveEntrySchema = z.object({
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  summary_json: z.string().min(1),
  notes: z.string().optional().nullable(),
})

export async function GET(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const days = Math.min(Number(searchParams.get('days')) || 30, 90)
  const mode = searchParams.get('mode')

  if (mode === 'strategy') {
    const result = await determineStrategyMode(auth.userId)
    return NextResponse.json({ success: true, data: result })
  }

  const summary = await generateKnowledgeSummary(auth.userId)
  const recent = await getRecentKnowledge(auth.userId, days)

  return NextResponse.json({
    success: true,
    data: {
      summary,
      entries: recent,
    },
  })
}

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = saveEntrySchema.safeParse(body || {})
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  try {
    await saveKnowledgeEntry(auth.userId, parsed.data)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to save knowledge entry' },
      { status: 500 }
    )
  }
}
