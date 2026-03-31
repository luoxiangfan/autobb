// GET /api/admin/click-farm/top-users - Top 10用户排行

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { estimateTraffic } from '@/lib/click-farm/distribution';

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    const userRole = request.headers.get('x-user-role');
    if (!userId || userRole !== 'admin') {
      return NextResponse.json(
        { error: 'forbidden', message: '需要管理员权限' },
        { status: 403 }
      );
    }

    const db = await getDatabase();

    const topUsers = await db.query<any>(`
      SELECT
        u.id as user_id,
        u.username,
        COALESCE(SUM(t.total_clicks), 0) as total_clicks,
        COALESCE(SUM(t.success_clicks), 0) as success_clicks,
        COALESCE(SUM(t.failed_clicks), 0) as failed_clicks
      FROM users u
      LEFT JOIN click_farm_tasks t ON t.user_id = u.id
      GROUP BY u.id, u.username
      HAVING COALESCE(SUM(t.total_clicks), 0) > 0
      ORDER BY total_clicks DESC
      LIMIT 10
    `, []);

    const result = topUsers.map((user: any) => ({
      userId: user.user_id,
      username: user.username,
      totalClicks: user.total_clicks,
      successRate: user.total_clicks > 0
        ? parseFloat(((user.success_clicks / user.total_clicks) * 100).toFixed(1))
        : 0,
      traffic: estimateTraffic(user.total_clicks)  // 🔧 统一使用估算函数
    }));

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('获取Top用户失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取Top用户失败' },
      { status: 500 }
    );
  }
}
