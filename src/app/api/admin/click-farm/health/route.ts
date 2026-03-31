/**
 * 补点击系统监控API
 * GET /api/admin/click-farm/health
 *
 * 用于管理员查看系统健康状态
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClickFarmHealth, getClickFarmMetricsHistory } from '@/lib/click-farm/monitoring';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    // 验证管理员权限
    const adminSecret = request.headers.get('x-admin-secret');
    if (adminSecret !== process.env.ADMIN_SECRET) {
      return NextResponse.json(
        { error: 'unauthorized' },
        { status: 401 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const includeMetrics = searchParams.get('metrics') === 'true';
    const metricsHours = parseInt(searchParams.get('hours') || '24');

    // 获取当前健康状态
    const health = await getClickFarmHealth();

    // 如果需要历史数据
    let metrics = null;
    if (includeMetrics) {
      metrics = await getClickFarmMetricsHistory(metricsHours);
    }

    return NextResponse.json({
      success: true,
      data: {
        health,
        metrics,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('[Click Farm Health API] Error:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取健康状态失败' },
      { status: 500 }
    );
  }
}
