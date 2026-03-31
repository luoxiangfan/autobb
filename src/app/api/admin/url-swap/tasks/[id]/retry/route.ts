// POST /api/admin/url-swap/tasks/[id]/retry - 管理员重试失败任务

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapTaskById, updateTaskStatus } from '@/lib/url-swap';
import { triggerUrlSwapScheduling } from '@/lib/url-swap-scheduler';

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST - 管理员重试失败任务
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;

    // 验证任务存在
    const existingTask = await getUrlSwapTaskById(id, 0);  // 管理员不需要userId
    if (!existingTask) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 检查是否是错误状态
    if (existingTask.status !== 'error') {
      return NextResponse.json(
        { error: 'invalid_state', message: '只有错误状态的任务可以重试' },
        { status: 400 }
      );
    }

    // 重置为启用状态并触发调度
    await updateTaskStatus(id, 'enabled');
    const result = await triggerUrlSwapScheduling(id);

    console.log(`[admin/url-swap] 重试任务: ${id}, result: ${result.status}`);

    return NextResponse.json({
      success: true,
      scheduling: result,
      message: result.status === 'queued' ? '任务已重新加入队列' : result.message
    });

  } catch (error: any) {
    console.error('[admin/url-swap] 重试任务失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '重试任务失败: ' + error.message },
      { status: 500 }
    );
  }
}
