import { parseJsonField } from '@/lib/db/json-field'

/** 备份 / 列表校验：campaign_config 是否为非空 JSON 对象 */
export function backupHasCampaignConfig(value: unknown): boolean {
  const parsed = parseJsonField<Record<string, unknown> | null>(value, null)
  return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0
}
