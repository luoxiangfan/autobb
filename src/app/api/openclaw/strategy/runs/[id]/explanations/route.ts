import { NextRequest, NextResponse } from 'next/server'
import { resolveOpenclawRequestUser } from '@/lib/openclaw/request-auth'
import { getDatabase } from '@/lib/db'
import { buildStrategyRunExplanations } from '@/lib/queue/executors/openclaw-strategy-executor'

export const dynamic = 'force-dynamic'

function parseJsonValue(value: unknown): any {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const auth = await resolveOpenclawRequestUser(request)
  if (!auth) {
    return NextResponse.json({ error: 'OpenClaw 功能未开启或未授权' }, { status: 403 })
  }

  const runId = String(params.id || '').trim()
  if (!runId) {
    return NextResponse.json({ error: '缺少 runId' }, { status: 400 })
  }

  try {
    const db = await getDatabase()

    const run = await db.queryOne<any>(
      `
        SELECT
          id,
          mode,
          status,
          run_date,
          stats_json,
          error_message,
          started_at,
          completed_at,
          created_at
        FROM strategy_center_runs
        WHERE id = ? AND user_id = ?
        LIMIT 1
      `,
      [runId, auth.userId]
    )

    if (!run) {
      return NextResponse.json({ error: '策略运行记录不存在' }, { status: 404 })
    }

    const actions = await db.query<any>(
      `
        SELECT
          id,
          action_type,
          target_type,
          target_id,
          status,
          request_json,
          response_json,
          error_message,
          created_at
        FROM strategy_center_actions
        WHERE run_id = ? AND user_id = ?
        ORDER BY created_at ASC, id ASC
      `,
      [runId, auth.userId]
    )

    const explanation = buildStrategyRunExplanations({
      run: {
        id: run.id,
        mode: run.mode || null,
        status: run.status || null,
        runDate: run.run_date || null,
        startedAt: run.started_at || null,
        completedAt: run.completed_at || null,
        createdAt: run.created_at || null,
        errorMessage: run.error_message || null,
        statsJson: parseJsonValue(run.stats_json),
      },
      actions: (actions || []).map((action: any) => ({
        id: Number(action.id),
        actionType: String(action.action_type || ''),
        targetType: action.target_type || null,
        targetId: action.target_id || null,
        status: action.status || null,
        errorMessage: action.error_message || null,
        requestJson: parseJsonValue(action.request_json),
        responseJson: parseJsonValue(action.response_json),
        createdAt: action.created_at || null,
      })),
    })

    return NextResponse.json({
      success: true,
      data: explanation,
      meta: {
        runId,
        actionCount: actions.length,
        source: 'strategy_center_runs + strategy_center_actions',
      },
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '策略解释日志查询失败' },
      { status: 500 }
    )
  }
}
