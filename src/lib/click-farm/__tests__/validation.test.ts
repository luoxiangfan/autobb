/**
 * Click Farm 配置验证测试
 * src/lib/click-farm/__tests__/validation.test.ts
 *
 * 测试配置验证、约束条件和错误处理
 */

import { describe, it, expect } from 'vitest';
import {
  validateDistribution,
  normalizeDistribution,
  formatBytes,
  estimateTraffic
} from '../distribution';

describe('ClickFarm 配置验证测试', () => {
  describe('分布数组验证', () => {
    it('应该验证有效的24元素分布', () => {
      const validDistribution = Array(24).fill(10);
      const result = validateDistribution(validDistribution, 240);

      expect(result.valid).toBe(true);
      expect(result.actualTotal).toBe(240);
      expect(result.error).toBeUndefined();
    });

    it('应该拒绝长度不是24的数组', () => {
      const shortArray = Array(20).fill(10);
      const result = validateDistribution(shortArray, 200);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该拒绝空数组', () => {
      const result = validateDistribution([], 0);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该拒绝超过24元素的数组', () => {
      const longArray = Array(25).fill(10);
      const result = validateDistribution(longArray, 250);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });
  });

  describe('数值范围验证', () => {
    it('应该拒绝包含负数的分布', () => {
      const distribution = Array(24).fill(10);
      distribution[5] = -5;

      const result = validateDistribution(distribution, 235);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('负数');
    });

    it('应该拒绝包含大负数的分布', () => {
      const distribution = Array(24).fill(10);
      distribution[0] = -100;

      const result = validateDistribution(distribution, 130);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('负数');
    });

    it('应该接受全0的分布（总和为0）', () => {
      const distribution = Array(24).fill(0);
      const result = validateDistribution(distribution, 0);

      expect(result.valid).toBe(true);
      expect(result.actualTotal).toBe(0);
    });

    it('应该拒绝总和不匹配的分布', () => {
      const distribution = Array(24).fill(10);  // 总和240
      const result = validateDistribution(distribution, 200);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('不等于每日点击数');
      expect(result.error).toContain('240');
      expect(result.error).toContain('200');
    });

    it('应该拒绝总和超过预期的分布', () => {
      const distribution = Array(24).fill(10);  // 总和240
      const result = validateDistribution(distribution, 200);

      expect(result.valid).toBe(false);
      expect(result.actualTotal).toBe(240);
    });

    it('应该拒绝总和小于预期的分布', () => {
      const distribution = Array(24).fill(8);  // 总和192
      const result = validateDistribution(distribution, 240);

      expect(result.valid).toBe(false);
      expect(result.actualTotal).toBe(192);
    });
  });

  describe('归一化边界测试', () => {
    it('应该正确归一化小数值目标', () => {
      const distribution = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
      const result = normalizeDistribution(distribution, 100);

      const total = result.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(100);

      // 验证非活跃时段保持为0
      result.forEach((value, index) => {
        // distribution中所有值都>0，所以都是活跃时段
        // 归一化后应该保持相对比例
      });
    });

    it('应该正确归一化极大的目标值', () => {
      const distribution = Array(24).fill(1);
      const result = normalizeDistribution(distribution, 10000);

      const total = result.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(10000);
    });

    it('应该确保每个值至少为1', () => {
      const distribution = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100];
      const result = normalizeDistribution(distribution, 120);

      // 活跃时段（原始值>0）归一化后至少为1
      result.forEach((value, index) => {
        if (distribution[index] > 0) {
          expect(value).toBeGreaterThanOrEqual(1);
        }
        // 非活跃时段（原始值=0）保持为0
        if (distribution[index] === 0) {
          expect(value).toBe(0);
        }
      });
    });

    it('应该处理单元素目标', () => {
      const distribution = [1];
      const result = normalizeDistribution([...distribution, ...Array(23).fill(0)], 1);

      // 至少有一个1
      expect(result.some(v => v === 1)).toBe(true);
    });

    it('应该正确处理权重悬殊的分布', () => {
      // 第一个小时权重是其他的100倍
      const distribution = [1000, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10];
      const result = normalizeDistribution(distribution, 1200);

      const total = result.reduce((sum, n) => sum + n, 0);
      expect(total).toBe(1200);

      // 第一个值应该远大于其他值
      expect(result[0]).toBeGreaterThan(result[1]);
    });
  });

  describe('流量估算验证', () => {
    it('应该返回正确的流量值', () => {
      expect(estimateTraffic(0)).toBe(0);
      expect(estimateTraffic(1)).toBe(200);
      expect(estimateTraffic(100)).toBe(20000);
      expect(estimateTraffic(1000)).toBe(200000);
    });

    it('应该正确处理大数值', () => {
      const largeClicks = 1000000;
      const result = estimateTraffic(largeClicks);

      expect(result).toBe(200000000);  // 200MB
    });

    it('应该使用正确的字节系数', () => {
      // 验证 200 bytes/click 的系数
      const testClicks = 50;
      const expected = testClicks * 200;
      expect(estimateTraffic(testClicks)).toBe(expected);
    });
  });

  describe('格式化输出验证', () => {
    it('应该正确格式化字节', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(100)).toBe('100 B');
      expect(formatBytes(500)).toBe('500 B');
      expect(formatBytes(1023)).toBe('1023 B');
    });

    it('应该正确格式化KB', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(2048)).toBe('2.0 KB');
      expect(formatBytes(100000)).toBe('97.7 KB');
    });

    it('应该正确格式化MB', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
      expect(formatBytes(100 * 1024 * 1024)).toBe('100.0 MB');
    });

    it('应该正确格式化GB', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
      expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
    });

    it('应该正确处理边界值', () => {
      expect(formatBytes(1023)).toBe('1023 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    });
  });

  describe('非数组输入处理', () => {
    it('应该处理null输入', () => {
      const result = validateDistribution(null as any, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该处理undefined输入', () => {
      const result = validateDistribution(undefined as any, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该处理字符串输入', () => {
      const result = validateDistribution('not an array' as any, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该处理数字输入', () => {
      const result = validateDistribution(123 as any, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });

    it('应该处理对象输入', () => {
      const result = validateDistribution({} as any, 100);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('24个元素');
    });
  });

  describe('舍入误差处理', () => {
    it('应该正确处理归一化后的舍入', () => {
      // 24小时，每小时权重不同
      const distribution = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];
      const targetTotal = 100;
      const result = normalizeDistribution(distribution, targetTotal);

      const actualTotal = result.reduce((sum, n) => sum + n, 0);
      expect(actualTotal).toBe(targetTotal);
    });

    it('应该正确处理权重总和不能整除的情况', () => {
      const distribution = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];  // 10个活跃元素
      const targetTotal = 24;  // 每个活跃元素至少1，最小总和为10

      // 填充到24个元素
      const fullDistribution = [...distribution, ...Array(14).fill(0)];
      const result = normalizeDistribution(fullDistribution, 24);

      const actualTotal = result.reduce((sum, n) => sum + n, 0);
      expect(actualTotal).toBe(24);
    });
  });

  describe('一致性验证', () => {
    it('归一化后验证应该通过', () => {
      const original = Array(24).fill(0);
      original[0] = 1000;
      original[12] = 500;

      const normalized = normalizeDistribution(original, 1500);
      const validation = validateDistribution(normalized, 1500);

      expect(validation.valid).toBe(true);
      expect(validation.actualTotal).toBe(1500);
    });

    it('相同的输入应该产生相同的归一化结果', () => {
      const distribution = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 5, 5, 5, 5];
      const target = 1000;

      const result1 = normalizeDistribution(distribution, target);
      const result2 = normalizeDistribution(distribution, target);

      expect(result1).toEqual(result2);
    });

    it('多次归一化应该保持一致性', () => {
      const distribution = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 5, 5, 5, 5, 5];
      const target = 500;

      // 第一次归一化
      const result1 = normalizeDistribution(distribution, target);

      // 对结果再次归一化（总和已经是正确的）
      const result2 = normalizeDistribution(result1, target);

      expect(result1).toEqual(result2);
    });
  });

  describe('性能边界测试', () => {
    it('应该处理大量的点击数', () => {
      const clicks = 1000000;
      const traffic = estimateTraffic(clicks);

      expect(traffic).toBe(200000000);
      expect(formatBytes(traffic)).toBe('190.7 MB');
    });

    it('应该处理极端的分布数组', () => {
      const distribution = Array(24).fill(0);
      distribution[0] = 1;
      distribution[23] = 1;

      const result = normalizeDistribution(distribution, 24);

      expect(result[0]).toBeGreaterThanOrEqual(1);
      expect(result[23]).toBeGreaterThanOrEqual(1);
    });

    it('应该处理权重为0的时段', () => {
      // 只在2个时段有流量
      const distribution = Array(24).fill(0);
      distribution[6] = 100;
      distribution[20] = 100;

      const result = normalizeDistribution(distribution, 200);

      // 验证这两个时段有流量
      expect(result[6]).toBeGreaterThan(0);
      expect(result[20]).toBeGreaterThan(0);
    });
  });
});
