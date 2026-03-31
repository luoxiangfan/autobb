// GET /api/click-farm/stats - 获取统计数据
// 支持时间范围参数：?daysBack=7, 14, 30, all

import { NextRequest, NextResponse } from 'next/server';
import { getClickFarmStats } from '@/lib/click-farm';

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const daysBack = searchParams.get('daysBack') || 'all';

    let daysBackNum: number | 'all' = 'all';
    if (daysBack !== 'all') {
      daysBackNum = parseInt(daysBack, 10);
      if (isNaN(daysBackNum) || daysBackNum < 1) {
        daysBackNum = 'all';
      }
    }

    const stats = await getClickFarmStats(parseInt(userId!), daysBackNum);

    return NextResponse.json({
      success: true,
      data: stats,
      meta: {
        daysBack: daysBack,
        rangeLabel: daysBack === 'all' ? '全部' : `最近${daysBack}天`
      }
    });

  } catch (error) {
    console.error('获取统计数据失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取统计数据失败' },
      { status: 500 }
    );
  }
}
