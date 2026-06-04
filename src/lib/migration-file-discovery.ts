import fs from 'fs'
import path from 'path'

export type MigrationDbType = 'sqlite' | 'postgres'

function matchesMigrationFile(name: string, dbType: MigrationDbType): boolean {
  if (!/^\d{3}_/.test(name) || name.startsWith('000_')) {
    return false
  }

  if (dbType === 'postgres') {
    if (name.endsWith('.pg.sql')) return true
    return name.endsWith('.sql') && !name.endsWith('.sqlite.sql')
  }

  return name.endsWith('.sql') && !name.endsWith('.pg.sql')
}

/**
 * Collect incremental migration files from the migrations root and archived_* subdirectories.
 * Returns POSIX-style relative paths sorted by filename (migration number).
 */
export function listIncrementalMigrationFiles(
  migrationsPath: string,
  dbType: MigrationDbType
): string[] {
  const files: string[] = []

  const scan = (dir: string, relativePrefix = ''): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relativePath = `${relativePrefix}${entry.name}`.replace(/\\/g, '/')

      if (entry.isDirectory()) {
        if (entry.name.startsWith('archived_')) {
          scan(path.join(dir, entry.name), `${relativePath}/`)
        }
        continue
      }

      if (matchesMigrationFile(entry.name, dbType)) {
        files.push(relativePath)
      }
    }
  }

  if (fs.existsSync(migrationsPath)) {
    scan(migrationsPath)
  }

  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
}

export function migrationHistoryName(relativePath: string): string {
  return path.basename(relativePath)
}

export function resolveMigrationFilePath(migrationsPath: string, relativePath: string): string {
  return path.join(migrationsPath, relativePath)
}
