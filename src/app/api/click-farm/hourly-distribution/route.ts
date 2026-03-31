// GET /api/click-farm/hourly-distribution - 获取今日时间分布

import { NextRequest, NextResponse } from 'next/server';
import { getHourlyDistribution } from '@/lib/click-farm';

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

    const distribution = await getHourlyDistribution(parseInt(userId!));

    return NextResponse.json({
      success: true,
      data: distribution
    });

  } catch (error) {
    console.error('获取时间分布失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取时间分布失败' },
      { status: 500 }
    );
  }
}
