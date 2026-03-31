// POST /api/click-farm/tasks - 创建补点击任务
// GET /api/click-farm/tasks - 获取任务列表

import { NextRequest, NextResponse } from 'next/server';
import { createClickFarmTask, getClickFarmTasks } from '@/lib/click-farm';
import { generateDefaultDistribution, validateDistribution } from '@/lib/click-farm/distribution';
import type { CreateClickFarmTaskRequest, TaskFilters } from '@/lib/click-farm-types';
import { getDatabase } from '@/lib/db';
import { getTimezoneByCountry, getDateInTimezone } from '@/lib/timezone-utils';
import { enqueueClickFarmTriggerRequest } from '@/lib/click-farm/click-farm-scheduler-trigger';
import { getAllProxyUrls } from '@/lib/settings';
import { getQueueManagerForTaskType } from '@/lib/queue';
import { getQueueRoutingDiagnostics } from '@/lib/queue/queue-routing';
import { isBackgroundWorkerAlive, getBackgroundWorkerHeartbeatKey } from '@/lib/queue/background-worker-heartbeat';
import { normalizeClickFarmTaskRequestBody } from '@/lib/autoads-request-normalizers';

function parseBooleanQuery(value: string | null): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

/**
 * POST - 创建补点击任务
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

    // 🔧 修复：获取原始请求体文本，并进行详细的调试
    const rawBody = await request.text();
    console.log('[CreateClickFarmTask] 接收到请求体:', rawBody.substring(0, 200));

    if (!rawBody) {
      return NextResponse.json(
        { error: 'validation_error', message: '请求体为空' },
        { status: 400 }
      );
    }

    let body: CreateClickFarmTaskRequest;
    try {
      body = JSON.parse(rawBody) as CreateClickFarmTaskRequest;
      const normalizedBody = normalizeClickFarmTaskRequestBody(body);
      if (normalizedBody) {
        body = normalizedBody as CreateClickFarmTaskRequest;
      }
    } catch (parseError) {
      console.error('[CreateClickFarmTask] JSON解析失败:', parseError);
      console.error('[CreateClickFarmTask] 原始请求体:', rawBody);
      return NextResponse.json(
        { error: 'validation_error', message: 'JSON格式错误: ' + (parseError instanceof Error ? parseError.message : '未知错误') },
        { status: 400 }
      );
    }

    // 验证必填字段
    console.log('[CreateClickFarmTask] 解析后的请求数据:', {
      offer_id: body.offer_id,
      daily_click_count: body.daily_click_count,
      timezone: body.timezone,
      duration_days: body.duration_days,
      scheduled_start_date: body.scheduled_start_date,
      hourly_distribution_length: Array.isArray(body.hourly_distribution) ? body.hourly_distribution.length : 'not-array'
    });

    if (!body.offer_id || !body.daily_click_count) {
      return NextResponse.json(
        { error: 'validation_error', message: '缺少必填字段: offer_id=' + body.offer_id + ', daily_click_count=' + body.daily_click_count },
        { status: 400 }
      );
    }

    // 验证每日点击数范围
    if (body.daily_click_count < 1 || body.daily_click_count > 1000) {
      return NextResponse.json(
        { error: 'validation_error', message: '每日点击数必须在1-1000之间' },
        { status: 400 }
      );
    }

    // 🆕 NEW-4：验证时间格式（如果提供了的话）
    const timeFormatRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$|^24:00$/;
    const normalizedStartTime = typeof body.start_time === 'string' ? body.start_time.trim() : body.start_time;
    const normalizedEndTime = typeof body.end_time === 'string' ? body.end_time.trim() : body.end_time;

    if (normalizedStartTime && !timeFormatRegex.test(normalizedStartTime)) {
      return NextResponse.json(
        { error: 'validation_error', message: '开始时间格式无效，请使用 HH:mm 或 HH:mm:ss 或 24:00' },
        { status: 400 }
      );
    }
    if (normalizedEndTime && !timeFormatRegex.test(normalizedEndTime)) {
      return NextResponse.json(
        { error: 'validation_error', message: '结束时间格式无效，请使用 HH:mm 或 HH:mm:ss 或 24:00' },
        { status: 400 }
      );
    }

    // 🔧 修复(2026-02-13): 防止将 null 写入 DB 触发 NOT NULL 约束
    const effectiveStartTime = normalizedStartTime || '06:00';
    const effectiveEndTime = normalizedEndTime || '24:00';

    // 🆕 NEW-2：验证duration_days范围
    const durationDays = body.duration_days;
    if (durationDays !== undefined && durationDays !== null && durationDays !== -1) {
      if (durationDays < 1 || durationDays > 365) {
        return NextResponse.json(
          { error: 'validation_error', message: '任务天数必须在1-365天之间，或-1表示无限期' },
          { status: 400 }
        );
      }
    }

    // 检查Offer是否存在且属于当前用户
    const db = await getDatabase();
    const offer = await db.queryOne<any>(`
      SELECT id, affiliate_link, target_country
      FROM offers
      WHERE id = ? AND user_id = ?
    `, [body.offer_id, userIdNum]);

    if (!offer) {
      return NextResponse.json(
        { error: 'not_found', message: 'Offer不存在' },
        { status: 404 }
      );
    }

    // 🔧 修复(2025-12-28): 使用新的代理配置系统（proxy.urls JSON数组）
    const proxyUrls = await getAllProxyUrls(userIdNum);

    if (!proxyUrls || proxyUrls.length === 0) {
      return NextResponse.json(
        {
          error: 'proxy_required',
          message: '未配置任何代理',
          suggestion: '请先前往设置页面配置代理',
          redirectTo: '/settings'
        },
        { status: 400 }
      );
    }

    // 查找目标国家的代理配置
    const targetCountry = offer.target_country.toUpperCase();
    const proxyConfig = proxyUrls.find(
      (p) => p.country.toUpperCase() === targetCountry
    );

    if (!proxyConfig) {
      return NextResponse.json(
        {
          error: 'proxy_required',
          message: `未找到 ${offer.target_country} 国家的代理配置`,
          suggestion: '请先前往设置页面配置对应国家的代理',
          redirectTo: '/settings'
        },
        { status: 400 }
      );
    }

    // 如果未提供分布，生成默认分布
    let hourlyDistribution = body.hourly_distribution;
    if (!hourlyDistribution || hourlyDistribution.length !== 24) {
      hourlyDistribution = generateDefaultDistribution(
        body.daily_click_count,
        effectiveStartTime,
        effectiveEndTime
      );
    } else {
      // 验证分布总和
      const validation = validateDistribution(hourlyDistribution, body.daily_click_count);
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'validation_error', message: validation.error },
          { status: 400 }
        );
      }
    }

    // 🆕 如果没有提供timezone，从offer的target_country自动获取
    // 🔧 修复(2026-01-03): 强制验证并修正timezone，确保与target_country一致
    const expectedTimezone = getTimezoneByCountry(offer.target_country);
    let timezone = body.timezone;

    if (!timezone) {
      // 前端未提供timezone，使用自动匹配
      timezone = expectedTimezone;
      console.log(`[CreateTask] 自动设置timezone: ${offer.target_country} → ${timezone}`);
    } else if (timezone !== expectedTimezone) {
      // 前端提供了timezone，但与target_country不匹配，强制修正
      console.warn(`[CreateTask] ⚠️ 时区不匹配，已自动修正:`, {
        offerId: offer.id,
        targetCountry: offer.target_country,
        providedTimezone: timezone,
        correctedTimezone: expectedTimezone
      });
      timezone = expectedTimezone;
    } else {
      console.log(`[CreateTask] timezone验证通过: ${timezone} (国家: ${offer.target_country})`);
    }

    // 创建任务
    const task = await createClickFarmTask(userIdNum, {
      ...body,
      start_time: effectiveStartTime,
      end_time: effectiveEndTime,
      hourly_distribution: hourlyDistribution,
      timezone  // 🆕 使用自动匹配的timezone
    });

    // 🆕 如果开始日期是今天，异步触发调度（避免阻塞请求/放大内存峰值）
    let triggerResult: any = null;
    const todayInTaskTimezone = getDateInTimezone(new Date(), timezone);
    const scheduledDate = task.scheduled_start_date || todayInTaskTimezone;

    console.log('[CreateTask] 触发调度条件检查:', {
      taskId: task.id,
      timezone,
      scheduled_start_date: task.scheduled_start_date,
      todayInTaskTimezone,
      scheduledDate,
      isToday: scheduledDate === todayInTaskTimezone
    });

    if (scheduledDate === todayInTaskTimezone) {
      const triggerMode = (process.env.CLICK_FARM_TRIGGER_MODE || 'async').toLowerCase();
      const queueManager = getQueueManagerForTaskType('click-farm-trigger');
      await queueManager.ensureInitialized();
      const queueInfo = queueManager.getRuntimeInfo();
      const routingDiagnostics = getQueueRoutingDiagnostics();
      const redisReady = queueInfo.adapter === 'RedisQueueAdapter' && queueInfo.connected;
      const heartbeatKey = getBackgroundWorkerHeartbeatKey();
      const backgroundAlive = routingDiagnostics.splitEnabled
        ? await isBackgroundWorkerAlive()
        : true;

      if (!redisReady) {
        triggerResult = {
          status: 'deferred',
          mode: 'queue_unavailable',
          reason: 'redis_unavailable'
        };
        console.warn('[CreateTask] 队列未就绪，跳过立即调度:', {
          taskId: task.id,
          queue: queueInfo,
          routing: routingDiagnostics,
        });
      } else if (!backgroundAlive) {
        triggerResult = {
          status: 'deferred',
          mode: 'worker_unavailable',
          reason: 'background_worker_offline',
        };
        console.warn('[CreateTask] 背景Worker心跳缺失，跳过立即调度:', {
          taskId: task.id,
          heartbeatKey,
          queue: queueInfo,
          routing: routingDiagnostics,
        });
      } else if (triggerMode === 'scheduler' || triggerMode === 'disabled') {
        triggerResult = { status: 'deferred', mode: triggerMode };
        console.log(`[CreateTask] 任务 ${task.id} 开始日期是今天，跳过立即调度 (mode=${triggerMode})`);
      } else {
        try {
          const requestId = request.headers.get('x-request-id') || undefined;
          const trigger = await enqueueClickFarmTriggerRequest({
            clickFarmTaskId: task.id,
            userId: userIdNum,
            source: 'create',
            priority: 'high',
            parentRequestId: requestId,
          });
          triggerResult = { status: 'queued', mode: 'async', queueTaskId: trigger.queueTaskId };
          console.log(`[CreateTask] 任务 ${task.id} 触发请求已入队: ${trigger.queueTaskId}`);
        } catch (enqueueError) {
          const message = enqueueError instanceof Error ? enqueueError.message : String(enqueueError || '');
          const reason = message.includes('队列后端不可用')
            ? 'queue_unavailable'
            : message.includes('后台Worker')
              ? 'worker_unavailable'
              : 'enqueue_failed';
          triggerResult = {
            status: 'deferred',
            mode: 'async',
            reason,
          };
          console.error(`[CreateTask] 任务 ${task.id} 触发请求入队失败:`, enqueueError);
        }
      }
    } else {
      console.log(`[CreateTask] 任务 ${task.id} 开始日期不是今天，跳过立即调度`);
      console.log(`[CreateTask] scheduledDate=${scheduledDate}, todayInTaskTimezone=${todayInTaskTimezone}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        id: task.id,
        status: task.status,
        trigger: triggerResult,
        message: triggerResult?.status === 'queued'
          ? '补点击任务创建成功，触发请求已入队并将异步调度'
          : triggerResult?.mode === 'queue_unavailable' || triggerResult?.reason === 'queue_unavailable'
            ? '补点击任务创建成功，但队列未就绪，调度将由后台稍后处理'
            : triggerResult?.mode === 'worker_unavailable' || triggerResult?.reason === 'worker_unavailable'
              ? '补点击任务创建成功，但后台Worker未就绪，调度将由后台稍后处理'
          : triggerResult?.status === 'deferred'
            ? '补点击任务创建成功，调度将在后台触发'
          : '补点击任务创建成功'
      }
    });

  } catch (error) {
    console.error('创建补点击任务失败:', error);
    // 🔧 修复(2025-12-29): 添加详细的错误日志以帮助诊断问题
    let errorMessage = '创建任务失败';
    let errorDetails = '';
    if (error instanceof Error) {
      console.error('错误信息:', error.message);
      console.error('错误堆栈:', error.stack);
      errorMessage = error.message;
      errorDetails = error.message;
    }
    return NextResponse.json(
      {
        error: 'server_error',
        message: errorMessage,
        details: errorDetails  // 🔧 添加详细错误信息以便诊断
      },
      { status: 500 }
    );
  }
}

/**
 * GET - 获取任务列表
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
    const filters: TaskFilters = {
      status: searchParams.get('status') as any,
      offer_id: searchParams.get('offer_id') ? parseInt(searchParams.get('offer_id')!) : undefined,
      include_deleted: parseBooleanQuery(searchParams.get('include_deleted') ?? searchParams.get('includeDeleted')),
      page: searchParams.get('page') ? parseInt(searchParams.get('page')!) : 1,
      limit: searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 20
    };

    const result = await getClickFarmTasks(userIdNum, filters);

    return NextResponse.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('获取任务列表失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取任务列表失败' },
      { status: 500 }
    );
  }
}
