/**
 * 全面审查所有 API 路由和数据库查询的用户隔离实现
 * 检查所有可能的数据泄漏风险
 */

import { getDatabase } from '../src/lib/db'
import * as fs from 'fs'
import * as path from 'path'

interface IsolationIssue {
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line?: number
  issue: string
  recommendation: string
}

const issues: IsolationIssue[] = []

async function auditDatabaseSchema() {
  console.log('🔍 审查数据库架构...\n')
  const db = await getDatabase()

  // 获取所有用户表
  const tables = await db.query(`
    SELECT name FROM sqlite_master
    WHERE type='table'
    AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `) as Array<{ name: string }>

  const userTables = [
    'offers',
    'ad_creatives',
    'campaigns',
    'ad_groups',
    'keywords',
    'creative_versions',
    'scraped_products',
    'launch_scores',
    'optimization_tasks',
    'risk_alerts',
    'creative_learning_patterns',
    'ad_strength_history',
    'google_ads_api_usage',
    'ai_token_usage',
    // 性能数据表
    'ad_creative_performance',
    'ad_performance',
    'campaign_performance',
    'creative_performance_scores',
    'search_term_reports',
    // 优化分析表
    'optimization_recommendations',
    'weekly_recommendations',
    'score_analysis_history',
    // 辅助功能表
    'conversion_feedback',
    'link_check_history',
    'cpc_adjustment_history',
    'sync_logs',
    // Google Ads 集成表
    'google_ads_accounts',
    'google_ads_credentials',
    // 资源管理表
    'rate_limits',
    // 混合表（同时支持全局和用户级配置，但归类为用户表）
    'system_settings',  // 通过 user_id IS NULL 区分全局配置，但仍为用户数据表
  ]

  const globalTables = [
    'users',
    'global_keywords',
    'industry_benchmarks',
    'prompt_versions',
    'prompt_usage_stats',
    'login_attempts',
    'backup_logs',
    'migration_history',
  ]

  console.log('📊 表分类统计:')
  console.log(`  - 需要用户隔离的表: ${userTables.length}`)
  console.log(`  - 全局共享表: ${globalTables.length}`)
  console.log(`  - 数据库总表数: ${tables.length}\n`)

  // 检查每个用户表是否有 user_id 字段
  console.log('🔒 检查用户表的 user_id 字段:')
  for (const tableName of userTables) {
    const tableInfo = await db.query(`PRAGMA table_info(${tableName})`) as Array<{
      name: string
      type: string
      notnull: number
    }>

    const hasUserId = tableInfo.some(col => col.name === 'user_id')
    const userIdCol = tableInfo.find(col => col.name === 'user_id')

    if (!hasUserId) {
      issues.push({
        severity: 'critical',
        file: `database:${tableName}`,
        issue: `表 ${tableName} 缺少 user_id 字段`,
        recommendation: '创建迁移文件添加 user_id 字段和外键约束',
      })
      console.log(`  ❌ ${tableName}: 缺少 user_id 字段`)
    } else if (userIdCol && userIdCol.notnull === 0) {
      issues.push({
        severity: 'high',
        file: `database:${tableName}`,
        issue: `表 ${tableName} 的 user_id 字段允许 NULL`,
        recommendation: '修改 user_id 字段为 NOT NULL',
      })
      console.log(`  ⚠️  ${tableName}: user_id 允许 NULL`)
    } else {
      console.log(`  ✅ ${tableName}: user_id 字段正确`)
    }
  }

  console.log('\n')
}

async function auditAPIRoutes() {
  console.log('🔍 审查 API 路由...\n')

  const apiDir = path.join(process.cwd(), 'src', 'app', 'api')
  const routeFiles: string[] = []

  function findRouteFiles(dir: string) {
    const files = fs.readdirSync(dir)
    for (const file of files) {
      const fullPath = path.join(dir, file)
      const stat = fs.statSync(fullPath)
      if (stat.isDirectory()) {
        findRouteFiles(fullPath)
      } else if (file === 'route.ts') {
        routeFiles.push(fullPath)
      }
    }
  }

  findRouteFiles(apiDir)
  console.log(`找到 ${routeFiles.length} 个 API 路由文件\n`)

  // 检查每个路由文件的用户隔离
  let checkedRoutes = 0
  let issueRoutes = 0

  for (const routeFile of routeFiles) {
    const content = fs.readFileSync(routeFile, 'utf-8')
    const relativePath = routeFile.replace(process.cwd() + '/', '')

    checkedRoutes++

    // 检查是否有 getUserIdFromRequest
    const hasUserAuth = content.includes('getUserIdFromRequest') ||
      content.includes('requireAuth') ||
      content.includes('authMiddleware')

    // 检查 SQL 查询是否包含 user_id
    const sqlQueries = content.match(/`[\s\S]*?FROM\s+\w+[\s\S]*?`/gi) || []
    const hasUserIdInQuery = sqlQueries.some(query =>
      query.toLowerCase().includes('user_id')
    )

    // 如果有数据库查询但没有用户隔离
    if (sqlQueries.length > 0 && !hasUserIdInQuery && !hasUserAuth) {
      issues.push({
        severity: 'high',
        file: relativePath,
        issue: '路由包含数据库查询但可能缺少用户隔离',
        recommendation: '检查所有查询是否包含 user_id 过滤条件',
      })
      issueRoutes++
      console.log(`  ⚠️  ${relativePath.replace('src/app/api/', '')}`)
    }
  }

  console.log(`\n审查结果: ${issueRoutes}/${checkedRoutes} 个路由存在潜在问题\n`)
}

