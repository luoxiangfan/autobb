// 分布算法模块
// src/lib/click-farm/distribution.ts

/**
 * 电商购物访问曲线 - 全天版（00:00-24:00）
 *
 * 基于真实电商用户行为特征：
 * - 凌晨（00-06）: 极低流量（失眠党、夜猫子）
 * - 早晨（06-09）: 逐渐上升（通勤、早餐后）
 * - 上午（09-12）: 稳定中等流量（工作间隙）
 * - 午休（12-14）: 午休高峰
 * - 下午（14-18）: 工作时段，流量下降
 * - 晚间（18-22）: 黄金时段，最高峰（下班后、饭后）
 * - 深夜（22-24）: 高流量（睡前刷手机购物）
 */
const ECOMMERCE_FULL_DAY_WEIGHTS = [
  1, 1, 1, 1, 1, 2,      // 00:00-05:59 凌晨低谷
  3, 4, 5, 6, 7, 8,      // 06:00-11:59 早晨逐渐上升
  9, 9, 7, 6, 5, 6,      // 12:00-17:59 午休小高峰 + 下午工作时段
  8, 10, 14, 15, 13, 10  // 18:00-23:59 晚间黄金时段（20-21点最高峰）
];

/**
 * 电商购物访问曲线 - 白天版（06:00-24:00）
 *
 * 与全天版保持一致的权重分布，只是去除了凌晨时段
 */
const ECOMMERCE_DAYTIME_WEIGHTS = [
  3, 4, 5, 6, 7, 8,      // 06:00-11:59 早晨逐渐上升
  9, 9, 7, 6, 5, 6,      // 12:00-17:59 午休小高峰 + 下午工作时段
  8, 10, 14, 15, 13, 10  // 18:00-23:59 晚间黄金时段（20-21点最高峰）
];

/**
 * 归一化分布曲线
 * 确保总和等于目标值，同时保持相对比例
 * 规则：非活跃时段（原始值为0）保持为0；活跃时段（原始值>0）归一化后至少为1
 *
 * @param distribution - 原始分布（24个整数）
 * @param targetTotal - 目标总和（每日点击数量）
 * @returns 归一化后的分布
 */
export function normalizeDistribution(
  distribution: number[],
  targetTotal: number
): number[] {
  // Step 1: 识别活跃时段（原始值 > 0）和非活跃时段（原始值 = 0）
  const activeHours = distribution.map((count, hour) => ({
    hour,
    count,
    isActive: count > 0
  }));

  // Step 2: 计算活跃时段的当前总和
  const activeCounts = activeHours.filter(h => h.isActive).map(h => h.count);
  const currentActiveTotal = activeCounts.reduce((sum, n) => sum + n, 0);

  // 如果没有活跃时段，返回全0的分布
  if (currentActiveTotal === 0) {
    return new Array(24).fill(0);
  }

  // Step 3: 检查是否目标总和太小，无法保持最小值约束
  const activeCount = activeCounts.length;
  const minPossibleTotal = activeCount; // 每个活跃时段至少1

  if (targetTotal < minPossibleTotal) {
    // 目标总和太小，无法保持每个活跃时段至少1
    // 返回全0分布（业务逻辑：无法分配）
    return new Array(24).fill(0);
  }

  // Step 4: 按比例调整活跃时段的点击数
  const result = distribution.map((count, hour) => {
    if (count === 0) return 0; // 非活跃时段保持0
    const adjusted = Math.round((count / currentActiveTotal) * targetTotal);
    return Math.max(adjusted, 1); // 活跃时段至少为1
  });

  // Step 5: 处理舍入误差（只调整活跃时段）
  const resultActiveTotal = result.filter(n => n > 0).reduce((sum, n) => sum + n, 0);
  const diff = targetTotal - resultActiveTotal;

  if (diff !== 0) {
    // 将差额加到最大的活跃时段值
    let maxActiveHour = -1;
    let maxActiveValue = -1;
    for (let hour = 0; hour < 24; hour++) {
      if (result[hour] > maxActiveValue) {
        maxActiveValue = result[hour];
        maxActiveHour = hour;
      }
    }
    if (maxActiveHour >= 0) {
      const newValue = result[maxActiveHour] + diff;
      // 确保不会变成负数或0（保持至少1）
      result[maxActiveHour] = Math.max(1, newValue);
    }
  }

  return result;
}

/**
 * 生成默认分布曲线
 *
 * @param dailyCount - 每日点击数量
 * @param startTime - 开始时间 "00:00" or "06:00"
 * @param endTime - 结束时间 "24:00"
 * @returns 24小时分布数组
 */
