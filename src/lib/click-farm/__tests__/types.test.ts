/**
 * Click Farm Types 单元测试
 * src/lib/click-farm/__tests__/types.test.ts
 */

import { describe, it, expect } from 'vitest';
import type {
  ClickFarmTask,
  ClickFarmTaskStatus,
  DailyHistoryEntry,
  CreateClickFarmTaskRequest,
  UpdateClickFarmTaskRequest,
  TaskFilters,
  ClickFarmStats,
  HourlyDistribution,
  SubTask,
  ClickResult,
  ClickFarmNotificationType
} from '../click-farm-types';

describe('ClickFarm Types', () => {
  describe('ClickFarmTaskStatus', () => {
    it('应该接受所有有效的状态值', () => {
      const validStatuses: ClickFarmTaskStatus[] = [
        'pending',
        'running',
        'paused',
        'stopped',
        'completed'
      ];

      validStatuses.forEach(status => {
        expect(status).toBeDefined();
      });
    });
  });

  describe('DailyHistoryEntry', () => {
    it('应该正确创建每日历史记录条目', () => {
      const entry: DailyHistoryEntry = {
        date: '2024-12-28',
        target: 216,
        actual: 200,
        success: 195,
        failed: 5
      };

      expect(entry.date).toBe('2024-12-28');
      expect(entry.target).toBe(216);
      expect(entry.actual).toBe(200);
      expect(entry.success).toBe(195);
      expect(entry.failed).toBe(5);
    });

    it('应该支持可选的hourly_breakdown', () => {
      const entry: DailyHistoryEntry = {
        date: '2024-12-28',
        target: 216,
        actual: 200,
        success: 195,
        failed: 5,
        hourly_breakdown: [
          { target: 10, actual: 10, success: 10, failed: 0 },
          { target: 15, actual: 14, success: 14, failed: 0 }
        ]
      };

      expect(entry.hourly_breakdown).toBeDefined();
      expect(entry.hourly_breakdown).toHaveLength(2);
      expect(entry.hourly_breakdown![0].target).toBe(10);
    });
  });

  describe('ClickFarmStats', () => {
    it('应该正确创建统计数据对象', () => {
      const stats: ClickFarmStats = {
        today: {
          clicks: 100,
          successClicks: 95,
          failedClicks: 5,
          successRate: 95.0,
          traffic: 20000
        },
        cumulative: {
          clicks: 1000,
          successClicks: 950,
          failedClicks: 50,
          successRate: 95.0,
          traffic: 200000
        },
        taskStatusDistribution: {
          pending: 5,
          running: 3,
          paused: 2,
          stopped: 10,
          completed: 20,
          total: 40
        }
      };

      expect(stats.today.clicks).toBe(100);
      expect(stats.cumulative.clicks).toBe(1000);
      expect(stats.taskStatusDistribution.total).toBe(40);
    });
  });

  describe('HourlyDistribution', () => {
    it('应该正确创建时间分布对象', () => {
      const distribution: HourlyDistribution = {
        date: '2024-12-28',
        hourlyActual: Array(24).fill(0),
        hourlyConfigured: Array(24).fill(10),
        matchRate: 85.5
      };

      expect(distribution.hourlyActual).toHaveLength(24);
      expect(distribution.hourlyConfigured).toHaveLength(24);
      expect(distribution.matchRate).toBe(85.5);
    });
  });

  describe('SubTask', () => {
    it('应该正确创建子任务对象', () => {
      const subTask: SubTask = {
        id: 'sub-task-001',
        taskId: 'task-001',
        url: 'https://example.com',
        scheduledAt: new Date('2024-12-28T10:00:00Z'),
        proxyCountry: 'US',
        status: 'pending'
      };

      expect(subTask.id).toBe('sub-task-001');
      expect(subTask.status).toBe('pending');
      expect(subTask.scheduledAt).toBeInstanceOf(Date);
    });
  });

  describe('ClickResult', () => {
    it('应该正确创建点击结果对象（成功）', () => {
      const result: ClickResult = {
        status: 'success'
      };

      expect(result.status).toBe('success');
    });

    it('应该正确创建点击结果对象（失败）', () => {
      const result: ClickResult = {
        status: 'failed',
        errorCode: 'TIMEOUT',
        errorMessage: 'Request timeout after 3 seconds'
      };

      expect(result.status).toBe('failed');
      expect(result.errorCode).toBe('TIMEOUT');
    });
  });

  describe('CreateClickFarmTaskRequest', () => {
    it('应该正确创建任务请求对象', () => {
      const request: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 216,
        start_time: '06:00',
        end_time: '24:00',
        duration_days: 7,
        scheduled_start_date: '2024-12-28',
        hourly_distribution: Array(24).fill(9),
        timezone: 'America/New_York'
      };

      expect(request.offer_id).toBe(1);
      expect(request.daily_click_count).toBe(216);
      expect(request.hourly_distribution).toHaveLength(24);
    });

    it('应该支持-1的duration_days表示无限期', () => {
      const request: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 100,
        start_time: '00:00',
        end_time: '24:00',
        duration_days: -1  // -1表示无限期
      };

      expect(request.duration_days).toBe(-1);
    });

    it('应该支持可选的timezone', () => {
      const requestWithTimezone: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 100,
        start_time: '00:00',
        end_time: '24:00',
        duration_days: 7,
        timezone: 'Asia/Shanghai'
      };

      const requestWithoutTimezone: CreateClickFarmTaskRequest = {
        offer_id: 1,
        daily_click_count: 100,
        start_time: '00:00',
        end_time: '24:00',
        duration_days: 7
      };

      expect(requestWithTimezone.timezone).toBe('Asia/Shanghai');
      expect(requestWithoutTimezone.timezone).toBeUndefined();
    });
  });

  describe('UpdateClickFarmTaskRequest', () => {
    it('应该支持部分更新', () => {
      const update: UpdateClickFarmTaskRequest = {
        daily_click_count: 300,
        start_time: '08:00'
      };

      expect(update.daily_click_count).toBe(300);
      expect(update.start_time).toBe('08:00');
      expect(update.end_time).toBeUndefined();
    });
  });

  describe('TaskFilters', () => {
    it('应该支持所有筛选条件', () => {
      const filters: TaskFilters = {
        status: 'running',
        offer_id: 1,
        page: 1,
        limit: 20
      };

      expect(filters.status).toBe('running');
      expect(filters.page).toBe(1);
    });

    it('应该支持空筛选条件', () => {
      const filters: TaskFilters = {};

      expect(filters.status).toBeUndefined();
      expect(filters.page).toBeUndefined();
    });
  });

  describe('ClickFarmNotificationType', () => {
    it('应该接受所有有效的通知类型', () => {
      const validTypes: ClickFarmNotificationType[] = [
        'task_paused',
        'task_completed',
        'task_resumed'
      ];

      validTypes.forEach(type => {
        expect(type).toBeDefined();
      });
    });
  });

  describe('ClickFarmTask (完整任务对象)', () => {
    it('应该正确创建完整的任务对象', () => {
      const task: ClickFarmTask = {
        id: 'task-001',
        user_id: 1,
        offer_id: 1,
        daily_click_count: 216,
        start_time: '06:00',
        end_time: '24:00',
        duration_days: 7,
        scheduled_start_date: '2024-12-28',
        hourly_distribution: Array(24).fill(9),
        status: 'running',
        pause_reason: null,
        pause_message: null,
        paused_at: null,
        progress: 50,
        total_clicks: 100,
        success_clicks: 95,
        failed_clicks: 5,
        daily_history: [],
        timezone: 'America/New_York',
        is_deleted: false,
        deleted_at: null,
        started_at: '2024-12-28T06:00:00Z',
        completed_at: null,
        next_run_at: '2024-12-28T10:00:00Z',
        created_at: '2024-12-28T00:00:00Z',
        updated_at: '2024-12-28T06:00:00Z'
      };

      expect(task.id).toBe('task-001');
      expect(task.status).toBe('running');
      expect(task.total_clicks).toBe(100);
      expect(task.hourly_distribution).toHaveLength(24);
      expect(task.daily_history).toEqual([]);
    });
  });
});
