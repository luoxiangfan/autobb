/**
 * 修复 risk_alerts 表结构
 *
 * 问题：旧表使用 risk_type, related_type, related_id
 * 应该：使用 alert_type, resource_type, resource_id, acknowledged_at, resolution_note, details
 */

import Database from 'better-sqlite3'
import * as path from 'path'
import * as fs from 'fs'

const DB_PATH = path.join(process.cwd(), 'data', 'autoads.db')

async function fixRiskAlertsSchema() {
  console.log('🔧 开始修复 risk_alerts 表结构...')

  const db = new Database(DB_PATH)

  try {
    // 1. 备份现有数据
    console.log('📦 备份现有数据...')
    const existingAlerts = db.prepare('SELECT * FROM risk_alerts').all()
    console.log(`   找到 ${existingAlerts.length} 条现有风险提示`)

    // 2. 删除旧表
    console.log('🗑️  删除旧表结构...')
    db.prepare('DROP TABLE IF EXISTS risk_alerts').run()

    // 3. 重新创建表（使用正确的结构）
    console.log('🏗️  创建新表结构...')
    db.exec(`
      CREATE TABLE IF NOT EXISTS risk_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,

        -- 风险类型
        alert_type TEXT NOT NULL CHECK (alert_type IN (
          'link_broken',           -- 链接失效
          'link_redirect',         -- 链接重定向
          'link_timeout',          -- 链接超时
          'account_suspended',     -- 账号暂停
          'account_sync_error',    -- 账号同步错误
          'account_stale_data',    -- 账号数据过期
          'campaign_paused',       -- Campaign异常暂停
          'budget_exhausted',      -- 预算耗尽
          'low_quality_score'      -- 质量分过低
        )),

        -- 严重程度
        severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),

        -- 关联资源
        resource_type TEXT CHECK (resource_type IN ('campaign', 'creative', 'offer')),
        resource_id INTEGER,

        -- 提示内容
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        details TEXT, -- JSON格式的详细信息

        -- 处理状态
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),

        -- 时间戳
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        acknowledged_at TEXT,
        resolved_at TEXT,

        -- 备注
        resolution_note TEXT,

        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `)

    // 4. 创建索引
    console.log('📊 创建索引...')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_risk_alerts_user_status
      ON risk_alerts(user_id, status, severity);

      CREATE INDEX IF NOT EXISTS idx_risk_alerts_type
      ON risk_alerts(alert_type, status);

      CREATE INDEX IF NOT EXISTS idx_risk_alerts_created
      ON risk_alerts(created_at DESC);
    `)

    // 5. 如果有数据，尝试迁移
    if (existingAlerts.length > 0) {
      console.log('📥 迁移旧数据...')
      const insertStmt = db.prepare(`
        INSERT INTO risk_alerts (
          id, user_id, alert_type, severity, resource_type, resource_id,
          title, message, status, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      let migrated = 0
      for (const alert of existingAlerts as any[]) {
        try {
          insertStmt.run(
            alert.id,
            alert.user_id,
            alert.risk_type || 'link_broken', // risk_type -> alert_type
            alert.severity,
            alert.related_type || null, // related_type -> resource_type
            alert.related_id || null, // related_id -> resource_id
            alert.title,
            alert.message,
            alert.status,
            alert.created_at || alert.detected_at,
            alert.resolved_at
          )
          migrated++
        } catch (err) {
          console.warn(`   ⚠️  迁移失败: ${alert.id} - ${err}`)
        }
      }
      console.log(`   ✅ 成功迁移 ${migrated}/${existingAlerts.length} 条数据`)
    }

    // 6. 验证表结构
    console.log('🔍 验证表结构...')
    const tableInfo = db.prepare('PRAGMA table_info(risk_alerts)').all()
    const columnNames = (tableInfo as any[]).map(col => col.name)

    const requiredColumns = [
      'id', 'user_id', 'alert_type', 'severity', 'resource_type',
      'resource_id', 'title', 'message', 'details', 'status',
      'created_at', 'acknowledged_at', 'resolved_at', 'resolution_note'
    ]

    const missingColumns = requiredColumns.filter(col => !columnNames.includes(col))

    if (missingColumns.length > 0) {
      console.error('❌ 缺少必需的列:', missingColumns)
      throw new Error('表结构验证失败')
    }

    console.log('✅ 表结构验证通过！')
    console.log('   列: ' + columnNames.join(', '))

    console.log('\n🎉 risk_alerts 表结构修复完成！')

  } catch (error) {
    console.error('❌ 修复失败:', error)
    throw error
  } finally {
    db.close()
  }
}

// 执行修复
fixRiskAlertsSchema()
  .then(() => {
    console.log('✅ 所有操作完成')
    process.exit(0)
  })
  .catch(err => {
    console.error('❌ 执行失败:', err)
    process.exit(1)
  })
