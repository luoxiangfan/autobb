// GET /api/offers/[id]/click-farm-task - 查询 Offer 的补点击任务
// 返回该 Offer 关联的补点击任务信息（如果有）

import { NextRequest, NextResponse } from 'next/server';
import { getDatabase } from '@/lib/db';
import { parseClickFarmTask } from '@/lib/click-farm';

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

    // 查询该 Offer 关联的补点击任务（不包括已删除的任务）
    const task = await db.queryOne<any>(`
      SELECT
        id,
        user_id,
        offer_id,
        daily_click_count,
        start_time,
        end_time,
        duration_days,
        scheduled_start_date,
        timezone,
        status,
        pause_reason,
        pause_message,
        paused_at,
        total_clicks,
        success_clicks,
        failed_clicks,
        is_deleted,
        deleted_at,
        started_at,
        completed_at,
        next_run_at,
        created_at,
        updated_at
      FROM click_farm_tasks
      WHERE offer_id = ? AND user_id = ? AND IS_DELETED_FALSE
      ORDER BY created_at DESC
      LIMIT 1
    `, [offerId, parseInt(userId)]);

    if (!task) {
      // 没有找到任务，返回 null 表示没有任务
      return NextResponse.json({
        success: true,
        data: null,
        message: '该 Offer 没有关联的补点击任务'
      });
    }

    // 解析任务数据
    const parsedTask = parseClickFarmTask(task);

    return NextResponse.json({
      success: true,
      data: {
        id: parsedTask.id,
        status: parsedTask.status,
        daily_click_count: parsedTask.daily_click_count,
        start_time: parsedTask.start_time,
        end_time: parsedTask.end_time,
        duration_days: parsedTask.duration_days,
        timezone: parsedTask.timezone,
        progress: parsedTask.progress,
        total_clicks: parsedTask.total_clicks,
        success_clicks: parsedTask.success_clicks,
        failed_clicks: parsedTask.failed_clicks,
        created_at: parsedTask.created_at,
        started_at: parsedTask.started_at,
      }
    });

  } catch (error) {
    console.error('查询补点击任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '查询补点击任务失败' },
      { status: 500 }
    );
  }
}
