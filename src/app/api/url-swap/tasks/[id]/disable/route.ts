// POST /api/url-swap/tasks/[id]/disable - 禁用任务

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapTaskById, disableUrlSwapTask } from '@/lib/url-swap';

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST - 禁用任务
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    // 验证任务存在
    const existingTask = await getUrlSwapTaskById(id, parseInt(userId));
    if (!existingTask) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 检查状态
    if (existingTask.status === 'disabled') {
      return NextResponse.json(
        { error: 'invalid_state', message: '任务已经是禁用状态' },
        { status: 400 }
      );
    }

    // 禁用任务
    await disableUrlSwapTask(id, parseInt(userId));

    console.log(`[url-swap] 禁用任务成功: ${id}`);

    return NextResponse.json({
      success: true,
      message: '任务已禁用'
    });

  } catch (error: any) {
    console.error('[url-swap] 禁用任务失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '禁用任务失败: ' + error.message },
      { status: 500 }
    );
  }
}
