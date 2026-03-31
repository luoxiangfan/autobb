import fs from 'fs'
import path from 'path'
import { getDatabase } from './db'

const DEFAULT_BACKUP_DIR = path.join(process.cwd(), 'data', 'backups')

type EnsureBackupDirResult = {
  ok: boolean
  backupDir: string
  usedFallback: boolean
  errorMessage?: string
}

/**
 * 解析备份目录。
 * 优先使用 BACKUP_DIR；若未配置则回退到 /data/backups。
 */
export function resolveBackupDir(): string {
  const raw = (process.env.BACKUP_DIR || '').trim()
  if (!raw) {
    return DEFAULT_BACKUP_DIR
  }

  if (path.isAbsolute(raw)) {
    return raw
  }

  return path.resolve(process.cwd(), raw)
}

function tryEnsureWritableDir(dirPath: string): { ok: true } | { ok: false; errorMessage: string } {
  try {
    fs.mkdirSync(dirPath, { recursive: true })
    fs.accessSync(dirPath, fs.constants.W_OK)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, errorMessage: message }
  }
}

function ensureBackupDirWritable(): EnsureBackupDirResult {
  const preferred = resolveBackupDir()
  const candidates = preferred === DEFAULT_BACKUP_DIR
    ? [preferred]
    : [preferred, DEFAULT_BACKUP_DIR]

  let lastError = ''
  for (const candidate of candidates) {
    const result = tryEnsureWritableDir(candidate)
    if (result.ok) {
      return {
        ok: true,
        backupDir: candidate,
        usedFallback: candidate !== preferred,
      }
    }
    lastError = result.errorMessage
  }

  return {
    ok: false,
    backupDir: preferred,
    usedFallback: false,
    errorMessage: `备份目录不可写: ${preferred}${lastError ? ` (${lastError})` : ''}`,
  }
}

export async function performBackup() {
  try {
    const ensureResult = ensureBackupDirWritable()
    if (!ensureResult.ok) {
      throw new Error(ensureResult.errorMessage || '备份目录不可写')
    }

    if (ensureResult.usedFallback) {
      console.warn(`⚠️ BACKUP_DIR 不可写，已回退到默认目录: ${ensureResult.backupDir}`)
    }

    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupPath = path.join(ensureResult.backupDir, `autoads-backup-${timestamp}.db`)

    if (dbPath.endsWith('.db')) {
      fs.copyFileSync(dbPath, backupPath)
      console.log(`✅ Database backup created at ${backupPath}`)
      cleanOldBackups(ensureResult.backupDir)
    } else {
      console.log('⚠️ performBackup() only supports SQLite file copy. Use backupDatabase() for full support.')
    }
  } catch (error) {
    console.error('❌ Backup failed:', error)
  }
}

export async function backupDatabase(backupType: 'manual' | 'auto', createdBy?: number): Promise<{
  success: boolean;
  errorMessage?: string;
  backupFilename?: string;
  backupPath?: string;
  fileSizeBytes?: number;
}> {
  const db = await getDatabase()

  try {
    const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')
    const isPostgres = process.env.DATABASE_URL?.startsWith('postgres')

    if (isPostgres || !dbPath.endsWith('.db')) {
      const skipMessage = 'PostgreSQL环境下已跳过文件备份（PostgreSQL由云服务商自动备份）'
      console.log(`⚠️ ${skipMessage}`)

      await db.exec(`
        INSERT INTO backup_logs (backup_type, status, error_message, created_by)
        VALUES (?, ?, ?, ?)
      `, [backupType, 'skipped', skipMessage, createdBy || null])

      return {
        success: true,
        errorMessage: skipMessage
      }
    }

    const ensureResult = ensureBackupDirWritable()
    if (!ensureResult.ok) {
      throw new Error(ensureResult.errorMessage || '备份目录不可写')
    }

    if (ensureResult.usedFallback) {
      console.warn(`⚠️ BACKUP_DIR 不可写，已回退到默认目录: ${ensureResult.backupDir}`)
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backupFilename = `autoads-backup-${backupType}-${timestamp}.db`
    const backupPath = path.join(ensureResult.backupDir, backupFilename)

    fs.copyFileSync(dbPath, backupPath)
    console.log(`✅ Database backup created at ${backupPath}`)
    cleanOldBackups(ensureResult.backupDir)

    const stats = fs.statSync(backupPath)

    await db.exec(`
      INSERT INTO backup_logs (backup_type, status, backup_filename, backup_path, file_size_bytes, created_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [backupType, 'success', backupFilename, backupPath, stats.size, createdBy || null])

    return {
      success: true,
      backupFilename,
      backupPath,
      fileSizeBytes: stats.size
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('❌ Backup failed:', errorMessage)

    try {
      await db.exec(`
        INSERT INTO backup_logs (backup_type, status, error_message, created_by)
        VALUES (?, ?, ?, ?)
      `, [backupType, 'failed', errorMessage, createdBy || null])
    } catch (logError) {
      console.error('Failed to log backup failure:', logError)
    }

    return { success: false, errorMessage }
  }
}

function cleanOldBackups(backupDir: string) {
  try {
    const files = fs.readdirSync(backupDir)
    const now = Date.now()
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000

    files.forEach(file => {
      const filePath = path.join(backupDir, file)
      const stats = fs.statSync(filePath)
      if (now - stats.mtimeMs > SEVEN_DAYS) {
        fs.unlinkSync(filePath)
        console.log(`🗑️ Deleted old backup: ${file}`)
      }
    })
  } catch (error) {
    console.error('⚠️ Failed to clean old backups:', error)
  }
}

let backupInterval: NodeJS.Timeout | null = null

export function startBackupScheduler() {
  if (backupInterval) return

  console.log('⚠️ startBackupScheduler() 已禁用，请使用队列系统进行备份调度')
  console.log('💡 替代方案：')
  console.log('   1. 手动触发：await triggerBackup({ backupType: "manual", createdBy: userId })')
  console.log('   2. 自动触发：配置外部cron调用API端点')
  console.log('   3. 系统任务：await triggerBackup({ backupType: "auto" })')
  return
}
