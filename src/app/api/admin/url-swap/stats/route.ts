// GET /api/admin/url-swap/stats - 获取全局统计

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapGlobalStats } from '@/lib/url-swap';
import { verifyAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET - 获取全局统计（管理员）
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }
    if (auth.user.role !== 'admin') {
      return NextResponse.json({ error: '需要管理员权限' }, { status: 403 })
    }

    const stats = await getUrlSwapGlobalStats();

    // 兼容前端：既返回 data 包装，也保留扁平字段
    return NextResponse.json({ ...stats, success: true, data: stats });

  } catch (error: any) {
    console.error('[admin/url-swap] 获取统计失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取统计失败: ' + error.message },
      { status: 500 }
    );
  }
}
