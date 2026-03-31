// GET /api/offers/[id]/url-swap-task - 查询 Offer 的换链接任务
// 返回该 Offer 关联的换链接任务信息（如果有）

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';

export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const offerId = parseInt(params.id);
    if (isNaN(offerId)) {
      return NextResponse.json(
        { error: 'invalid_params', message: '无效的 Offer ID' },
        { status: 400 }
      );
    }

    const db = await getDatabase();

    // 验证 Offer 是否存在且属于该用户
    const offer = await db.queryOne<any>(`
      SELECT id FROM offers WHERE id = ? AND user_id = ?
    `, [offerId, parseInt(userId)]);

    if (!offer) {
      return NextResponse.json(
        { error: 'not_found', message: 'Offer 不存在' },
        { status: 404 }
      );
    }

    // 查询该 Offer 关联的换链接任务（不包括已删除的任务）
    // PostgreSQL 使用 is_deleted = FALSE
    const task = await db.queryOne<any>(`
      SELECT * FROM url_swap_tasks
      WHERE offer_id = ? AND user_id = ? AND is_deleted = FALSE
      ORDER BY created_at DESC
      LIMIT 1
    `, [offerId, parseInt(userId)]);

    if (!task) {
      // 没有找到任务，返回 null 表示没有任务
      return NextResponse.json({
        success: true,
        data: null,
        message: '该 Offer 没有关联的换链接任务'
      });
    }

    // 返回任务信息
    return NextResponse.json({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        swap_interval_minutes: task.swap_interval_minutes,
        duration_days: task.duration_days,
        current_final_url: task.current_final_url,
        url_changed_count: task.url_changed_count,
        enabled_at: task.enabled_at,
        error_message: task.error_message,
        created_at: task.created_at,
        updated_at: task.updated_at,
      }
    });

  } catch (error) {
    console.error('查询换链接任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '查询换链接任务失败' },
      { status: 500 }
    );
  }
}
