// GET /api/click-farm/tasks/[id] - 获取任务详情
// PUT /api/click-farm/tasks/[id] - 更新任务
// DELETE /api/click-farm/tasks/[id] - 删除任务

import { NextRequest, NextResponse } from 'next/server';
import {
  getClickFarmTaskById,
  updateClickFarmTask,
  deleteClickFarmTask
} from '@/lib/click-farm';
import { validateDistribution, generateDefaultDistribution } from '@/lib/click-farm/distribution';
import { enqueueClickFarmTriggerRequest } from '@/lib/click-farm/click-farm-scheduler-trigger';
import type { UpdateClickFarmTaskRequest } from '@/lib/click-farm-types';

/**
 * 按比例调整分布总和
 * 当 daily_click_count 改变但 hourly_distribution 未传入时使用
 */
function scaleDistribution(
  distribution: number[],
  oldTotal: number,
  newTotal: number
): number[] {
  if (oldTotal === 0 || distribution.length === 0) {
    return generateDefaultDistribution(newTotal, '06:00', '24:00');
  }

  const ratio = newTotal / oldTotal;
  let newDistribution = distribution.map(v => Math.round(v * ratio));

  // 确保总和精确等于目标值
  const newSum = newDistribution.reduce((a, b) => a + b, 0);
  const diff = newTotal - newSum;

  if (diff !== 0) {
    // 将差值加到最大的元素上
    const maxIndex = newDistribution.indexOf(Math.max(...newDistribution));
    newDistribution[maxIndex] = Math.max(0, newDistribution[maxIndex] + diff);
  }

  return newDistribution;
}

/**
 * GET - 获取任务详情
 */
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

    const task = await getClickFarmTaskById(params.id, parseInt(userId!));

    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: task
    });

  } catch (error) {
    console.error('获取任务详情失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '获取任务详情失败' },
      { status: 500 }
    );
  }
}

/**
 * PUT - 更新任务
 */
export async function PUT(
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

    const task = await getClickFarmTaskById(params.id, parseInt(userId!));
    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    // 只有pending和running状态的任务可以更新
    if (!['pending', 'running'].includes(task.status)) {
      return NextResponse.json(
        { error: 'invalid_status', message: '只能更新pending或running状态的任务' },
        { status: 400 }
      );
    }

    const body = await request.json() as UpdateClickFarmTaskRequest;

    // 验证每日点击数范围
    if (body.daily_click_count !== undefined) {
      if (body.daily_click_count < 1 || body.daily_click_count > 1000) {
        return NextResponse.json(
          { error: 'validation_error', message: '每日点击数必须在1-1000之间' },
          { status: 400 }
        );
      }
    }

    // 🔧 修复：当更新 daily_click_count 但未提供 hourly_distribution 时
    // 自动按比例调整分布，使总和匹配新的目标值
    if (body.daily_click_count !== undefined && body.hourly_distribution === undefined) {
      const oldTotal = task.hourly_distribution.reduce((a, b) => a + b, 0);
      const newTotal = body.daily_click_count;

      if (oldTotal !== newTotal) {
        console.log(`[UpdateTask] 自动调整分布: ${oldTotal} -> ${newTotal}`);
        body.hourly_distribution = scaleDistribution(
          task.hourly_distribution,
          oldTotal,
          newTotal
        );
      }
    }

    // 验证分布总和
    if (body.hourly_distribution) {
      const targetCount = body.daily_click_count || task.daily_click_count;
      const validation = validateDistribution(body.hourly_distribution, targetCount);
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'validation_error', message: validation.error },
          { status: 400 }
        );
      }
    }

    const updatedTask = await updateClickFarmTask(params.id, parseInt(userId!), body);

    // 更新后异步触发调度请求（控制面入队），避免在 API 请求内同步调度
    let triggerResult = null;
    const requestId = request.headers.get('x-request-id') || undefined;
    if (updatedTask.status === 'running') {
      // 运行中任务：始终触发一次异步重调度
      try {
        const trigger = await enqueueClickFarmTriggerRequest({
          clickFarmTaskId: updatedTask.id,
          userId: parseInt(userId!, 10),
          source: 'update',
          priority: 'high',
          parentRequestId: requestId,
        });
        triggerResult = {
          status: 'accepted',
          mode: 'async',
          queueTaskId: trigger.queueTaskId,
        };
        console.log(`[UpdateTask] 任务 ${updatedTask.id} 参数已更新，触发请求入队:`, triggerResult);
      } catch (error) {
        console.error(`[UpdateTask] 任务 ${updatedTask.id} 触发请求入队失败:`, error);
      }
    } else if (updatedTask.status === 'pending') {
      // pending 状态仅在“今天开始”时触发
      const { getDateInTimezone } = await import('@/lib/timezone-utils');
      const todayInTaskTimezone = getDateInTimezone(new Date(), updatedTask.timezone);
      if (updatedTask.scheduled_start_date === todayInTaskTimezone) {
        try {
          const trigger = await enqueueClickFarmTriggerRequest({
            clickFarmTaskId: updatedTask.id,
            userId: parseInt(userId!, 10),
            source: 'update',
            priority: 'high',
            parentRequestId: requestId,
          });
          triggerResult = {
            status: 'accepted',
            mode: 'async',
            queueTaskId: trigger.queueTaskId,
          };
          console.log(`[UpdateTask] 任务 ${updatedTask.id} 已更新，触发请求入队:`, triggerResult);
        } catch (error) {
          console.error(`[UpdateTask] 任务 ${updatedTask.id} 触发请求入队失败:`, error);
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        task: updatedTask,
        trigger: triggerResult
      }
    });

  } catch (error) {
    console.error('更新任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '更新任务失败' },
      { status: 500 }
    );
  }
}

/**
 * DELETE - 删除任务（软删除）
 */
export async function DELETE(
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

    const task = await getClickFarmTaskById(params.id, parseInt(userId!));
    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    await deleteClickFarmTask(params.id, parseInt(userId!));

    return NextResponse.json({
      success: true,
      message: '任务已删除'
    });

  } catch (error) {
    console.error('删除任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '删除任务失败' },
      { status: 500 }
    );
  }
}
