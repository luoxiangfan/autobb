// POST /api/url-swap/tasks/[id]/targets/refresh - 刷新任务目标（回填历史Campaign）

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapTaskById, refreshUrlSwapTaskTargets, getUrlSwapTaskTargets } from '@/lib/url-swap';

interface RouteParams {
  params: Promise<{ id: string }>
}

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

    const userIdNum = parseInt(userId, 10);

    const existingTask = await getUrlSwapTaskById(id, userIdNum);
    if (!existingTask) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    let body: { googleAdsAccountId?: number } = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const result = await refreshUrlSwapTaskTargets({
      taskId: id,
      userId: userIdNum,
      googleAdsAccountId: body.googleAdsAccountId
    });

    const targets = await getUrlSwapTaskTargets(id, userIdNum);

    return NextResponse.json({
      success: true,
      message: `已刷新目标，新增 ${result.inserted} 条`,
      ...result,
      targets
    });
  } catch (error: any) {
    console.error('[url-swap] 刷新目标失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '刷新目标失败: ' + error.message },
      { status: 500 }
    );
  }
}
