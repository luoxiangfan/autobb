import { getDatabase } from '@/lib/db'

/** 历史误分类：有 ASIN 但 product_url 为空时被记为非 Amazon 落地页 */
export const LEGACY_AMAZON_MISCLASSIFIED_REASON = '非Amazon落地页,信任度相对较低'

/** affiliate_products 自愈/增量评分共用的 SQL 片段 */
export const LEGACY_AMAZON_MISCLASSIFIED_SQL_CONDITION = `(
  NULLIF(TRIM(COALESCE(asin, '')), '') IS NOT NULL
  AND TRIM(COALESCE(product_url, '')) = ''
  AND COALESCE(recommendation_reasons, '') LIKE '%${LEGACY_AMAZON_MISCLASSIFIED_REASON}%'
)`

const PRODUCT_SCORE_PAUSE_SETTING_KEY = 'product_score_calculation_paused'
const PRODUCT_SCORE_PAUSE_SETTING_DESCRIPTION = '暂停商品推荐指数计算（用于控制AI token消耗）'

function toBooleanLike(value: unknown): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  return ['1', 'true', 'yes', 'on'].includes(normalized)
}

export class ProductScoreCalculationPausedError extends Error {
  readonly code = 'PRODUCT_SCORE_CALCULATION_PAUSED'

  constructor(message = '推荐指数计算已暂停') {
    super(message)
    this.name = 'ProductScoreCalculationPausedError'
  }
}

export function isProductScoreCalculationPausedError(
  error: unknown
): error is ProductScoreCalculationPausedError {
  return error instanceof ProductScoreCalculationPausedError
}

export async function isProductScoreCalculationPaused(userId: number): Promise<boolean> {
  if (!Number.isFinite(userId) || userId <= 0) return false

  const db = await getDatabase()
  const row = await db.queryOne<{ value: string | null }>(
    `
      SELECT value
      FROM system_settings
      WHERE user_id = ?
        AND category = 'system'
        AND key = ?
      LIMIT 1
    `,
    [userId, PRODUCT_SCORE_PAUSE_SETTING_KEY]
  )

  return toBooleanLike(row?.value)
}

export async function setProductScoreCalculationPaused(
  userId: number,
  paused: boolean
): Promise<void> {
  if (!Number.isFinite(userId) || userId <= 0) {
    throw new Error('setProductScoreCalculationPaused requires a valid userId')
  }

  const db = await getDatabase()
  const nowExpr = 'NOW()'
  const falseValue = false
  const value = paused ? 'true' : 'false'

  const existing = await db.queryOne<{ id: number }>(
    `
      SELECT id
      FROM system_settings
      WHERE user_id = ?
        AND category = 'system'
        AND key = ?
      LIMIT 1
    `,
    [userId, PRODUCT_SCORE_PAUSE_SETTING_KEY]
  )

  if (existing?.id) {
    await db.exec(
      `
        UPDATE system_settings
        SET value = ?, updated_at = ${nowExpr}
        WHERE id = ?
      `,
      [value, existing.id]
    )
    return
  }

  await db.exec(
    `
      INSERT INTO system_settings (
        user_id,
        category,
        key,
        value,
        data_type,
        is_sensitive,
        is_required,
        description
      ) VALUES (?, 'system', ?, ?, 'string', ?, ?, ?)
    `,
    [
      userId,
      PRODUCT_SCORE_PAUSE_SETTING_KEY,
      value,
      falseValue,
      falseValue,
      PRODUCT_SCORE_PAUSE_SETTING_DESCRIPTION,
    ]
  )
}
