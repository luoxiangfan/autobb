// POST /api/url-swap/tasks/[id]/swap-now - 立即执行换链（手动触发）

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapTaskById } from '@/lib/url-swap';
import { triggerUrlSwapScheduling } from '@/lib/url-swap-scheduler';

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST - 立即执行换链
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
    if (existingTask.status === 'completed') {
      return NextResponse.json(
        { error: 'invalid_state', message: '已完成的任务无法立即执行' },
        { status: 400 }
      );
    }

    // 触发调度
    const result = await triggerUrlSwapScheduling(id);

    console.log(`[url-swap] 立即执行换链: ${id}, result: ${result.status}`);

    return NextResponse.json({
      success: true,
      scheduling: result,
      message: result.status === 'queued' ? '任务已加入队列' : result.message
    });

  } catch (error: any) {
    console.error('[url-swap] 立即执行失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '立即执行失败: ' + error.message },
      { status: 500 }
    );
  }
}
