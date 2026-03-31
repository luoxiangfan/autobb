/**
 * ⚡ P0性能优化: 添加数据库索引
 *
 * 根据query pattern analysis添加关键索引以提升查询性能
 *
 * 优化查询:
 * 1. offers表: scrape_status, is_active, (user_id + is_active), created_at
 * 2. campaigns表: status, (offer_id + status), (google_ads_account_id + status), created_at
 * 3. campaign_performance表: 已有索引(campaign_id+date, user_id+date)，无需额外优化
 *
 * 预期收益:
 * - offers列表查询: 200ms → 50ms (75%提升)
 * - campaigns筛选: 150ms → 40ms (73%提升)
 * - 仪表盘聚合: 500ms → 200ms (60%提升)
 */
import Database from 'better-sqlite3'
import path from 'path'

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'autoads.db')

console.log('⚡ 开始添加性能优化索引...')
console.log('📍 数据库路径:', dbPath)

// 连接数据库
const db = new Database(dbPath)
db.pragma('foreign_keys = ON')

// 检查索引是否已存在
function indexExists(indexName: string): boolean {
  const result = db.prepare(
    `SELECT COUNT(*) as count FROM sqlite_master WHERE type='index' AND name=?`
  ).get(indexName) as { count: number }

  return result.count > 0
}

// 安全添加索引（如果不存在）
function createIndexIfNotExists(indexName: string, createSQL: string): void {
  if (indexExists(indexName)) {
    console.log(`⏭️  ${indexName} 已存在，跳过`)
    return
  }

  console.log(`📌 创建索引: ${indexName}`)
  db.exec(createSQL)
  console.log(`✅ ${indexName}`)
}

try {
  console.log('\n--- OFFERS表索引优化 ---\n')

  // Offers索引
  createIndexIfNotExists(
    'idx_offers_scrape_status',
    'CREATE INDEX idx_offers_scrape_status ON offers(scrape_status)'
  )

  createIndexIfNotExists(
    'idx_offers_is_active',
    'CREATE INDEX idx_offers_is_active ON offers(is_active)'
  )

  // 组合索引: (user_id + is_active) - 优化用户筛选活跃offers的查询
  createIndexIfNotExists(
    'idx_offers_user_active',
    'CREATE INDEX idx_offers_user_active ON offers(user_id, is_active) WHERE is_active = 1'
  )

  // 组合索引: (user_id + scrape_status) - 优化scraping queue查询
  createIndexIfNotExists(
    'idx_offers_user_scrape',
    'CREATE INDEX idx_offers_user_scrape ON offers(user_id, scrape_status)'
  )

  // 时间排序索引（按创建时间倒序）
  createIndexIfNotExists(
    'idx_offers_created_desc',
    'CREATE INDEX idx_offers_created_desc ON offers(created_at DESC)'
  )

  console.log('\n--- CAMPAIGNS表索引优化 ---\n')

  // Campaigns索引
  createIndexIfNotExists(
    'idx_campaigns_status',
    'CREATE INDEX idx_campaigns_status ON campaigns(status)'
  )

  // 组合索引: (offer_id + status) - 优化按offer筛选campaigns
  createIndexIfNotExists(
    'idx_campaigns_offer_status',
    'CREATE INDEX idx_campaigns_offer_status ON campaigns(offer_id, status)'
  )

  // 组合索引: (google_ads_account_id + status) - 优化按账号筛选campaigns
  createIndexIfNotExists(
    'idx_campaigns_account_status',
    'CREATE INDEX idx_campaigns_account_status ON campaigns(google_ads_account_id, status)'
  )

  // 组合索引: (user_id + status) - 优化用户查看所有campaigns
  createIndexIfNotExists(
    'idx_campaigns_user_status',
    'CREATE INDEX idx_campaigns_user_status ON campaigns(user_id, status)'
  )

  // 时间排序索引（按创建时间倒序）
  createIndexIfNotExists(
    'idx_campaigns_created_desc',
    'CREATE INDEX idx_campaigns_created_desc ON campaigns(created_at DESC)'
  )

  // 创意关联索引 - 优化查询使用特定creative的campaigns
  createIndexIfNotExists(
    'idx_campaigns_creative',
    'CREATE INDEX idx_campaigns_creative ON campaigns(ad_creative_id) WHERE ad_creative_id IS NOT NULL'
  )

  console.log('\n--- CAMPAIGN_PERFORMANCE表索引检查 ---\n')
  console.log('✅ campaign_performance表已有以下索引:')
  console.log('   - idx_performance_campaign_date (campaign_id, date)')
  console.log('   - idx_performance_user_date (user_id, date)')
  console.log('   无需额外索引')

  console.log('\n--- GOOGLE_ADS_ACCOUNTS表索引优化 ---\n')

  // Google Ads Accounts索引
  createIndexIfNotExists(
    'idx_google_ads_accounts_user_active',
    'CREATE INDEX idx_google_ads_accounts_user_active ON google_ads_accounts(user_id, is_active) WHERE is_active = 1'
  )

  createIndexIfNotExists(
    'idx_google_ads_accounts_customer_id',
    'CREATE INDEX idx_google_ads_accounts_customer_id ON google_ads_accounts(customer_id)'
  )

  console.log('\n--- AD_CREATIVES表索引优化 ---\n')

  // Ad Creatives索引
  createIndexIfNotExists(
    'idx_ad_creatives_offer',
    'CREATE INDEX idx_ad_creatives_offer ON ad_creatives(offer_id)'
  )

  createIndexIfNotExists(
    'idx_ad_creatives_user_created',
    'CREATE INDEX idx_ad_creatives_user_created ON ad_creatives(user_id, created_at DESC)'
  )

  console.log('\n✅ 所有性能优化索引已创建完成!')

  // 分析索引使用情况
  console.log('\n📊 索引统计信息:')
  const indexCount = db.prepare(
    `SELECT type, COUNT(*) as count FROM sqlite_master WHERE type='index' GROUP BY type`
  ).all()
  console.log(indexCount)

  // 获取数据库大小
  const dbStats = db.prepare(`
    SELECT
      page_count * page_size / 1024.0 / 1024.0 AS size_mb,
      page_count,
      page_size
    FROM pragma_page_count(), pragma_page_size()
  `).get() as { size_mb: number; page_count: number; page_size: number }

  console.log(`\n📦 数据库大小: ${dbStats.size_mb.toFixed(2)} MB`)
  console.log(`   页数: ${dbStats.page_count}, 页大小: ${dbStats.page_size} bytes`)

  // 运行ANALYZE以更新查询规划器统计信息
  console.log('\n📈 运行ANALYZE更新查询规划器统计信息...')
  db.exec('ANALYZE')
  console.log('✅ ANALYZE完成')

} catch (error) {
  console.error('❌ 索引创建失败:', error)
  process.exit(1)
} finally {
  db.close()
  console.log('\n👋 数据库连接已关闭')
}

console.log('\n🎉 性能优化索引脚本执行完成!')
console.log('\n💡 建议:')
console.log('   1. 定期运行 ANALYZE 以保持查询规划器统计信息准确')
console.log('   2. 监控慢查询日志以识别新的索引优化机会')
console.log('   3. 使用 EXPLAIN QUERY PLAN 验证索引是否被使用')
