// POST /api/click-farm/distribution/normalize - 归一化分布曲线

import { NextRequest, NextResponse } from 'next/server';
import { normalizeDistribution } from '@/lib/click-farm/distribution';

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
    const { distribution, targetTotal } = body;

    if (!Array.isArray(distribution) || distribution.length !== 24) {
      return NextResponse.json(
        { error: 'validation_error', message: '分布数组必须包含24个元素' },
        { status: 400 }
      );
    }

    if (typeof targetTotal !== 'number' || targetTotal <= 0) {
      return NextResponse.json(
        { error: 'validation_error', message: '目标总和必须是正整数' },
        { status: 400 }
      );
    }

    const normalized = normalizeDistribution(distribution, targetTotal);

    return NextResponse.json({
      success: true,
      data: {
        distribution: normalized,
        total: normalized.reduce((sum, n) => sum + n, 0)
      }
    });

  } catch (error) {
    console.error('归一化分布失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '归一化分布失败' },
      { status: 500 }
    );
  }
}
