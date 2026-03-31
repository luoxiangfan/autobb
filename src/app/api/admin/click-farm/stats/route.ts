// GET /api/admin/click-farm/stats - 管理员全局统计

import { NextRequest, NextResponse } from 'next/server';
import { getAdminClickFarmStats } from '@/lib/click-farm';

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

    // 🆕 使用新的timezone感知统计函数
    const stats = await getAdminClickFarmStats();

    return NextResponse.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('获取管理员统计失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取统计失败' },
      { status: 500 }
    );
  }
}
