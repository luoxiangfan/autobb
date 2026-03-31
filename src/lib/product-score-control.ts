import { getDatabase } from '@/lib/db'

const PRODUCT_SCORE_PAUSE_SETTING_KEY = 'product_score_calculation_paused'
const PRODUCT_SCORE_PAUSE_SETTING_DESCRIPTION = '暂停商品推荐指数计算（用于控制AI token消耗）'

function toBooleanLike(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase()
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
  const nowExpr = db.type === 'postgres' ? 'NOW()' : "datetime('now')"
  const falseValue = db.type === 'postgres' ? false : 0
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