export function generateDefaultDistribution(
  dailyCount: number,
  startTime: string,  // "00:00" or "06:00"
  endTime: string     // "24:00"
): number[] {
  // 根据时间段选择对应的曲线
  const weights = startTime === "00:00"
    ? ECOMMERCE_FULL_DAY_WEIGHTS
    : ECOMMERCE_DAYTIME_WEIGHTS;

  const startHour = parseInt(startTime.split(':')[0]);
  const endHour = parseInt(endTime.split(':')[0]);
  const offset = startTime === "00:00" ? 0 : 6;

  // Step 1: 初始分布，非活跃时段保持为0
  const distribution = new Array(24).fill(0);

  // Step 2: 只在执行时间段内应用权重
  let totalWeight = 0;
  for (let hour = startHour; hour < endHour; hour++) {
    totalWeight += weights[hour - offset];
  }

  // Step 3: 按权重分配点击数，确保每个活跃时段至少为1
  for (let hour = startHour; hour < endHour; hour++) {
    const weight = weights[hour - offset];
    const count = Math.round((weight / totalWeight) * dailyCount);
    distribution[hour] = Math.max(1, count);
  }

  // Step 4: 处理舍入误差，确保总和精确
  const currentTotal = distribution.reduce((sum, n) => sum + n, 0);
  const diff = dailyCount - currentTotal;

  if (diff !== 0) {
    // 将差额加到最大的小时值
    let maxHour = -1;
    let maxValue = -1;
    for (let hour = startHour; hour < endHour; hour++) {
      if (distribution[hour] > maxValue) {
        maxValue = distribution[hour];
        maxHour = hour;
      }
    }
    if (maxHour >= 0) {
      distribution[maxHour] += diff;
    }
  }

  // Step 5: 再次检查并确保总和精确（处理diff过大的情况）
  const finalTotal = distribution.reduce((sum, n) => sum + n, 0);
  const finalDiff = dailyCount - finalTotal;
  if (finalDiff !== 0) {
    let maxHour = -1;
    let maxValue = -1;
    for (let hour = startHour; hour < endHour; hour++) {
      if (distribution[hour] > maxValue) {
        maxValue = distribution[hour];
        maxHour = hour;
      }
    }
    if (maxHour >= 0) {
      distribution[maxHour] += finalDiff;
    }
  }

  return distribution;
}

/**
 * 验证分布曲线
 *
 * @param distribution - 分布数组
 * @param expectedTotal - 预期总和
 * @returns { valid: boolean, actualTotal: number, error?: string }
 */
export function validateDistribution(
  distribution: number[],
  expectedTotal: number
): { valid: boolean; actualTotal: number; error?: string } {
  if (!Array.isArray(distribution) || distribution.length !== 24) {
    return {
      valid: false,
      actualTotal: 0,
      error: '分布数组必须包含24个元素'
    };
  }

  const actualTotal = distribution.reduce((sum, n) => sum + n, 0);

  // 🔧 修复：先检查负数，再检查总和
  if (distribution.some(n => n < 0)) {
    return {
      valid: false,
      actualTotal,
      error: '分布数组不能包含负数'
    };
  }

  if (actualTotal !== expectedTotal) {
    return {
      valid: false,
      actualTotal,
      error: `分布总和 (${actualTotal}) 不等于每日点击数 (${expectedTotal})`
    };
  }

  return {
    valid: true,
    actualTotal
  };
}

/**
 * 格式化字节数为可读格式
 *
 * @param bytes - 字节数
 * @returns 格式化后的字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 根据点击数估算流量消耗
 * 平均每次HTTP请求约200 bytes（请求行 + 请求头 + URL）
 *
 * @param clickCount - 点击次数
 * @returns 流量大小（bytes）
 */
export function estimateTraffic(clickCount: number): number {
  return clickCount * 200;
}

/**
 * 均衡分布 - 在活跃时段均匀分配点击数
 * 将每日总点击数均匀分配到所有活跃小时
 *
 * @param dailyCount - 每日点击数量
 * @param startTime - 开始时间 "00:00" or "06:00"
 * @param endTime - 结束时间 "24:00"
 * @returns 24小时分布数组（活跃时段均匀分配，其他时段为0）
 */
export function balanceDistribution(
  dailyCount: number,
  startTime: string,  // "00:00" or "06:00"
  endTime: string     // "24:00"
): number[] {
  const startHour = parseInt(startTime.split(':')[0]);
  const endHour = parseInt(endTime.split(':')[0]);

  // 计算活跃小时数
  const activeHours = endHour - startHour;

  if (activeHours <= 0) {
    return new Array(24).fill(0);
  }

  // 计算每小时均衡分配的点击数
  const baseClicksPerHour = Math.floor(dailyCount / activeHours);
  const remainder = dailyCount % activeHours;

  const distribution = new Array(24).fill(0);

  // 在活跃时段均衡分配
  // 前面的小时分配baseclicks，后面的小时多分配1以处理余数
  for (let hour = startHour; hour < endHour; hour++) {
    const extraClick = hour - startHour < remainder ? 1 : 0;
    distribution[hour] = baseClicksPerHour + extraClick;
  }

  return distribution;
}
