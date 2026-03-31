// GET /api/url-swap/tasks/[id]/history - 获取换链历史

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapTaskById } from '@/lib/url-swap';

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET - 获取换链历史
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: RouteParams) {
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
    const task = await getUrlSwapTaskById(id, parseInt(userId));
    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 返回历史记录（倒序，最新的在前）
    const history = [...task.swap_history].reverse();

    return NextResponse.json({
      taskId: id,
      history,
      total: history.length
    });

  } catch (error: any) {
    console.error('[url-swap] 获取历史失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取历史失败: ' + error.message },
      { status: 500 }
    );
  }
}
