/**
 * Timezone Utilities 单元测试
 * src/lib/__tests__/timezone-utils.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  getDateInTimezone,
  getHourInTimezone,
  createDateInTimezone,
  getTimezoneByCountry
} from '../timezone-utils';

describe('Timezone Utilities', () => {
  describe('getDateInTimezone', () => {
    it('应该返回正确的日期字符串', () => {
      // 2024-12-28 12:00:00 UTC
      const date = new Date('2024-12-28T12:00:00Z');
      const result = getDateInTimezone(date, 'UTC');
      expect(result).toBe('2024-12-28');
    });

    it('应该正确处理美国东部时间', () => {
      // 2024-12-28 12:00:00 UTC = 2024-12-28 07:00:00 EST
      const date = new Date('2024-12-28T12:00:00Z');
      const result = getDateInTimezone(date, 'America/New_York');
      expect(result).toBe('2024-12-28');
    });

    it('应该正确处理亚洲上海时间（UTC+8）', () => {
      // 2024-12-28 12:00:00 UTC = 2024-12-28 20:00:00 Shanghai
      const date = new Date('2024-12-28T12:00:00Z');
      const result = getDateInTimezone(date, 'Asia/Shanghai');
      expect(result).toBe('2024-12-28');
    });

    it('应该处理日期边界（跨日后）', () => {
      // 2024-12-28 23:00:00 UTC = 2024-12-29 07:00:00 Shanghai
      const date = new Date('2024-12-28T23:00:00Z');
      const result = getDateInTimezone(date, 'Asia/Shanghai');
      expect(result).toBe('2024-12-29');
    });

    it('应该处理跨日后返回前一天（美国东部）', () => {
      // 2024-12-28 02:00:00 UTC = 2024-12-27 21:00:00 EST (前一天)
      const date = new Date('2024-12-28T02:00:00Z');
      const result = getDateInTimezone(date, 'America/New_York');
      expect(result).toBe('2024-12-27');
    });
  });

  describe('getHourInTimezone', () => {
    it('应该返回正确的UTC小时', () => {
      const date = new Date('2024-12-28T15:30:00Z');
      const result = getHourInTimezone(date, 'UTC');
      expect(result).toBe(15);
    });

    it('应该正确处理美国东部时间（UTC-5或UTC-4）', () => {
      const date = new Date('2024-12-28T15:30:00Z');
      const result = getHourInTimezone(date, 'America/New_York');
      // 12月是EST (UTC-5)
      expect(result).toBe(10);
    });

    it('应该正确处理夏令时时间', () => {
      // 2024年7月15日是夏令时期间 (EDT UTC-4)
      const date = new Date('2024-07-15T15:30:00Z');
      const result = getHourInTimezone(date, 'America/New_York');
      expect(result).toBe(11);
    });

    it('应该正确处理亚洲上海时间（UTC+8）', () => {
      const date = new Date('2024-12-28T15:30:00Z');
      const result = getHourInTimezone(date, 'Asia/Shanghai');
      expect(result).toBe(23);
    });

    it('应该处理午夜边界', () => {
      // 2024-12-28 23:30:00 UTC = 2024-12-29 07:30:00 Shanghai
      const date = new Date('2024-12-28T23:30:00Z');
      const result = getHourInTimezone(date, 'Asia/Shanghai');
      expect(result).toBe(7);
    });
  });

  describe('createDateInTimezone', () => {
    it('应该创建正确的Date对象', () => {
      const result = createDateInTimezone('2024-12-28', '15:30', 'UTC');

      expect(result.getUTCFullYear()).toBe(2024);
      expect(result.getUTCMonth()).toBe(11);  // 12月
      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCHours()).toBe(15);
      expect(result.getUTCMinutes()).toBe(30);
    });

    it('应该正确处理时区偏移', () => {
      // 创建美国东部时间 2024-12-28 10:00
      // createDateInTimezone 返回的是 UTC Date 对象
      // 纽约时间 10:00 EST (UTC-5) = UTC 15:00
      const result = createDateInTimezone('2024-12-28', '10:00', 'America/New_York');

      // 结果应该是 UTC 15:00 (EST UTC-5)
      expect(result.getUTCHours()).toBe(15);
    });

    it('应该处理单数字的小时和分钟', () => {
      const result = createDateInTimezone('2024-12-28', '9:5', 'UTC');

      expect(result.getUTCHours()).toBe(9);
      expect(result.getUTCMinutes()).toBe(5);
    });

    it('应该正确处理日期边界', () => {
      // 创建东京时间 2024-12-28 23:30
      // UTC 应该是 2024-12-28 14:30 (UTC+9)
      const result = createDateInTimezone('2024-12-28', '23:30', 'Asia/Tokyo');

      expect(result.getUTCDate()).toBe(28);
      expect(result.getUTCHours()).toBe(14);
      expect(result.getUTCMinutes()).toBe(30);
    });
  });

  describe('getTimezoneByCountry', () => {
    it('应该返回正确的美国时区', () => {
      expect(getTimezoneByCountry('US')).toBe('America/New_York');
      expect(getTimezoneByCountry('USA')).toBe('America/New_York');
    });

    it('应该返回正确的英国时区', () => {
      expect(getTimezoneByCountry('GB')).toBe('Europe/London');
    });

    it('应该返回正确的中国时区', () => {
      expect(getTimezoneByCountry('CN')).toBe('Asia/Shanghai');
    });

    it('应该返回正确的德国时区', () => {
      expect(getTimezoneByCountry('DE')).toBe('Europe/Berlin');
    });

    it('应该返回正确的日本时区', () => {
      expect(getTimezoneByCountry('JP')).toBe('Asia/Tokyo');
    });

    it('应该处理小写国家代码', () => {
      expect(getTimezoneByCountry('us')).toBe('America/New_York');
      expect(getTimezoneByCountry('cn')).toBe('Asia/Shanghai');
    });

    it('应该处理未知国家代码', () => {
      // 应该返回默认时区
      const result = getTimezoneByCountry('UNKNOWN');
      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
    });

    it('应该处理空字符串', () => {
      const result = getTimezoneByCountry('');
      expect(result).toBeTruthy();
    });
  });
});
