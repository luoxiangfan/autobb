/**
 * PATCH /api/risk-alerts/:id - 更新提示状态
 */

import { withAuth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { updateAlertStatus } from '@/lib/campaign/optimization'

export const PATCH = withAuth(async (request, user, context) => {
  try {
    const id = context?.params?.id
    if (!id) {
      return NextResponse.json({ error: 'Invalid alert ID' }, { status: 400 })
    }

    const alertId = parseInt(id, 10)
    if (isNaN(alertId)) {
      return NextResponse.json({ error: 'Invalid alert ID' }, { status: 400 })
    }

    const body = await request.json()
    const { status, note } = body

    // 验证status
    if (!['acknowledged', 'resolved'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    // 更新提示
    const updated = updateAlertStatus(alertId, user.userId, status, note)

    if (!updated) {
      return NextResponse.json({ error: 'Alert not found or no permission' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'Alert updated successfully',
    })
  } catch (error) {
    console.error('Update alert error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
