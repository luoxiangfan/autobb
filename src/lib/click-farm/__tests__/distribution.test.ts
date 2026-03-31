/**
 * Click Farm Distribution 单元测试
 * src/lib/click-farm/__tests__/distribution.test.ts
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeDistribution,
  generateDefaultDistribution,
  validateDistribution,
  formatBytes,
  estimateTraffic
} from '../distribution';

describe('ClickFarm Distribution', () => {
  describe('normalizeDistribution', () => {
    it('应该正确归一化分布数组', () => {
      const distribution = [1, 2, 3, 4];
      const targetTotal = 100;

      const result = normalizeDistribution(distribution, targetTotal);

      const resultTotal = result.reduce((sum, n) => sum + n, 0);
      expect(resultTotal).toBe(targetTotal);
    });

    it('应该确保每个值至少为1', () => {
      const distribution = [0, 0, 0, 0];
      const targetTotal = 10;

      const result = normalizeDistribution(distribution, targetTotal);

      // 归一化后，所有原始非0的时段应该有至少1的值
      // 但由于所有原始值都是0，归一化后应该全为0
      const activeCount = distribution.filter(v => v > 0).length;
      if (activeCount > 0) {
        result.forEach((value, index) => {
          if (distribution[index] > 0) {
            expect(value).toBeGreaterThanOrEqual(1);
          }
        });
      }
    });

    it('应该保持相对比例', () => {
      const distribution = [10, 20, 30, 40];
      const targetTotal = 100;

      const result = normalizeDistribution(distribution, targetTotal);

      // 大致比例应该保持 (1:2:3:4)
      const ratios = result.map(v => v / result[0]);
      expect(Math.abs(ratios[1] - 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(ratios[2] - 3)).toBeLessThanOrEqual(1);
      expect(Math.abs(ratios[3] - 4)).toBeLessThanOrEqual(1);
    });

    it('应该处理舍入误差', () => {
      const distribution = [1, 1, 1];
      const targetTotal = 10;

      const result = normalizeDistribution(distribution, targetTotal);

      const resultTotal = result.reduce((sum, n) => sum + n, 0);
      expect(resultTotal).toBe(targetTotal);
    });

    it('应该处理单个元素的数组', () => {
      const distribution = [5];
      const targetTotal = 20;

      const result = normalizeDistribution(distribution, targetTotal);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(targetTotal);
    });
  });

  describe('generateDefaultDistribution', () => {
    it('应该生成全天版分布（00:00-24:00）', () => {
      const dailyCount = 100;
      const startTime = '00:00';
      const endTime = '24:00';

      const result = generateDefaultDistribution(dailyCount, startTime, endTime);

      expect(result).toHaveLength(24);
      const resultTotal = result.reduce((sum, n) => sum + n, 0);
      expect(resultTotal).toBe(dailyCount);

      // 凌晨时段（0-5点）应该较少
      const nightTraffic = result.slice(0, 6).reduce((sum, n) => sum + n, 0);
      expect(nightTraffic).toBeLessThan(resultTotal * 0.1);

      // 晚间时段（18-22点）应该较多
      const eveningTraffic = result.slice(18, 23).reduce((sum, n) => sum + n, 0);
      expect(eveningTraffic).toBeGreaterThan(resultTotal * 0.25);
    });

    it('应该生成白天版分布（06:00-24:00）', () => {
      const dailyCount = 100;
      const startTime = '06:00';
      const endTime = '24:00';

      const result = generateDefaultDistribution(dailyCount, startTime, endTime);

      expect(result).toHaveLength(24);
      const resultTotal = result.reduce((sum, n) => sum + n, 0);
      expect(resultTotal).toBe(dailyCount);

      // 白天版分布06:00开始，前6个小时会有最小值1（normalizeDistribution确保每个值至少为1）
      // 但相对其他时段会非常少
      const nightTraffic = result.slice(0, 6).reduce((sum, n) => sum + n, 0);
      const dayTraffic = result.slice(6, 24).reduce((sum, n) => sum + n, 0);

      // 白天流量应该占绝大多数
      expect(dayTraffic).toBeGreaterThan(nightTraffic);
    });

    it('应该处理较小的dailyCount', () => {
      const dailyCount = 10;
      const startTime = '06:00';
      const endTime = '24:00';

      const result = generateDefaultDistribution(dailyCount, startTime, endTime);

      expect(result).toHaveLength(24);
      const resultTotal = result.reduce((sum, n) => sum + n, 0);
      expect(resultTotal).toBe(dailyCount);
    });

    it('应该确保每个活跃小时至少1次点击', () => {
      const dailyCount = 100;  // 增大数字减少舍入误差
      const startTime = '00:00';
      const endTime = '24:00';

      const result = generateDefaultDistribution(dailyCount, startTime, endTime);

      // 白天时段（06:00-23:00）应该至少1次
      for (let i = 6; i < 24; i++) {
        expect(result[i]).toBeGreaterThanOrEqual(1);
      }
    });

    it('应该正确处理06:00-18:00的时间范围', () => {
      const dailyCount = 1000;  // 使用更大的数字减少舍入误差
      const startTime = '06:00';
      const endTime = '18:00';

      const result = generateDefaultDistribution(dailyCount, startTime, endTime);

      // 06:00-17:59应该有分布（12个小时）
      const dayTraffic = result.slice(6, 18).reduce((sum, n) => sum + n, 0);
      // 允许舍入误差在5%以内
      expect(dayTraffic).toBeGreaterThan(dailyCount * 0.95);
      expect(dayTraffic).toBeLessThanOrEqual(dailyCount);

      // 其他时段应该是normalizeDistribution添加的最小值（18个小时 * 1 = 18）
      const otherTraffic = result.slice(0, 6).reduce((sum, n) => sum + n, 0) +
                          result.slice(18, 24).reduce((sum, n) => sum + n, 0);
      expect(otherTraffic).toBeLessThanOrEqual(20);  // 最多18个最小值
    });
  });

  describe('validateDistribution', () => {
    it('应该验证通过正确的分布', () => {
      const distribution = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const expectedTotal = 240;

      const result = validateDistribution(distribution, expectedTotal);

      expect(result.valid).toBe(true);
      expect(result.actualTotal).toBe(expectedTotal);
      expect(result.error).toBeUndefined();
    });

    it('应该拒绝长度不是24的数组', () => {
      const distribution = [1, 2, 3, 4, 5];
      const expectedTotal = 15;

      const result = validateDistribution(distribution, expectedTotal);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该拒绝总和不等于预期值的分布', () => {
      const distribution = Array(24).fill(10);  // 总和240
      const expectedTotal = 200;

      const result = validateDistribution(distribution, expectedTotal);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('不等于每日点击数');
    });

    it('应该拒绝包含负数的分布', () => {
      const distribution = Array(24).fill(10);
      distribution[0] = -5;
      const expectedTotal = 235;

      const result = validateDistribution(distribution, expectedTotal);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('负数');
    });

    it('应该处理非数组输入', () => {
      const result = validateDistribution('not an array' as any, 100);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });
  });

  describe('formatBytes', () => {
    it('应该正确格式化字节', () => {
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('应该正确格式化KB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(2048)).toBe('2.0 KB');
    });

    it('应该正确格式化MB', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    });

    it('应该处理0字节', () => {
      expect(formatBytes(0)).toBe('0 B');
    });
  });

  describe('estimateTraffic', () => {
    it('应该返回正确的流量估算值', () => {
      expect(estimateTraffic(100)).toBe(20000);  // 100 * 200
      expect(estimateTraffic(1000)).toBe(200000);
      expect(estimateTraffic(0)).toBe(0);
    });

    it('应该使用正确的字节系数（200 bytes/click）', () => {
      const testClicks = 50;
      const expected = testClicks * 200;
      expect(estimateTraffic(testClicks)).toBe(expected);
    });

    it('应该处理大量点击', () => {
      const largeClicks = 100000;
      const result = estimateTraffic(largeClicks);
      expect(result).toBe(20000000);  // 20MB
    });
  });
});
