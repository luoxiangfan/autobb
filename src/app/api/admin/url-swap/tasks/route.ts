// GET /api/admin/url-swap/tasks - 获取所有任务列表（管理员）

import { NextRequest, NextResponse } from 'next/server';
import { getAllUrlSwapTasks } from '@/lib/url-swap';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    if (auth.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const status = searchParams.get('status') as any;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const result = await getAllUrlSwapTasks({
      status: status || undefined,
      page,
      limit
    });

    const payload = {
      tasks: result.tasks,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    }

    // 兼容前端：既返回 data 包装，也保留原字段
    return NextResponse.json({ ...payload, success: true, data: payload });

  } catch (error: any) {
    console.error('[admin/url-swap] 获取任务列表失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取任务列表失败: ' + error.message },
      { status: 500 }
    );
  }
}
