// POST /api/click-farm/distribution/normalize - 归一化分布曲线

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { normalizeDistribution } from '@/lib/click-farm/distribution'

export const POST = withAuth(async (request: NextRequest) => {
  const body = await request.json()
  const { distribution, targetTotal } = body

  if (!Array.isArray(distribution) || distribution.length !== 24) {
    return NextResponse.json(
      { error: 'validation_error', message: '分布数组必须包含24个元素' },
      { status: 400 }
    )
  }

  if (typeof targetTotal !== 'number' || targetTotal <= 0) {
    return NextResponse.json(
      { error: 'validation_error', message: '目标总和必须是正整数' },
      { status: 400 }
    )
  }

  const normalized = normalizeDistribution(distribution, targetTotal)

  return NextResponse.json({
    success: true,
    data: {
      distribution: normalized,
      total: normalized.reduce((sum, n) => sum + n, 0),
    },
  })
})
