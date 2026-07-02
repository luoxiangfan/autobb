import crypto from 'crypto'

/** 应用启动路径判定库是否已初始化的关键表 */
export const DB_INIT_CRITICAL_TABLES = [
  'users',
  'offers',
  'campaigns',
  'system_settings',
  'industry_benchmarks',
  'batch_tasks',
  'upload_records',
  'offer_tasks',
] as const

/** Docker 启动脚本探测 schema 是否就绪的核心表 */
export const DOCKER_SCHEMA_PROBE_TABLES = [
  'users',
  'offers',
  'ad_creatives',
  'campaigns',
  'prompt_versions',
] as const

/** npm run db:init 允许的最少关键表数量（历史兼容：8 表中至少 6 张） */
export const DB_INIT_SMART_MIN_TABLE_COUNT = 6

export const DEFAULT_ADMIN_PROFILE = {
  username: 'autoads',
  email: 'admin@autoads.com',
  display_name: 'AutoAds Administrator',
  role: 'admin',
  package_type: 'lifetime',
  package_expires_at: '2099-12-31T23:59:59.000Z',
} as const

export function resolveDefaultAdminPassword(): string {
  return process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(32).toString('base64')
}
