// POST /api/click-farm/distribution/generate - 生成默认时间分布

import { NextRequest, NextResponse } from 'next/server';
import { generateDefaultDistribution } from '@/lib/click-farm/distribution';

export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const { daily_click_count, start_time, end_time } = body;

    if (!daily_click_count || daily_click_count < 1 || daily_click_count > 1000) {
      return NextResponse.json(
        { error: 'invalid_input', message: '每日点击数必须在1-1000之间' },
        { status: 400 }
      );
    }

    if (!start_time || !end_time) {
      return NextResponse.json(
        { error: 'invalid_input', message: '缺少时间参数' },
        { status: 400 }
      );
    }

    const distribution = generateDefaultDistribution(
      daily_click_count,
      start_time,
      end_time
    );

    return NextResponse.json({
      success: true,
      data: {
        distribution,
        total: distribution.reduce((sum, n) => sum + n, 0),
      },
    });

  } catch (error) {
    console.error('生成时间分布失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '生成时间分布失败' },
      { status: 500 }
    );
  }
}
