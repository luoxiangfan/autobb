/**
 * Click Farm 综合集成测试
 * src/lib/click-farm/__tests__/comprehensive.test.ts
 *
 * 测试完整的业务流程和边界条件
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateSubTasks,
  isWithinExecutionTimeRange,
  calculateProgress,
  shouldCompleteTask,
  generateNextRunAt
} from '../scheduler';
import {
  normalizeDistribution,
  generateDefaultDistribution,
  validateDistribution,
  estimateTraffic,
  formatBytes
} from '../distribution';
import type { ClickFarmTask, CreateClickFarmTaskRequest } from '../click-farm-types';

// Mock timezone-utils
vi.mock('../timezone-utils', () => ({
  createDateInTimezone: vi.fn((dateStr: string, timeStr: string, timezone: string) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    return new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  }),
  getDateInTimezone: vi.fn((date: Date, timezone: string) => {
    return date.toISOString().split('T')[0];
  }),
  getHourInTimezone: vi.fn((date: Date, timezone: string) => {
    return date.getUTCHours();
  }),
  getTimezoneByCountry: vi.fn((country: string) => {
    const map: Record<string, string> = {
      'US': 'America/New_York',
      'GB': 'Europe/London',
      'CN': 'Asia/Shanghai',
      'DE': 'Europe/Berlin',
      'JP': 'Asia/Tokyo'
    };
    return map[country.toUpperCase()] || 'America/New_York';
  })
}));

describe('ClickFarm 综合业务流程测试', () => {
  // 创建测试任务的辅助函数
  const createTestTask = (overrides: Partial<ClickFarmTask> = {}): ClickFarmTask => ({
    id: 'test-task-001',
    user_id: 1,
    offer_id: 1,
    daily_click_count: 216,
    start_time: '06:00',
    end_time: '24:00',
    duration_days: 7,
    scheduled_start_date: '2024-12-28',
    hourly_distribution: [0, 0, 0, 0, 0, 5, 10, 15, 12, 10, 8, 5, 5, 8, 10, 12, 15, 20, 25, 22, 18, 15, 10, 5],
    status: 'running',
    pause_reason: null,
    pause_message: null,
    paused_at: null,
    progress: 0,
    total_clicks: 0,
    success_clicks: 0,
    failed_clicks: 0,
    daily_history: [],
    timezone: 'America/New_York',
    is_deleted: false,
    deleted_at: null,
    started_at: null,
    completed_at: null,
    next_run_at: null,
    created_at: '2024-12-28T00:00:00Z',
    updated_at: '2024-12-28T00:00:00Z',
    ...overrides
  });

  describe('业务流程: 从任务创建到完成的完整流程', () => {
    it('应该正确创建任务并初始化分布', () => {
      const dailyClickCount = 240;
      const distribution = generateDefaultDistribution(dailyClickCount, '00:00', '24:00');

      // 验证分布总和正确
      const total = distribution.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(dailyClickCount);

      // 验证分布长度
      expect(distribution).toHaveLength(24);

      // 验证分布形状（电商访问曲线）
      const nightTraffic = distribution.slice(0, 6).reduce((sum, n) => sum + n, 0);
      const peakTraffic = distribution.slice(10, 12).reduce((sum, n) => sum + n, 0);
      const eveningTraffic = distribution.slice(19, 22).reduce((sum, n) => sum + n, 0);

      // 峰值时段应该比凌晨时段有更多流量
      expect(peakTraffic).toBeGreaterThan(nightTraffic);
      expect(eveningTraffic).toBeGreaterThan(nightTraffic);
    });

    it('应该正确计算任务的首次执行时间', () => {
      const now = new Date('2024-12-28T03:00:00Z');
      vi.setSystemTime(now);

      const task = createTestTask({
        scheduled_start_date: '2024-12-28',
        started_at: null,
        hourly_distribution: [0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        start_time: '06:00'
      });

      const nextRun = generateNextRunAt('UTC', task);

      // 首次执行应该在6:00 UTC
      expect(nextRun.getUTCHours()).toBe(6);
    });

    it('应该正确生成子任务', () => {
      const task = createTestTask();
      const targetHour = 10;
      const targetCount = 5;
      const affiliateLink = 'https://example.com/offer123';
      const targetCountry = 'US';

      const subTasks = generateSubTasks(task, targetHour, targetCount, affiliateLink, targetCountry);

      expect(subTasks).toHaveLength(targetCount);
      subTasks.forEach((subTask, index) => {
        expect(subTask.taskId).toBe(task.id);
        expect(subTask.url).toBe(affiliateLink);
        expect(subTask.proxyCountry).toBe(targetCountry);
        expect(subTask.status).toBe('pending');
        expect(subTask.id).toBeTruthy();
      });
    });

    it('应该正确计算任务进度', () => {
      const now = new Date('2024-12-28');
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 3);  // 3天前开始

      const task = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      const progress = calculateProgress(task);

      // 3/7 ≈ 43%
      expect(progress).toBeGreaterThanOrEqual(40);
      expect(progress).toBeLessThanOrEqual(50);
    });

    it('应该正确判断任务是否完成', () => {
      const now = new Date('2024-12-28');
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 8);  // 8天前开始

      const task = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      expect(shouldCompleteTask(task)).toBe(true);
    });
  });

  describe('边界条件测试', () => {
    it('应该正确处理0点击的小时', () => {
      const distribution = [0, 0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const normalized = normalizeDistribution(distribution, 180);

      // 验证总和
      const total = normalized.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(180);
    });

    it('应该正确处理最小的daily_click_count (1)', () => {
      const distribution = generateDefaultDistribution(1, '00:00', '24:00');

      // 总和应该为1
      const total = distribution.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(1);

      // 至少有一个小时有1次点击
      expect(distribution.some(n => n > 0)).toBe(true);
    });

    it('应该正确处理最大的daily_click_count (1000)', () => {
      const distribution = generateDefaultDistribution(1000, '00:00', '24:00');

      const total = distribution.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(1000);
    });

    it('应该正确处理无限期任务', () => {
      const task = createTestTask({
        duration_days: -1,
        started_at: '2024-12-20T00:00:00Z'
      });

      // 进度应该为0
      expect(calculateProgress(task)).toBe(0);

      // 不应该自动完成
      expect(shouldCompleteTask(task)).toBe(false);
    });

    it('应该正确处理跨越午夜的执行时间范围', () => {
      const task = createTestTask({
        start_time: '22:00',
        end_time: '06:00',
        timezone: 'UTC'
      });

      const mockNow = new Date('2024-12-28T23:30:00Z');
      vi.setSystemTime(mockNow);
      expect(isWithinExecutionTimeRange(task)).toBe(true);

      const mockNow2 = new Date('2024-12-28T03:00:00Z');
      vi.setSystemTime(mockNow2);
      expect(isWithinExecutionTimeRange(task)).toBe(true);

      const mockNow3 = new Date('2024-12-28T12:00:00Z');
      vi.setSystemTime(mockNow3);
      expect(isWithinExecutionTimeRange(task)).toBe(false);
    });

    it('应该正确处理24:00结束时间', () => {
      const task = createTestTask({
        start_time: '00:00',
        end_time: '24:00',
        timezone: 'UTC'
      });

      const mockNow = new Date('2024-12-28T23:59:00Z');
      vi.setSystemTime(mockNow);
      expect(isWithinExecutionTimeRange(task)).toBe(true);
    });
  });

  describe('异常处理测试', () => {
    it('应该验证无效的分布数组（长度不为24）', () => {
      const result = validateDistribution([1, 2, 3, 4], 10);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该验证包含负数的分布', () => {
      const distribution = Array(24).fill(10);
      distribution[0] = -5;

      const result = validateDistribution(distribution, 235);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('负数');
    });

    it('应该验证总和不匹配的分布', () => {
      const distribution = Array(24).fill(10);  // 总和240

      const result = validateDistribution(distribution, 200);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('不等于每日点击数');
    });

    it('应该正确处理0点击的目标', () => {
      const result = generateSubTasks(createTestTask(), 10, 0, 'https://test.com', 'US');
      expect(result).toEqual([]);
    });

    it('应该正确处理负数点击目标', () => {
      const result = generateSubTasks(createTestTask(), 10, -5, 'https://test.com', 'US');
      expect(result).toEqual([]);
    });
  });

  describe('配置验证测试', () => {
    it('应该验证CreateClickFarmTaskRequest类型', () => {
      const validRequest: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 216,
        start_time: '06:00',
        end_time: '24:00',
        duration_days: 7,
        scheduled_start_date: '2024-12-28',
        hourly_distribution: Array(24).fill(9)
      };

      expect(validRequest.offer_id).toBe(1);
      expect(validRequest.daily_click_count).toBe(216);
      expect(validRequest.hourly_distribution).toHaveLength(24);
    });

    it('应该支持无限期任务配置', () => {
      const infiniteTask: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 100,
        start_time: '00:00',
        end_time: '24:00',
        duration_days: -1  // -1表示无限期
      };

      expect(infiniteTask.duration_days).toBe(-1);
    });

    it('应该支持可选的时区配置', () => {
      const taskWithTimezone: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 100,
        start_time: '00:00',
        end_time: '24:00',
        duration_days: 7,
        timezone: 'Asia/Shanghai'
      };

      const taskWithoutTimezone: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 100,
        start_time: '00:00',
        end_time: '24:00',
        duration_days: 7
      };

      expect(taskWithTimezone.timezone).toBe('Asia/Shanghai');
      expect(taskWithoutTimezone.timezone).toBeUndefined();
    });
  });

  describe('流量和资源估算测试', () => {
    it('应该正确估算流量消耗', () => {
      const clicks = 1000;
      const traffic = estimateTraffic(clicks);

      expect(traffic).toBe(200000);  // 1000 * 200 bytes

      // 验证格式化输出
      expect(formatBytes(traffic)).toBe('195.3 KB');
    });

    it('应该正确格式化各种大小的流量', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    });

    it('应该正确处理大量点击的流量估算', () => {
      const largeClicks = 100000;
      const traffic = estimateTraffic(largeClicks);

      expect(traffic).toBe(20000000);  // 20MB
      expect(formatBytes(traffic)).toBe('19.1 MB');
    });
  });

  describe('时区处理测试', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('应该正确处理不同时区的任务', () => {
      const usTask = createTestTask({ timezone: 'America/New_York' });
      const cnTask = createTestTask({ timezone: 'Asia/Shanghai' });
      const euTask = createTestTask({ timezone: 'Europe/London' });

      expect(usTask.timezone).toBe('America/New_York');
      expect(cnTask.timezone).toBe('Asia/Shanghai');
      expect(euTask.timezone).toBe('Europe/London');
    });

    it('应该正确计算不同时区的进度', () => {
      const now = new Date('2024-12-28T12:00:00Z');
      vi.setSystemTime(now);

      // 任务在3天前开始
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 3);

      const task7Days = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      const progress = calculateProgress(task7Days);
      expect(progress).toBeGreaterThanOrEqual(40);
      expect(progress).toBeLessThanOrEqual(50);
    });

    it('应该正确处理计划开始日期在未来的任务', () => {
      const futureDate = '2025-01-15';
      const task = createTestTask({
        scheduled_start_date: futureDate,
        started_at: null
      });

      const now = new Date('2024-12-28T12:00:00Z');
      vi.setSystemTime(now);

      const nextRun = generateNextRunAt('UTC', task);

      // 应该返回下一个整点（还没到开始日期）
      expect(nextRun.getUTCMinutes()).toBe(0);
      expect(nextRun.getUTCSeconds()).toBe(0);
    });
  });

  describe('数据完整性测试', () => {
    it('应该正确验证24小时分布数组', () => {
      const validDistribution = Array(24).fill(10);
      const result = validateDistribution(validDistribution, 240);

      expect(result.valid).toBe(true);
      expect(result.actualTotal).toBe(240);
    });

    it('应该拒绝长度错误的分布', () => {
      const invalidDistribution = Array(23).fill(10);
      const result = validateDistribution(invalidDistribution, 230);

      expect(result.valid).toBe(false);
    });

    it('应该正确处理空数组', () => {
      const emptyDistribution = Array(24).fill(0);
      const result = validateDistribution(emptyDistribution, 0);

      expect(result.valid).toBe(true);
      expect(result.actualTotal).toBe(0);
    });

    it('应该正确处理单小时高权重的分布', () => {
      const distribution = Array(24).fill(0);
      distribution[12] = 1000;  // 中午12点有1000次点击

      const normalized = normalizeDistribution(distribution, 1100);

      // 第12个小时应该远大于其他小时
      expect(normalized[12]).toBeGreaterThan(100);
      // 非活跃时段（原始值=0）保持为0
      for (let i = 0; i < 24; i++) {
        if (i !== 12) {
          expect(normalized[i]).toBe(0);
        }
      }
    });
  });

  describe('任务状态转换测试', () => {
    it('应该正确处理暂停状态的任务', () => {
      const pausedTask = createTestTask({
        status: 'paused',
        pause_reason: 'no_proxy',
        pause_message: '缺少US国家的代理配置',
        paused_at: '2024-12-28T10:00:00Z'
      });

      expect(pausedTask.status).toBe('paused');
      expect(pausedTask.pause_reason).toBe('no_proxy');
      expect(pausedTask.paused_at).toBeTruthy();
    });

    it('应该正确处理停止状态的任务', () => {
      const stoppedTask = createTestTask({
        status: 'stopped',
        pause_reason: 'manual',
        pause_message: '用户手动停止'
      });

      expect(stoppedTask.status).toBe('stopped');
      expect(stoppedTask.pause_reason).toBe('manual');
    });

    it('应该正确处理已完成状态的任务', () => {
      const completedTask = createTestTask({
        status: 'completed',
        completed_at: '2024-12-28T18:00:00Z',
        progress: 100,
        total_clicks: 216,
        success_clicks: 210,
        failed_clicks: 6
      });

      expect(completedTask.status).toBe('completed');
      expect(completedTask.progress).toBe(100);
    });

    it('应该正确处理运行中状态的任务', () => {
      const runningTask = createTestTask({
        status: 'running',
        started_at: '2024-12-28T06:00:00Z',
        progress: 50,
        total_clicks: 108,
        next_run_at: '2024-12-28T11:00:00Z'
      });

      expect(runningTask.status).toBe('running');
      expect(runningTask.started_at).toBeTruthy();
      expect(runningTask.next_run_at).toBeTruthy();
    });
  });

  describe('历史记录测试', () => {
    it('应该正确计算累计统计', () => {
      const task = createTestTask({
        total_clicks: 1000,
        success_clicks: 950,
        failed_clicks: 50
      });

      const successRate = (task.success_clicks / task.total_clicks) * 100;
      expect(successRate).toBe(95);
    });

    it('应该正确处理零点击的任务', () => {
      const newTask = createTestTask({
        total_clicks: 0,
        success_clicks: 0,
        failed_clicks: 0
      });

      const successRate = newTask.total_clicks > 0
        ? (newTask.success_clicks / newTask.total_clicks) * 100
        : 0;

      expect(successRate).toBe(0);
    });

    it('应该正确处理大量失败的情况', () => {
      const task = createTestTask({
        total_clicks: 100,
        success_clicks: 60,
        failed_clicks: 40
      });

      const successRate = (task.success_clicks / task.total_clicks) * 100;
      expect(successRate).toBe(60);
      expect(task.failed_clicks).toBe(40);
    });
  });

  describe('软删除测试', () => {
    it('应该正确标记已删除的任务', () => {
      const deletedTask = createTestTask({
        is_deleted: true,
        deleted_at: '2024-12-28T12:00:00Z'
      });

      expect(deletedTask.is_deleted).toBe(true);
      expect(deletedTask.deleted_at).toBeTruthy();
    });

    it('应该正确处理未删除的任务', () => {
      const activeTask = createTestTask({
        is_deleted: false,
        deleted_at: null
      });

      expect(activeTask.is_deleted).toBe(false);
      expect(activeTask.deleted_at).toBeNull();
    });
  });
});

describe('ClickFarm 权重曲线测试', () => {
  describe('电商购物访问曲线验证', () => {
    it('全天版曲线应该有正确的峰值时段', () => {
      const distribution = generateDefaultDistribution(240, '00:00', '24:00');

      // 峰值应该在 10-12点（午休）和 19-22点（晚间）
      const morningPeak = distribution.slice(10, 13).reduce((a, b) => a + b, 0);
      const eveningPeak = distribution.slice(19, 23).reduce((a, b) => a + b, 0);
      const nightLow = distribution.slice(1, 6).reduce((a, b) => a + b, 0);

      // 峰值应该比凌晨低谷高很多
      expect(morningPeak).toBeGreaterThan(nightLow * 2);
      expect(eveningPeak).toBeGreaterThan(nightLow * 2);
    });

    it('白天版曲线应该正确跳过凌晨时段', () => {
      const distribution = generateDefaultDistribution(240, '06:00', '24:00');

      // 凌晨时段应该是0（未设置权重，保持为0）
      expect(distribution[0]).toBe(0);
      expect(distribution[5]).toBe(0);

      // 白天时段应该有所有分布
      const dayTraffic = distribution.slice(6, 24).reduce((a, b) => a + b, 0);
      expect(dayTraffic).toBe(240);
    });

    it('自定义时间范围应该正确应用', () => {
      const distribution = generateDefaultDistribution(120, '08:00', '20:00');

      // 验证总点击数
      const total = distribution.reduce((a, b) => a + b, 0);
      expect(total).toBe(120);

      // 验证时间段外为0（未设置权重，保持为0）
      // 08:00之前有8个小时(0-7)
      const beforeRange = distribution.slice(0, 8).reduce((a, b) => a + b, 0);
      expect(beforeRange).toBe(0);

      // 20:00之后有4个小时(20-23)
      const afterRange = distribution.slice(20, 24).reduce((a, b) => a + b, 0);
      expect(afterRange).toBe(0);

      // 08:00-19:59应该包含所有点击
      const inRange = distribution.slice(8, 20).reduce((a, b) => a + b, 0);
      expect(inRange).toBe(120);
    });
  });

  describe('归一化函数边界测试', () => {
    it('应该正确处理全0输入', () => {
      const distribution = Array(24).fill(0);
      const result = normalizeDistribution(distribution, 24);

      // 全0输入应该返回全0（非活跃时段保持为0）
      result.forEach(value => {
        expect(value).toBe(0);
      });
      expect(result.reduce((a, b) => a + b, 0)).toBe(0);
    });

    it('应该正确处理全相同值', () => {
      const distribution = Array(24).fill(10);
      const result = normalizeDistribution(distribution, 240);

      // 验证总和
      expect(result.reduce((a, b) => a + b, 0)).toBe(240);
    });

    it('应该正确处理极端比例', () => {
      const distribution = [1000, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
      const result = normalizeDistribution(distribution, 1050);

      // 验证总和
      expect(result.reduce((a, b) => a + b, 0)).toBe(1050);

      // 第一个值应该远大于其他值
      expect(result[0]).toBeGreaterThan(result[1] * 100);
    });
  });
});
