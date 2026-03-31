import { NextRequest, NextResponse } from 'next/server'
import { getDatabase } from '@/lib/db'
import { toNumber } from '@/lib/utils'
import { estimateTokenCost } from '@/lib/ai-token-tracker'

function formatUtcYmd(date: Date): string {
  // Keep the read path aligned with recordTokenUsage(), which persists UTC YYYY-MM-DD.
  return date.toISOString().slice(0, 10)
}

/**
 * GET /api/dashboard/ai-token-cost
 * 获取AI Token成本统计数据
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 从header获取用户ID
    const userIdHeader = request.headers.get('x-user-id')
    if (!userIdHeader) {
      return NextResponse.json(
        { error: '缺少用户认证信息' },
        { status: 401 }
      )
    }

    const userId = parseInt(userIdHeader, 10)
    const searchParams = request.nextUrl.searchParams
    const days = parseInt(searchParams.get('days') || '7', 10)

    const db = await getDatabase()
    const today = formatUtcYmd(new Date())

    // 获取今日数据
    const todayData = await db.query<{
      model: string
      operation_type: string
      input_tokens: number
      output_tokens: number
      total_tokens: number
      call_count: number
    }>(
      `SELECT
        model,
        operation_type,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as call_count
      FROM ai_token_usage
      WHERE user_id = ?
        AND date = ?
      GROUP BY model, operation_type
      ORDER BY SUM(total_tokens) DESC`,
      [userId, today]
    )

    // 计算今日总计
    const todayTotals = todayData.reduce(
      (acc, row) => ({
        totalCost: acc.totalCost + estimateTokenCost(
          row.model,
          toNumber(row.input_tokens),
          toNumber(row.output_tokens)
        ),
        totalTokens: acc.totalTokens + toNumber(row.total_tokens),
        totalCalls: acc.totalCalls + toNumber(row.call_count),
      }),
      { totalCost: 0, totalTokens: 0, totalCalls: 0 }
    )

    // 模型使用明细
    const modelUsageMap = new Map()
    for (const row of todayData) {
      const model = row.model
      if (!modelUsageMap.has(model)) {
        modelUsageMap.set(model, {
          model,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
          callCount: 0,
        })
      }
      const modelData = modelUsageMap.get(model)
      const rowCost = estimateTokenCost(
        model,
        toNumber(row.input_tokens),
        toNumber(row.output_tokens)
      )
      // Convert all numeric values using toNumber() for consistency
      modelData.inputTokens += toNumber(row.input_tokens)
      modelData.outputTokens += toNumber(row.output_tokens)
      modelData.totalTokens += toNumber(row.total_tokens)
      modelData.cost += rowCost
      modelData.callCount += toNumber(row.call_count)
    }

    // 获取趋势数据（最近N天）
    const startDate = new Date()
    startDate.setUTCDate(startDate.getUTCDate() - days + 1)
    const startDateStr = formatUtcYmd(startDate)

    const trendData = await db.query<{
      date: string
      model: string
      input_tokens: number
      output_tokens: number
      total_tokens: number
    }>(
      `SELECT
        date,
        model,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(total_tokens) as total_tokens
      FROM ai_token_usage
      WHERE user_id = ?
        AND date >= ?
      GROUP BY date, model
      ORDER BY date DESC`,
      [userId, startDateStr]
    )

    const trendByDate = new Map<string, { date: string; totalTokens: number; totalCost: number }>()
    for (const row of trendData) {
      const date = String(row.date)
      const existing = trendByDate.get(date) || { date, totalTokens: 0, totalCost: 0 }
      existing.totalTokens += toNumber(row.total_tokens)
      existing.totalCost += estimateTokenCost(
        row.model,
        toNumber(row.input_tokens),
        toNumber(row.output_tokens)
      )
      trendByDate.set(date, existing)
    }

    const trend = Array.from(trendByDate.values())
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, days)

    // 🆕 Token优化：操作类型分布（用于优化监控）
    const operationTypeMap = new Map()
    for (const row of todayData) {
      const opType = row.operation_type || 'unknown'
      if (!operationTypeMap.has(opType)) {
        operationTypeMap.set(opType, {
          operationType: opType,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          cost: 0,
          callCount: 0,
        })
      }
      const opData = operationTypeMap.get(opType)
      const rowCost = estimateTokenCost(
        row.model,
        toNumber(row.input_tokens),
        toNumber(row.output_tokens)
      )
      // Convert all numeric values using toNumber() for consistency
      opData.inputTokens += toNumber(row.input_tokens)
      opData.outputTokens += toNumber(row.output_tokens)
      opData.totalTokens += toNumber(row.total_tokens)
      opData.cost += rowCost
      opData.callCount += toNumber(row.call_count)
    }

    // 识别高成本操作
    const highCostOperations = Array.from(operationTypeMap.values())
      .filter(op => op.cost > 5) // 单操作成本>¥5
      .sort((a, b) => b.cost - a.cost)

    // 生成建议
    const recommendations = []

    // 成本等级建议
    if (todayTotals.totalCost > 100) {
      recommendations.push('⚠️ 今日AI成本较高（>¥100），建议检查是否有不必要的重复调用')
    } else if (todayTotals.totalCost > 50) {
      recommendations.push('💡 今日AI成本中等（¥50-100），可以考虑优化prompt以减少token使用')
    } else {
      recommendations.push('✅ 今日AI成本正常（<¥50），继续保持')
    }

    // 模型优化建议
    const hasProModel = Array.from(modelUsageMap.values()).some(m => m.model.includes('pro'))
    const hasFlashModel = Array.from(modelUsageMap.values()).some(m => m.model.includes('flash'))
    if (hasProModel && !hasFlashModel) {
      recommendations.push('💡 考虑在非关键场景使用flash模型以降低成本（5x成本减少）')
    }

    // 🆕 高成本操作建议
    if (highCostOperations.length > 0) {
      const topCostOp = highCostOperations[0]
      const opName = topCostOp.operationType.replace(/_/g, ' ')
      recommendations.push(`🔍 高成本操作：${opName}（¥${(topCostOp?.cost ?? 0).toFixed(2)}），建议优化`)
    }

    // 🆕 Token优化进度提示
    const compressionEnabled = Array.from(operationTypeMap.values())
      .some(op => op.operationType === 'competitor_analysis')
    if (compressionEnabled) {
      recommendations.push('🗜️ 竞品压缩已启用，预计节省45% token（$800/年）')
    }

    return NextResponse.json({
      success: true,
      data: {
        today: {
          totalCost: parseFloat(toNumber(todayTotals.totalCost).toFixed(2)),
          totalTokens: toNumber(todayTotals.totalTokens),
          totalCalls: toNumber(todayTotals.totalCalls),
          modelUsage: Array.from(modelUsageMap.values()).map(m => ({
            ...m,
            cost: parseFloat(toNumber(m.cost).toFixed(4)), // 保留4位小数用于统计
          })),
          operationUsage: Array.from(operationTypeMap.values())
            .sort((a, b) => b.cost - a.cost)
            .slice(0, 5)
            .map(op => ({
              ...op,
              cost: parseFloat(toNumber(op.cost).toFixed(4)), // 保留4位小数用于统计
            })),
        },
        trend: trend.map(row => ({
          date: row.date,
          totalTokens: toNumber(row.totalTokens),
          totalCost: parseFloat(toNumber(row.totalCost).toFixed(2)),
        })),
        recommendations,
        highCostOperations: highCostOperations.map(op => ({
          ...op,
          cost: parseFloat(toNumber(op.cost).toFixed(4)),
        })),
      },
    })
  } catch (error: any) {
    console.error('获取AI Token成本数据失败:', error)
    return NextResponse.json(
      { error: '获取数据失败', message: error.message },
      { status: 500 }
    )
  }
}
