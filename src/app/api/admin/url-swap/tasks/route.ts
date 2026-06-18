// GET /api/admin/url-swap/tasks - 获取所有任务列表（管理员）

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getAllUrlSwapTasks } from '@/lib/url-swap'

export const dynamic = 'force-dynamic'

export const GET = withAuth(
  async (request: NextRequest) => {
    const { searchParams } = new URL(request.url)

    const status = searchParams.get('status') as any
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')

    const result = await getAllUrlSwapTasks({
      status: status || undefined,
      page,
      limit,
    })

    const payload = {
      tasks: result.tasks,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    }

    return NextResponse.json({ ...payload, success: true, data: payload })
  },
  { requireAdmin: true }
)
