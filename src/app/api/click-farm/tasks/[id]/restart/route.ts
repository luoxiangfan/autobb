// POST /api/click-farm/tasks/[id]/restart - 重启任务

import { NextRequest, NextResponse } from 'next/server';
import { getClickFarmTaskById, restartClickFarmTask } from '@/lib/click-farm';
import { hasEnabledCampaignForOffer } from '@/lib/click-farm/campaign-health-guard';
import { notifyTaskResumed } from '@/lib/click-farm/notifications';
import { getDatabase } from '@/lib/db';
import { getAllProxyUrls } from '@/lib/settings';  // 🔧 修复：导入新的代理查询函数
import { getDateInTimezone } from '@/lib/timezone-utils';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const userId = request.headers.get('x-user-id');
    if (!userId) {
      return NextResponse.json(
        { error: 'unauthorized', message: '未登录' },
        { status: 401 }
      );
    }
    const userIdNum = parseInt(userId, 10);

    const { id } = await context.params;
    const task = await getClickFarmTaskById(id, userIdNum);
    if (!task) {
      return NextResponse.json(
        { error: 'not_found', message: '任务不存在' },
        { status: 404 }
      );
    }

    if (!['stopped', 'paused'].includes(task.status)) {
      return NextResponse.json(
        { error: 'invalid_status', message: '只能重启stopped或paused状态的任务' },
        { status: 400 }
      );
    }

    // 新增：重启前先校验关联 Offer 是否存在可用的 ENABLED Campaign
    // 避免先重启成功，随后又被调度器立即打回 no_campaign
    const enabledCampaignExists = await hasEnabledCampaignForOffer({
      userId: userIdNum,
      offerId: task.offer_id,
    });
    if (!enabledCampaignExists) {
      return NextResponse.json(
        {
          error: 'campaign_required',
          message: '当前 Offer 没有可用的已启用 Campaign，请先发布并启用至少一个 Campaign 后再重启任务',
          suggestion: '请前往 Campaign 页面确认该 Offer 至少有一个状态为 ENABLED 的 Campaign',
        },
        { status: 400 }
      );
    }

    // 如果是因为代理缺失而暂停，需要检查代理是否已配置
    if (task.pause_reason === 'no_proxy') {
      const db = await getDatabase();
      const offer = await db.queryOne<any>(`
        SELECT target_country FROM offers WHERE id = ?
      `, [task.offer_id]);

      if (offer) {
        // 🔧 修复(2025-12-30): 使用新的代理配置系统（proxy.urls JSON数组）
        const proxyUrls = await getAllProxyUrls(userIdNum);
        const targetCountry = offer.target_country.toUpperCase();
        const proxyConfig = proxyUrls?.find(p => p.country.toUpperCase() === targetCountry);

        if (!proxyConfig) {
          return NextResponse.json(
            {
              error: 'proxy_required',
              message: `仍未找到 ${offer.target_country} 国家的代理配置`,
              suggestion: '请先配置代理后再重启任务',
              redirectTo: '/settings/proxy'
            },
            { status: 400 }
          );
        }
      }
    }

    // 🔧 修复NEW-6：检查是否需要重置started_at
    // 如果任务从未开始（started_at为null）或scheduled_start_date已过期
    // 重启时应该重新计算next_run_at
    // 注意：db已经在上面获取，不需要重复获取
    // const { generateNextRunAt } = await import('@/lib/click-farm/scheduler');

    // 如果任务从未开始，重启后应该会设置started_at
    if (!task.started_at) {
      console.log(`[Restart] 任务 ${id} 从未开始，重启后将首次执行`);
    } else if (task.scheduled_start_date) {
      // 检查scheduled_start_date是否已经过期
      // 🔧 修复(2025-12-31): 使用任务时区的日期进行比较，而非 UTC 日期
      const todayInTaskTimezone = getDateInTimezone(new Date(), task.timezone);
      if (task.scheduled_start_date < todayInTaskTimezone) {
        // scheduled_start_date已过期，任务应该已经运行了一段时间
        // 不需要特殊处理，next_run_at会在Cron中自动更新
        console.log(`[Restart] 任务 ${id} 的scheduled_start_date(${task.scheduled_start_date})已过期，状态正常`);
      }
    }

    const updatedTask = await restartClickFarmTask(id, userIdNum);

    // 🔔 发送任务恢复通知
    await notifyTaskResumed(userIdNum, id);

    return NextResponse.json({
      success: true,
      data: updatedTask,
      message: '任务已重启'
    });

  } catch (error) {
    console.error('重启任务失败:', error);
    return NextResponse.json(
      { error: 'server_error', message: '重启任务失败' },
      { status: 500 }
    );
  }
}
