// GET /api/url-swap/tasks - 获取换链接任务列表
// POST /api/url-swap/tasks - 创建换链接任务

import { NextRequest, NextResponse } from 'next/server';
import { createUrlSwapTask, getUrlSwapTasks, hasUrlSwapTask } from '@/lib/url-swap';
import { triggerUrlSwapScheduling } from '@/lib/url-swap-scheduler';
import { validateUrlSwapTask } from '@/lib/url-swap-validator';
import type { CreateUrlSwapTaskRequest } from '@/lib/url-swap-types';
import { normalizeAffiliateLinksInput, findInvalidAffiliateLinks } from '@/lib/url-swap-link-utils';

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * GET - 获取换链接任务列表
 */
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

    const userIdNum = parseInt(userId);
    const { searchParams } = new URL(request.url);

    // 解析查询参数
    const status = searchParams.get('status') as any;
    const includeDeleted = parseBooleanQuery(searchParams.get('include_deleted') ?? searchParams.get('includeDeleted'));
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const result = await getUrlSwapTasks(userIdNum, {
      status: status || undefined,
      include_deleted: includeDeleted,
      page,
      limit
    });

    const payload = {
      tasks: result.tasks,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit)
      }
    }

    // 兼容前端：既返回 data 包装，也保留原字段
    return NextResponse.json({ ...payload, data: payload });

  } catch (error: any) {
    console.error('[url-swap] 获取任务列表失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '获取任务列表失败: ' + error.message },
      { status: 500 }
    );
  }
}

/**
 * POST - 创建换链接任务
 */
export async function POST(request: NextRequest) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }

    const userIdNum = parseInt(userId);

    // 获取原始请求体
    const rawBody = await request.text();
    if (!rawBody) {
      return NextResponse.json(
        { error: 'validation_error', message: '请求体为空' },
        { status: 400 }
      );
    }

    let body: CreateUrlSwapTaskRequest;
    try {
      body = JSON.parse(rawBody) as CreateUrlSwapTaskRequest;
    } catch (parseError: any) {
      return NextResponse.json(
        { error: 'validation_error', message: 'JSON格式错误: ' + parseError.message },
        { status: 400 }
      );
    }

    // 验证必填字段
    if (!body.offer_id) {
      return NextResponse.json(
        { error: 'validation_error', message: '缺少必填字段: offer_id' },
        { status: 400 }
      );
    }

    // 检查是否已存在任务
    const existing = await hasUrlSwapTask(body.offer_id, userIdNum);
    if (existing) {
      return NextResponse.json(
        { error: 'task_exists', message: '该Offer已有关联的换链接任务，请先删除现有任务或使用更新功能' },
        { status: 409 }
      );
    }

    const swapMode = body.swap_mode === 'manual' ? 'manual' : 'auto'

    // 方式二：推广链接列表必填
    if (swapMode === 'manual') {
      const rawList = (body as any).manual_affiliate_links
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

      body.manual_affiliate_links = normalizedList
    }

    // 方式一/方式二：验证代理配置
    const validation = await validateUrlSwapTask(body.offer_id);
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'validation_error', message: validation.error },
        { status: 400 }
      );
    }

    // 创建任务
    const task = await createUrlSwapTask(userIdNum, body);

    // 立即触发调度（事件驱动）
    await triggerUrlSwapScheduling(task.id);

    console.log(`[url-swap] 创建任务成功: ${task.id}`);

    return NextResponse.json({
      success: true,
      data: task,
      task,
      message: '换链接任务创建成功'
    });

  } catch (error: any) {
    console.error('[url-swap] 创建任务失败:', error);
    return NextResponse.json(
      { error: 'internal_error', message: '创建任务失败: ' + error.message },
      { status: 500 }
    );
  }
}
