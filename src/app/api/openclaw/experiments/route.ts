import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  listExperiments,
  createExperiment,
  recordExperimentMetrics,
  evaluateExperiment,
  getExperimentHistory,
} from '@/lib/openclaw/experiments'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  experiment_name: z.string().min(1).max(200),
  experiment_type: z.string().min(1).max(50),
  offer_id: z.number().int().optional().nullable(),
  campaign_id: z.number().int().optional().nullable(),
  variant_a: z.any().optional().nullable(),
  variant_b: z.any().optional().nullable(),
  status: z.string().max(20).optional().default('running'),
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
  const limit = Number(searchParams.get('limit')) || 50
  const status = searchParams.get('status') || undefined
  const offerId = searchParams.get('offer_id')
    ? Number(searchParams.get('offer_id'))
    : undefined

  if (offerId) {
    const data = await getExperimentHistory(auth.userId, offerId)
    return NextResponse.json({ success: true, data })
  }

  const data = await listExperiments(auth.userId, { limit, status })
  return NextResponse.json({ success: true, data })
}

const recordMetricsSchema = z.object({
  action: z.literal('record-metrics'),
  experiment_id: z.number().int(),
  variant: z.enum(['a', 'b']),
  metrics: z.record(z.any()),
})

const evaluateSchema = z.object({
  action: z.literal('evaluate'),
  experiment_id: z.number().int(),
})

export async function POST(request: NextRequest) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  if (!body) {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  // Record metrics action
  if (body.action === 'record-metrics') {
    const parsed = recordMetricsSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }
    try {
      await recordExperimentMetrics(
        auth.userId,
        parsed.data.experiment_id,
        parsed.data.variant,
        parsed.data.metrics
      )
      return NextResponse.json({ success: true })
    } catch (error: any) {
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to record metrics' },
        { status: 500 }
      )
    }
  }

  // Evaluate experiment action
  if (body.action === 'evaluate') {
    const parsed = evaluateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      )
    }
    try {
      const result = await evaluateExperiment(auth.userId, parsed.data.experiment_id)
      return NextResponse.json({ success: true, data: result })
    } catch (error: any) {
      return NextResponse.json(
        { success: false, error: error.message || 'Failed to evaluate experiment' },
        { status: 500 }
      )
    }
  }

  // Default: create experiment
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
      { status: 400 }
    )
  }

  try {
    const record = await createExperiment(auth.userId, parsed.data)
    return NextResponse.json({ success: true, data: record })
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create experiment' },
      { status: 500 }
    )
  }
}
