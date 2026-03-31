/**
 * 后端时区验证中间件
 * 确保创建/更新补点击任务时，timezone 与 Offer 的 target_country 一致
 *
 * 放置在：src/lib/click-farm/timezone-validator.ts
 */

import { getTimezoneByCountry } from '@/lib/timezone-utils';
import { getDatabase } from '@/lib/db';

export interface TimezoneValidationResult {
  valid: boolean;
  expected: string;
  actual: string;
  message?: string;
}

/**
 * 验证任务的 timezone 是否与 Offer 的 target_country 匹配
 *
 * @param offerId - Offer ID
 * @param timezone - 任务设置的时区
 * @returns 验证结果
 */
export async function validateTimezone(
  offerId: number,
  timezone: string
): Promise<TimezoneValidationResult> {
  const db = await getDatabase();

  // 获取 Offer 的目标国家
  const offer = await db.queryOne<{ target_country: string }>(`
    SELECT target_country
    FROM offers
    WHERE id = ?
  `, [offerId]);

  if (!offer) {
    return {
      valid: false,
      expected: 'N/A',
      actual: timezone,
      message: `Offer #${offerId} 不存在`
    };
  }

  const expectedTimezone = getTimezoneByCountry(offer.target_country);

  if (timezone !== expectedTimezone) {
    console.warn(`[TimezoneValidator] 时区不匹配:`, {
      offerId,
      targetCountry: offer.target_country,
      expectedTimezone,
      actualTimezone: timezone,
      message: '任务时区与Offer国家不匹配，将自动修正'
    });

    return {
      valid: false,
      expected: expectedTimezone,
      actual: timezone,
      message: `时区不匹配：${offer.target_country} 应该使用 ${expectedTimezone}，但提供了 ${timezone}`
    };
  }

  return {
    valid: true,
    expected: expectedTimezone,
    actual: timezone
  };
}

/**
 * 自动修正时区（用于创建/更新任务时）
 *
 * @param offerId - Offer ID
 * @param providedTimezone - 前端提供的时区（可能不正确）
 * @returns 正确的时区
 */
export async function ensureCorrectTimezone(
  offerId: number,
  providedTimezone?: string
): Promise<string> {
  const validation = await validateTimezone(offerId, providedTimezone || '');

  if (!validation.valid) {
    console.log(`[TimezoneValidator] 自动修正时区: ${validation.actual} → ${validation.expected}`);
    return validation.expected;
  }

  return validation.actual;
}
