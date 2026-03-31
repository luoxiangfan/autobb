/**
 * Migration: Add sync_config table for automated sync settings
 *
 * This migration creates a table to store per-user sync configuration
 * including enabled status, interval, and retry settings.
 */

import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

function migrate() {
  console.log('🔄 Starting migration: add sync_config table')

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH)
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const db = new Database(DB_PATH)

  try {
    // Enable foreign keys
    db.pragma('foreign_keys = ON')

    // Check if table already exists
    const tableExists = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='sync_config'`
      )
      .get()

    if (tableExists) {
      console.log('⚠️  Table sync_config already exists, skipping migration')
      return
    }

    // Create sync_config table
    db.exec(`
      CREATE TABLE sync_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL UNIQUE,

        -- Auto sync settings
        auto_sync_enabled INTEGER NOT NULL DEFAULT 0,
        sync_interval_hours INTEGER NOT NULL DEFAULT 6,

        -- Retry settings
        max_retry_attempts INTEGER NOT NULL DEFAULT 3,
        retry_delay_minutes INTEGER NOT NULL DEFAULT 15,

        -- Notification settings
        notify_on_success INTEGER NOT NULL DEFAULT 0,
        notify_on_failure INTEGER NOT NULL DEFAULT 1,
        notification_email TEXT,

        -- Status tracking
        last_auto_sync_at TEXT,
        next_scheduled_sync_at TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,

        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),

        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `)

    console.log('✅ Created sync_config table')

    // Create index for efficient lookups
    db.exec(`
      CREATE INDEX idx_sync_config_user ON sync_config(user_id);
      CREATE INDEX idx_sync_config_next_sync ON sync_config(next_scheduled_sync_at)
        WHERE auto_sync_enabled = 1;
    `)

    console.log('✅ Created indexes for sync_config')

    // Insert default config for existing users
    db.exec(`
      INSERT INTO sync_config (
        user_id, auto_sync_enabled, sync_interval_hours,
        max_retry_attempts, retry_delay_minutes,
        notify_on_success, notify_on_failure
      )
      SELECT
        id, 0, 6, 3, 15, 0, 1
      FROM users
      WHERE id NOT IN (SELECT user_id FROM sync_config);
    `)

    console.log('✅ Inserted default sync config for existing users')

    // Record migration in history
    db.prepare(
      `INSERT INTO migrations_history (migration_file) VALUES (?)`
    ).run('migrate-add-sync-config.ts')

    console.log('✅ Migration completed successfully')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    db.close()
  }
}

// Run migration if executed directly
if (require.main === module) {
  migrate()
}

export { migrate }
