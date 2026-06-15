import path from 'path'
import { getDatabase } from '../db'

const DEFAULT_BACKUP_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'backups')

/**
 * 解析备份目录（cleanup 任务清理旧 pg_dump 文件等仍可能使用）。
 */
export function resolveBackupDir(): string {
  const raw = (process.env.BACKUP_DIR || '').trim()
  if (!raw) {
    return DEFAULT_BACKUP_DIR
  }

  if (path.isAbsolute(raw)) {
    return raw
  }

  return path.join(/*turbopackIgnore: true*/ process.cwd(), raw)
}

export async function backupDatabase(
  backupType: 'manual' | 'auto',
  createdBy?: number
): Promise<{
  success: boolean
  errorMessage?: string
}> {
  const db = await getDatabase()

  try {
    const skipMessage = 'PostgreSQL 环境下已跳过文件备份（请使用 pg_dump 或云服务商备份）'
    console.log(`⚠️ ${skipMessage}`)

    await db.exec(
      `
      INSERT INTO backup_logs (backup_type, status, error_message, created_by)
      VALUES (?, ?, ?, ?)
    `,
      [backupType, 'skipped', skipMessage, createdBy || null]
    )

    return {
      success: true,
      errorMessage: skipMessage,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('❌ Backup failed:', errorMessage)

    try {
      await db.exec(
        `
        INSERT INTO backup_logs (backup_type, status, error_message, created_by)
        VALUES (?, ?, ?, ?)
      `,
        [backupType, 'failed', errorMessage, createdBy || null]
      )
    } catch (logError) {
      console.error('Failed to log backup failure:', logError)
    }

    return { success: false, errorMessage }
  }
}
