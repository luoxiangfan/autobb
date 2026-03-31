/**
 * PATCH /api/risk-alerts/:id - 更新提示状态
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { updateAlertStatus } from '@/lib/risk-alerts'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const auth = await verifyAuth(request)
    if (!auth) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const alertId = parseInt(params.id)
    if (isNaN(alertId)) {
      return NextResponse.json(
        { error: 'Invalid alert ID' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { status, note } = body

    // 验证status
    if (!['acknowledged', 'resolved'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      )
    }

    // 更新提示
    const updated = updateAlertStatus(alertId, auth.user!.userId, status, note)

    if (!updated) {
      return NextResponse.json(
        { error: 'Alert not found or no permission' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Alert updated successfully'
    })

  } catch (error) {
    console.error('Update alert error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
