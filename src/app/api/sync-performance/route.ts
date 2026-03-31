/**
 * Performance Data Sync API
 * 同步Google Ads效果数据用于加分计算
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncUserPerformanceData } from '@/lib/google-ads-performance-sync'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const result = await syncUserPerformanceData(userId)

    if (!result.success) {
      return NextResponse.json(
        {
          error: 'Sync failed',
          details: result.errors
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      syncedCount: result.syncedCount,
      syncDate: result.syncDate,
      errors: result.errors.length > 0 ? result.errors : undefined
    })
  } catch (error) {
    console.error('Performance sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync performance data' },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 })
    }

    const result = await syncUserPerformanceData(userId)

    return NextResponse.json(result)
  } catch (error) {
    console.error('Performance sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync performance data' },
      { status: 500 }
    )
  }
}
