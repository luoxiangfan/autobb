import crypto from 'crypto'

export function calculateMigrationFileHash(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}
