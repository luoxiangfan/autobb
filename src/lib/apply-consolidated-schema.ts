import fs from 'fs'
import type postgres from 'postgres'
import { splitSqlStatements } from './sql-splitter'
import { normalizeMigrationSql } from './migration-sql-preprocess'

export function isIgnorablePostgresSchemaError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code)
      : ''

  return (
    code === '23505' ||
    msg.includes('already exists') ||
    msg.includes('duplicate key') ||
    msg.includes('unique constraint') ||
    msg.includes('唯一约束') ||
    msg.includes('重复键')
  )
}

export function resolveConsolidatedSchemaPath(candidates: string[]): string {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(`找不到 consolidated schema 文件:\n${candidates.join('\n')}`)
}

export function loadConsolidatedSchemaStatements(schemaPath: string): string[] {
  const sqlContent = normalizeMigrationSql(fs.readFileSync(schemaPath, 'utf-8'))
  return splitSqlStatements(sqlContent)
}

export async function applyConsolidatedSchemaStatements(
  sql: ReturnType<typeof postgres>,
  statements: string[],
  options?: { logSkipped?: boolean }
): Promise<{ ok: number; skipped: number }> {
  let ok = 0
  let skipped = 0

  for (const stmt of statements) {
    const trimmed = stmt.trim()
    if (!trimmed) continue

    try {
      await sql.unsafe(trimmed)
      ok++
    } catch (error) {
      if (isIgnorablePostgresSchemaError(error)) {
        skipped++
        if (options?.logSkipped) {
          console.log(`   ⏭️  跳过幂等语句: ${trimmed.substring(0, 80)}...`)
        }
        continue
      }
      throw error
    }
  }

  return { ok, skipped }
}
