// GET /api/click-farm/tasks/[id] - 获取任务详情
// PUT /api/click-farm/tasks/[id] - 更新任务
// DELETE /api/click-farm/tasks/[id] - 删除任务

import { withAuth } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { getClickFarmTaskById, updateClickFarmTask, deleteClickFarmTask } from '@/lib/click-farm'
import { validateDistribution, generateDefaultDistribution } from '@/lib/click-farm/distribution'
import { enqueueClickFarmTriggerRequest } from '@/lib/click-farm/click-farm-scheduler-trigger'
import type { UpdateClickFarmTaskRequest } from '@/lib/click-farm/click-farm-types'

function scaleDistribution(distribution: number[], oldTotal: number, newTotal: number): number[] {
  if (oldTotal === 0 || distribution.length === 0) {
    return generateDefaultDistribution(newTotal, '06:00', '24:00')
  }

  const ratio = newTotal / oldTotal
  let newDistribution = distribution.map((v) => Math.round(v * ratio))

  const newSum = newDistribution.reduce((a, b) => a + b, 0)
  const diff = newTotal - newSum

  if (diff !== 0) {
    const maxIndex = newDistribution.indexOf(Math.max(...newDistribution))
    newDistribution[maxIndex] = Math.max(0, newDistribution[maxIndex] + diff)
  }

  return newDistribution
}

export const dynamic = 'force-dynamic'

export const GET = withAuth(async (_request: NextRequest, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getClickFarmTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  return NextResponse.json({
    success: true,
    data: task,
  })
})

export const PUT = withAuth(async (request: NextRequest, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getClickFarmTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  if (!['pending', 'running'].includes(task.status)) {
    return NextResponse.json(
      { error: 'invalid_status', message: '只能更新pending或running状态的任务' },
      { status: 400 }
    )
  }

  const body = (await request.json()) as UpdateClickFarmTaskRequest

  if (body.daily_click_count !== undefined) {
    if (body.daily_click_count < 1 || body.daily_click_count > 1000) {
      return NextResponse.json(
        { error: 'validation_error', message: '每日点击数必须在1-1000之间' },
        { status: 400 }
      )
    }
  }

  if (body.daily_click_count !== undefined && body.hourly_distribution === undefined) {
    const oldTotal = task.hourly_distribution.reduce((a, b) => a + b, 0)
    const newTotal = body.daily_click_count

    if (oldTotal !== newTotal) {
      console.log(`[UpdateTask] 自动调整分布: ${oldTotal} -> ${newTotal}`)
      body.hourly_distribution = scaleDistribution(task.hourly_distribution, oldTotal, newTotal)
    }
  }

  if (body.hourly_distribution) {
    const targetCount = body.daily_click_count || task.daily_click_count
    const validation = validateDistribution(body.hourly_distribution, targetCount)
    if (!validation.valid) {
      return NextResponse.json(
        { error: 'validation_error', message: validation.error },
        { status: 400 }
      )
    }
  }

  const updatedTask = await updateClickFarmTask(id, user.userId, body)

  let triggerResult = null
  const requestId = request.headers.get('x-request-id') || undefined
  if (updatedTask.status === 'running') {
    try {
      const trigger = await enqueueClickFarmTriggerRequest({
        clickFarmTaskId: updatedTask.id,
        userId: user.userId,
        source: 'update',
        priority: 'high',
        parentRequestId: requestId,
      })
      triggerResult = {
        status: 'accepted',
        mode: 'async',
        queueTaskId: trigger.queueTaskId,
      }
      console.log(`[UpdateTask] 任务 ${updatedTask.id} 参数已更新，触发请求入队:`, triggerResult)
    } catch (error) {
      console.error(`[UpdateTask] 任务 ${updatedTask.id} 触发请求入队失败:`, error)
    }
  } else if (updatedTask.status === 'pending') {
    const { getDateInTimezone } = await import('@/lib/common/server')
    const todayInTaskTimezone = getDateInTimezone(new Date(), updatedTask.timezone)
    if (updatedTask.scheduled_start_date === todayInTaskTimezone) {
      try {
        const trigger = await enqueueClickFarmTriggerRequest({
          clickFarmTaskId: updatedTask.id,
          userId: user.userId,
          source: 'update',
          priority: 'high',
          parentRequestId: requestId,
        })
        triggerResult = {
          status: 'accepted',
          mode: 'async',
          queueTaskId: trigger.queueTaskId,
        }
        console.log(`[UpdateTask] 任务 ${updatedTask.id} 已更新，触发请求入队:`, triggerResult)
      } catch (error) {
        console.error(`[UpdateTask] 任务 ${updatedTask.id} 触发请求入队失败:`, error)
      }
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      task: updatedTask,
      trigger: triggerResult,
    },
  })
})

export const DELETE = withAuth(async (_request: NextRequest, user, context) => {
  const id = context?.params?.id
  if (!id) {
    return NextResponse.json({ error: 'validation_error', message: '缺少任务 ID' }, { status: 400 })
  }

  const task = await getClickFarmTaskById(id, user.userId)
  if (!task) {
    return NextResponse.json({ error: 'not_found', message: '任务不存在' }, { status: 404 })
  }

  await deleteClickFarmTask(id, user.userId)

  return NextResponse.json({
    success: true,
    message: '任务已删除',
  })
})
