import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('🚀 开始迁移：创建广告创意和Google Ads相关表...')
console.log('📍 数据库路径:', dbPath)

const db = new Database(dbPath)

try {
  // 启用外键约束
  db.pragma('foreign_keys = ON')

  // 1. 创建ad_creatives表 - 存储AI生成的广告创意
  console.log('\n📋 创建ad_creatives表...')
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_creatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      offer_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,

      -- 广告创意内容
      headlines TEXT NOT NULL,           -- JSON数组，最多15个headline
      descriptions TEXT NOT NULL,        -- JSON数组，最多4个description
      keywords TEXT,                     -- JSON数组，关键词列表
      callouts TEXT,                     -- JSON数组，标注信息
      sitelinks TEXT,                    -- JSON数组，站点链接

      -- URL配置
      final_url TEXT NOT NULL,           -- 最终落地页URL
      final_url_suffix TEXT,             -- URL后缀（tracking参数）

      -- 评分信息
      score REAL,                        -- 总评分 (0-100)
      score_breakdown TEXT,              -- JSON格式的评分详情
      score_explanation TEXT,            -- 评分依据说明

      -- 生成信息
      generation_round INTEGER DEFAULT 1, -- 第几轮生成（支持最多3轮）
      theme TEXT,                         -- 广告主题
      ai_model TEXT,                      -- 使用的AI模型 (vertex-ai/gemini-api)
      is_selected INTEGER DEFAULT 0,      -- 是否被用户选中

      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),

      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ ad_creatives表创建成功')

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ad_creatives_offer_id ON ad_creatives(offer_id);
    CREATE INDEX IF NOT EXISTS idx_ad_creatives_user_id ON ad_creatives(user_id);
    CREATE INDEX IF NOT EXISTS idx_ad_creatives_is_selected ON ad_creatives(is_selected);
  `)

  // 2. 创建google_ads_credentials表 - 存储Google Ads OAuth凭证
  console.log('\n📋 创建google_ads_credentials表...')
  db.exec(`
    CREATE TABLE IF NOT EXISTS google_ads_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,

      -- OAuth凭证
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      access_token TEXT,

      -- Google Ads配置
      developer_token TEXT NOT NULL,
      login_customer_id TEXT,            -- Manager账号ID

      -- Token过期时间
      access_token_expires_at TEXT,

      -- 状态
      is_active INTEGER DEFAULT 1,
      last_verified_at TEXT,

      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),

      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `)
  console.log('✅ google_ads_credentials表创建成功')

  // 3. 扩展campaigns表 - 添加Google Ads相关字段
  console.log('\n📋 扩展campaigns表...')

  const campaignsTableInfo = db.pragma('table_info(campaigns)') as Array<{ name: string }>
  const existingCampaignColumns = campaignsTableInfo.map(col => col.name)

  const campaignColumnsToAdd = [
    { name: 'ad_creative_id', type: 'INTEGER', description: '关联的广告创意ID' },
    { name: 'google_campaign_id', type: 'TEXT', description: 'Google Ads Campaign ID' },
    { name: 'google_ad_group_id', type: 'TEXT', description: 'Google Ads Ad Group ID' },
    { name: 'google_ad_id', type: 'TEXT', description: 'Google Ads Ad ID' },
    { name: 'campaign_config', type: 'TEXT', description: 'Campaign配置（JSON）' },
    { name: 'pause_old_campaigns', type: 'INTEGER', description: '是否暂停旧广告系列' }
  ]

  let campaignColumnsAdded = 0
  for (const column of campaignColumnsToAdd) {
    if (existingCampaignColumns.includes(column.name)) {
      console.log(`⏭️  字段 "${column.name}" 已存在，跳过`)
    } else {
      db.exec(`ALTER TABLE campaigns ADD COLUMN ${column.name} ${column.type}`)
      console.log(`✅ 添加字段: ${column.name} (${column.description})`)
      campaignColumnsAdded++
    }
  }

  // 4. 创建ad_performance表 - 存储广告表现数据（用于AI优化）
  console.log('\n📋 创建ad_performance表...')
  db.exec(`
    CREATE TABLE IF NOT EXISTS ad_performance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      offer_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,

      -- Google Ads标识
      google_campaign_id TEXT NOT NULL,
      google_ad_group_id TEXT,
      google_ad_id TEXT,

      -- 表现指标
      date TEXT NOT NULL,                -- 数据日期
      impressions INTEGER DEFAULT 0,
      clicks INTEGER DEFAULT 0,
      conversions REAL DEFAULT 0,
      cost_micros INTEGER DEFAULT 0,     -- 费用（微单位）

      -- 计算指标
      ctr REAL,                          -- 点击率
      cpc_micros INTEGER,                -- 每次点击费用
      conversion_rate REAL,              -- 转化率

      -- 原始数据
      raw_data TEXT,                     -- JSON格式的完整数据

      synced_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),

      FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
      FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

      UNIQUE(google_campaign_id, date)
    )
  `)
  console.log('✅ ad_performance表创建成功')

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_ad_performance_campaign ON ad_performance(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_ad_performance_offer ON ad_performance(offer_id);
    CREATE INDEX IF NOT EXISTS idx_ad_performance_date ON ad_performance(date);
  `)

  console.log('\n✅ 数据库迁移完成！')
  console.log('\n📊 新增表格:')
  console.log('   - ad_creatives: AI生成的广告创意')
  console.log('   - google_ads_credentials: Google Ads OAuth凭证')
  console.log('   - ad_performance: 广告表现数据')
  console.log(`\n📝 campaigns表新增字段: ${campaignColumnsAdded}个`)

} catch (error) {
  console.error('❌ 迁移失败:', error)
  process.exit(1)
} finally {
  db.close()
  console.log('\n🔒 数据库连接已关闭')
}