async function auditLibraryFunctions() {
  console.log('🔍 审查库函数...\n')

  const libDir = path.join(process.cwd(), 'src', 'lib')
  const libFiles = fs.readdirSync(libDir).filter(f => f.endsWith('.ts'))

  console.log(`找到 ${libFiles.length} 个库文件\n`)

  const suspiciousFunctions: Array<{ file: string; function: string }> = []

  for (const libFile of libFiles) {
    const filePath = path.join(libDir, libFile)
    const content = fs.readFileSync(filePath, 'utf-8')

    // 查找所有包含 SELECT/DELETE/UPDATE 但可能缺少 user_id 的查询
    const queryPattern = /(SELECT|DELETE|UPDATE)[\s\S]*?FROM\s+(\w+)/gi
    const matches = [...content.matchAll(queryPattern)]

    for (const match of matches) {
      const query = match[0]
      const table = match[2]

      // 检查这个表是否需要用户隔离
      const needsIsolation = [
        'offers', 'ad_creatives', 'campaigns', 'ad_groups', 'keywords',
        'creative_versions', 'scraped_products', 'launch_scores',
      ].includes(table)

      // 检查查询是否包含 user_id
      const hasUserId = query.toLowerCase().includes('user_id')

      if (needsIsolation && !hasUserId) {
        suspiciousFunctions.push({ file: libFile, function: query.substring(0, 50) })
      }
    }
  }

  if (suspiciousFunctions.length > 0) {
    console.log('⚠️  发现可能缺少用户隔离的查询:')
    for (const func of suspiciousFunctions.slice(0, 10)) {
      console.log(`  - ${func.file}: ${func.function}...`)
      issues.push({
        severity: 'medium',
        file: `src/lib/${func.file}`,
        issue: `查询可能缺少 user_id 过滤`,
        recommendation: '检查查询是否正确应用了用户隔离',
      })
    }
    if (suspiciousFunctions.length > 10) {
      console.log(`  ... 还有 ${suspiciousFunctions.length - 10} 个类似问题`)
    }
  } else {
    console.log('✅ 未发现明显的用户隔离问题')
  }

  console.log('\n')
}

async function generateReport() {
  console.log('📝 生成审查报告...\n')

  const reportLines: string[] = [
    '# 用户隔离审查报告',
    '',
    `**审查时间**: ${new Date().toISOString()}`,
    `**发现问题**: ${issues.length}`,
    '',
  ]

  // 按严重程度分组
  const critical = issues.filter(i => i.severity === 'critical')
  const high = issues.filter(i => i.severity === 'high')
  const medium = issues.filter(i => i.severity === 'medium')
  const low = issues.filter(i => i.severity === 'low')

  reportLines.push('## 问题摘要')
  reportLines.push('')
  reportLines.push(`- 🔴 严重 (Critical): ${critical.length}`)
  reportLines.push(`- 🟠 高危 (High): ${high.length}`)
  reportLines.push(`- 🟡 中等 (Medium): ${medium.length}`)
  reportLines.push(`- 🟢 低危 (Low): ${low.length}`)
  reportLines.push('')

  function addIssueSection(title: string, emoji: string, items: IsolationIssue[]) {
    if (items.length === 0) return

    reportLines.push(`## ${emoji} ${title}`)
    reportLines.push('')

    for (const issue of items) {
      reportLines.push(`### ${issue.file}${issue.line ? `:${issue.line}` : ''}`)
      reportLines.push('')
      reportLines.push(`**问题**: ${issue.issue}`)
      reportLines.push('')
      reportLines.push(`**建议**: ${issue.recommendation}`)
      reportLines.push('')
    }
  }

  addIssueSection('严重问题', '🔴', critical)
  addIssueSection('高危问题', '🟠', high)
  addIssueSection('中等问题', '🟡', medium)
  addIssueSection('低危问题', '🟢', low)

  reportLines.push('## 建议措施')
  reportLines.push('')
  reportLines.push('1. 优先修复所有严重和高危问题')
  reportLines.push('2. 为所有需要隔离的表添加 user_id 字段')
  reportLines.push('3. 为所有 API 路由添加用户认证检查')
  reportLines.push('4. 为所有数据库查询添加 user_id 过滤条件')
  reportLines.push('5. 定期运行此审查脚本监控用户隔离完整性')
  reportLines.push('')

  const reportPath = path.join(process.cwd(), 'USER_ISOLATION_AUDIT_REPORT.md')
  fs.writeFileSync(reportPath, reportLines.join('\n'))

  console.log(`✅ 报告已保存到: USER_ISOLATION_AUDIT_REPORT.md\n`)
}

async function main() {
  console.log('🚀 开始全面审查用户隔离实现\n')
  console.log('='.repeat(60))
  console.log('\n')

  try {
    await auditDatabaseSchema()
    await auditAPIRoutes()
    await auditLibraryFunctions()
    await generateReport()

    console.log('='.repeat(60))
    console.log('\n')

    if (issues.length === 0) {
      console.log('🎉 恭喜！未发现用户隔离问题')
    } else {
      const critical = issues.filter(i => i.severity === 'critical').length
      const high = issues.filter(i => i.severity === 'high').length

      console.log(`⚠️  发现 ${issues.length} 个问题:`)
      console.log(`   - 🔴 严重: ${critical}`)
      console.log(`   - 🟠 高危: ${high}`)
      console.log(`   - 🟡 中等: ${issues.length - critical - high}`)
      console.log('\n请查看详细报告: USER_ISOLATION_AUDIT_REPORT.md')
    }

  } catch (error: any) {
    console.error('❌ 审查过程中出现错误:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('💥 脚本执行失败:', error)
    process.exit(1)
  })
