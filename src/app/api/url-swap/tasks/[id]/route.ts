// GET /api/url-swap/tasks/[id] - 获取任务详情
// PUT /api/url-swap/tasks/[id] - 更新任务配置
// DELETE /api/url-swap/tasks/[id] - 删除任务

import { NextRequest, NextResponse } from 'next/server';
import { getUrlSwapTaskById, getUrlSwapTaskStats, updateUrlSwapTask, getUrlSwapTaskTargets } from '@/lib/url-swap';
import { findInvalidAffiliateLinks, normalizeAffiliateLinksInput } from '@/lib/url-swap-link-utils';
import type { UpdateUrlSwapTaskRequest } from '@/lib/url-swap-types';
import { getDatabase } from '@/lib/db';
import { triggerUrlSwapScheduling } from '@/lib/url-swap-scheduler';
import { removePendingUrlSwapQueueTasksByTaskIds } from '@/lib/url-swap/queue-cleanup';

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET - 获取任务详情
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const task = await getUrlSwapTaskById(id, parseInt(userId));
    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 获取统计信息
    const stats = await getUrlSwapTaskStats(id, parseInt(userId));
    const targets = await getUrlSwapTaskTargets(id, parseInt(userId));

    const taskWithTargets = { ...task, targets }

    return NextResponse.json({
      success: true,
      data: taskWithTargets, // 兼容前端（期望 data 为任务对象）
      task: taskWithTargets,
      stats,
      targets
    });

  } catch (error: any) {
    console.error('[url-swap] 获取任务详情失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取任务详情失败: ' + error.message },
      { status: 500 }
    );
  }
}

/**
 * PUT - 更新任务配置
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    // 验证任务存在
    const existingTask = await getUrlSwapTaskById(id, parseInt(userId));
    if (!existingTask) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 解析请求体
    const rawBody = await request.text();
    if (!rawBody) {
      return NextResponse.json(
        { error: 'validation_error', message: '请求体为空' },
        { status: 400 }
      );
    }

    let body: UpdateUrlSwapTaskRequest;
    try {
      body = JSON.parse(rawBody) as UpdateUrlSwapTaskRequest;
    } catch (parseError: any) {
      return NextResponse.json(
        { error: 'validation_error', message: 'JSON格式错误: ' + parseError.message },
        { status: 400 }
      );
    }

    // 防御：前端会带 offer_id，但不允许更换任务关联的Offer
    const offerIdFromBody = (body as any)?.offer_id
    if (offerIdFromBody !== undefined && offerIdFromBody !== existingTask.offer_id) {
      return NextResponse.json(
        { error: 'validation_error', message: '不允许修改任务关联的Offer' },
        { status: 400 }
      );
    }

    const swapModeAfter = body.swap_mode !== undefined
      ? (body.swap_mode === 'manual' ? 'manual' : 'auto')
      : existingTask.swap_mode

    if (swapModeAfter === 'manual') {
      const rawList = (body as any).manual_affiliate_links ?? existingTask.manual_affiliate_links
      const normalizedList = normalizeAffiliateLinksInput(rawList)
      const hasAtLeastOne = normalizedList.length > 0
      if (!hasAtLeastOne) {
        return NextResponse.json(
          { error: 'validation_error', message: '方式二需要至少配置 1 个推广链接' },
          { status: 400 }
        );
      }

      const invalidLinks = findInvalidAffiliateLinks(normalizedList)
      if (invalidLinks.length > 0) {
        return NextResponse.json(
          { error: 'validation_error', message: '推广链接需包含 http/https 协议，请检查方式二列表' },
          { status: 400 }
        );
      }

      if (Array.isArray((body as any).manual_affiliate_links)) {
        body.manual_affiliate_links = normalizedList
      }
    }

    // 更新任务
    const task = await updateUrlSwapTask(id, parseInt(userId), body);

    // 及时生效：若任务仍为 enabled，立即触发一次调度（使用最新配置入队）
    // - disabled/completed 任务不会被触发（triggerUrlSwapScheduling 内部会 skipped）
    try {
      await triggerUrlSwapScheduling(task.id)
    } catch (scheduleError) {
      console.warn('[url-swap] 更新后触发调度失败（不影响更新结果）:', scheduleError)
    }

    console.log(`[url-swap] 更新任务成功: ${id}`);

    return NextResponse.json({
      success: true,
      data: task,
      task,
      message: '任务更新成功'
    });

  } catch (error: any) {
    console.error('[url-swap] 更新任务失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '更新任务失败: ' + error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除任务
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    // 验证任务存在
    const existingTask = await getUrlSwapTaskById(id, parseInt(userId));
    if (!existingTask) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 软删除任务
    const db = await getDatabase();
    const now = new Date().toISOString();
    const isDeletedValue = db.type === 'postgres' ? true : 1;
    await db.exec(`
      UPDATE url_swap_tasks
      SET is_deleted = ?, deleted_at = ?, updated_at = ?
      WHERE id = ?
    `, [isDeletedValue, now, now, id]);

    try {
      await removePendingUrlSwapQueueTasksByTaskIds([id], parseInt(userId));
    } catch (cleanupError) {
      console.warn(`[url-swap] 删除任务后清理队列失败: ${id}`, cleanupError);
    }

    console.log(`[url-swap] 删除任务成功: ${id}`);

    return NextResponse.json({
      success: true,
      message: '任务删除成功'
    });

  } catch (error: any) {
    console.error('[url-swap] 删除任务失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '删除任务失败: ' + error.message },
      { status: 500 }
    );
  }
}
