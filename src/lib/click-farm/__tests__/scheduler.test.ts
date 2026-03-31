/**
 * Click Farm Scheduler 单元测试
 * src/lib/click-farm/__tests__/scheduler.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateSubTasks,
  isWithinExecutionTimeRange,
  calculateProgress,
  shouldCompleteTask,
  generateNextRunAt
} from '../scheduler';
import type { ClickFarmTask } from '../click-farm-types';

// Mock timezone-utils
vi.mock('../timezone-utils', () => ({
  createDateInTimezone: vi.fn((dateStr: string, timeStr: string, timezone: string) => {
    // 返回一个基于输入构造的Date对象
    const [year, month, day] = dateStr.split('-').map(Number);
    const [hour, minute] = timeStr.split(':').map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }),
  getDateInTimezone: vi.fn((date: Date, timezone: string) => {
    // 模拟返回UTC日期字符串
    return date.toISOString().split('T')[0];
  }),
  getHourInTimezone: vi.fn((date: Date, timezone: string) => {
    // 返回UTC小时
    return date.getUTCHours();
  })
}));

describe('ClickFarm Scheduler', () => {
  // 创建测试任务对象的辅助函数
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

  describe('generateSubTasks', () => {
    it('应该返回空数组当目标点击数为0', () => {
      const task = createTestTask();
      const result = generateSubTasks(task, 10, 0, 'https://test.com', 'US');
      expect(result).toEqual([]);
    });

    it('应该返回空数组当目标点击数为负数', () => {
      const task = createTestTask();
      const result = generateSubTasks(task, 10, -5, 'https://test.com', 'US');
      expect(result).toEqual([]);
    });

    it('应该生成正确数量的子任务', () => {
      const task = createTestTask();
      const targetCount = 5;
      const result = generateSubTasks(task, 10, targetCount, 'https://test.com', 'US');

      expect(result).toHaveLength(targetCount);
    });

    it('所有子任务应该具有正确的属性', () => {
      const task = createTestTask();
      const targetCount = 3;
      const result = generateSubTasks(task, 10, targetCount, 'https://test.com', 'US');

      result.forEach((subTask, index) => {
        expect(subTask).toHaveProperty('id');
        expect(subTask.taskId).toBe(task.id);
        expect(subTask.url).toBe('https://test.com');
        expect(subTask.proxyCountry).toBe('US');
        expect(subTask.status).toBe('pending');
        expect(subTask.scheduledAt).toBeInstanceOf(Date);
      });
    });

    it('子任务应该按时间排序', () => {
      const task = createTestTask();
      const targetCount = 10;
      const result = generateSubTasks(task, 10, targetCount, 'https://test.com', 'US');

      for (let i = 1; i < result.length; i++) {
        expect(result[i].scheduledAt.getTime()).toBeGreaterThanOrEqual(
          result[i - 1].scheduledAt.getTime()
        );
      }
    });

    it('应该生成唯一的子任务ID', () => {
      const task = createTestTask();
      const targetCount = 5;
      const result = generateSubTasks(task, 10, targetCount, 'https://test.com', 'US');

      const ids = result.map(r => r.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(targetCount);
    });
  });

  describe('isWithinExecutionTimeRange', () => {
    it('应该返回true当在执行时间范围内（不跨越午夜）', () => {
      const task = createTestTask({
        start_time: '06:00',
        end_time: '18:00',
        timezone: 'UTC'  // 使用UTC简化测试
      });

      // 模拟当前时间为UTC 12:00
      const mockNow = new Date('2024-12-28T12:00:00Z');
      vi.setSystemTime(mockNow);

      expect(isWithinExecutionTimeRange(task)).toBe(true);
    });

    it('应该返回false当在执行时间范围外（不跨越午夜）', () => {
      const task = createTestTask({
        start_time: '06:00',
        end_time: '18:00',
        timezone: 'UTC'
      });

      // 模拟当前时间为UTC 03:00
      const mockNow = new Date('2024-12-28T03:00:00Z');
      vi.setSystemTime(mockNow);

      expect(isWithinExecutionTimeRange(task)).toBe(false);
    });

    it('应该支持跨越午夜的时间范围', () => {
      const task = createTestTask({
        start_time: '22:00',
        end_time: '06:00',
        timezone: 'UTC'
      });

      // 模拟当前时间为UTC 23:00（在范围内）
      const mockNow = new Date('2024-12-28T23:00:00Z');
      vi.setSystemTime(mockNow);
      expect(isWithinExecutionTimeRange(task)).toBe(true);
    });

    it('应该正确处理跨越午夜的边界（凌晨时段）', () => {
      const task = createTestTask({
        start_time: '22:00',
        end_time: '06:00',
        timezone: 'UTC'
      });

      // 模拟当前时间为UTC 02:00（在范围内）
      const mockNow = new Date('2024-12-28T02:00:00Z');
      vi.setSystemTime(mockNow);
      expect(isWithinExecutionTimeRange(task)).toBe(true);
    });

    it('应该正确处理24:00结束时间', () => {
      const task = createTestTask({
        start_time: '00:00',
        end_time: '24:00',
        timezone: 'UTC'
      });

      // 模拟当前时间为UTC 23:30（在范围内）
      const mockNow = new Date('2024-12-28T23:30:00Z');
      vi.setSystemTime(mockNow);
      expect(isWithinExecutionTimeRange(task)).toBe(true);
    });
  });

  describe('calculateProgress', () => {
    it('无限期任务应该返回0进度', () => {
      const task = createTestTask({
        duration_days: -1,
        started_at: '2024-12-20T00:00:00Z'
      });

      const progress = calculateProgress(task);
      expect(progress).toBe(0);
    });

    it('未开始的任务应该返回0进度', () => {
      const task = createTestTask({
        duration_days: 7,
        started_at: null
      });

      const progress = calculateProgress(task);
      expect(progress).toBe(0);
    });

    it('刚开始的任务应该返回较低进度', () => {
      const now = new Date();
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 1);  // 1天前开始

      const task = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      const progress = calculateProgress(task);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(50);
    });

    it('完成任务应该返回100进度', () => {
      const now = new Date();
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 10);  // 10天前开始

      const task = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      const progress = calculateProgress(task);
      expect(progress).toBe(100);
    });

    it('进度不应该超过100', () => {
      const now = new Date();
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 30);  // 30天前开始

      const task = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      const progress = calculateProgress(task);
      expect(progress).toBeLessThanOrEqual(100);
    });
  });

  describe('shouldCompleteTask', () => {
    it('无限期任务应该永不完成', () => {
      const task = createTestTask({
        duration_days: -1,
        started_at: '2024-12-20T00:00:00Z'
      });

      expect(shouldCompleteTask(task)).toBe(false);
    });

    it('未开始的任务不应该完成', () => {
      const task = createTestTask({
        duration_days: 7,
        started_at: null
      });

      expect(shouldCompleteTask(task)).toBe(false);
    });

    it('未达到duration_days的任务不应该完成', () => {
      const now = new Date();
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 2);  // 2天前开始

      const task = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      expect(shouldCompleteTask(task)).toBe(false);
    });

    it('达到duration_days的任务应该完成', () => {
      const now = new Date();
      const startedAt = new Date(now);
      startedAt.setDate(startedAt.getDate() - 8);  // 8天前开始

      const task = createTestTask({
        duration_days: 7,
        started_at: startedAt.toISOString()
      });

      expect(shouldCompleteTask(task)).toBe(true);
    });
  });

  describe('generateNextRunAt', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('应该返回下一个整点当没有任务对象', () => {
      const now = new Date('2024-12-28T15:30:00Z');
      vi.setSystemTime(now);

      const nextRun = generateNextRunAt('UTC');

      expect(nextRun.getUTCMinutes()).toBe(0);
      expect(nextRun.getUTCSeconds()).toBe(0);
      expect(nextRun.getUTCHours()).toBe(now.getUTCHours() + 1);
    });

    it('应该正确处理scheduled_start_date在未来的情况', () => {
      const now = new Date('2024-12-28T15:30:00Z');
      vi.setSystemTime(now);

      const futureDate = '2024-12-30';
      const task = createTestTask({
        scheduled_start_date: futureDate,
        started_at: null,
        hourly_distribution: [0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        start_time: '06:00'
      });

      const nextRun = generateNextRunAt('UTC', task);

      // 应该返回下一个整点（因为还没到开始日期）
      expect(nextRun.getUTCMinutes()).toBe(0);
      expect(nextRun.getUTCSeconds()).toBe(0);
    });

    it('应该正确计算首次执行时间', () => {
      const now = new Date('2024-12-28T03:00:00Z');  // 凌晨3点
      vi.setSystemTime(now);

      const today = now.toISOString().split('T')[0];
      const task = createTestTask({
        scheduled_start_date: today,
        started_at: null,
        hourly_distribution: [0, 0, 0, 0, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        start_time: '06:00'
      });

      const nextRun = generateNextRunAt('UTC', task);

      // 应该返回6:00（第一个有点击数的小时）
      expect(nextRun.getUTCHours()).toBe(6);
    });

    it('应该使用start_time和firstActiveHour中较大的值', () => {
      const now = new Date('2024-12-28T03:00:00Z');
      vi.setSystemTime(now);

      const today = now.toISOString().split('T')[0];
      const task = createTestTask({
        scheduled_start_date: today,
        started_at: null,
        hourly_distribution: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        start_time: '08:00'  // start_time比firstActiveHour大
      });

      const nextRun = generateNextRunAt('UTC', task);

      // 应该使用08:00（start_time）
      expect(nextRun.getUTCHours()).toBe(8);
    });
  });
});
