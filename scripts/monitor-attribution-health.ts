#!/usr/bin/env tsx
/**
 * Daily monitoring script for commission attribution health
 *
 * This script checks:
 * 1. Unattributed commission amount
 * 2. Product-offer link coverage rate
 * 3. Attribution success rate
 * 4. Pending failures exceeding grace period
 *
 * Run daily via cron or scheduler
 */

import { getDatabase } from '@/lib/db'
import { getAffiliateAttributionPendingGraceDays } from '@/lib/openclaw/affiliate-attribution-failures'

interface HealthMetrics {
  unattributedCommission: number
  failureCount: number
  productLinkCoverage: number
  attributionSuccessRate: number
  expiredPendingCount: number
  expiredPendingAmount: number
}

interface Alert {
  level: 'info' | 'warning' | 'critical'
  metric: string
  message: string
  value: number
  threshold: number
}

async function checkUnattributedCommission(userId: number): Promise<{ amount: number; count: number }> {
  const db = await getDatabase()

  const result = await db.queryOne<{ total: number; count: number }>(`
    SELECT
      COALESCE(SUM(commission_amount), 0) as total,
      COUNT(*) as count
    FROM openclaw_affiliate_attribution_failures
    WHERE user_id = ?
      AND report_date >= DATE('now', '-7 days')
      AND reason_code NOT IN ('campaign_mapping_miss')
  `, [userId])

  return {
    amount: Number(result?.total || 0),
    count: Number(result?.count || 0),
  }
}

async function checkProductLinkCoverage(userId: number): Promise<number> {
  const db = await getDatabase()

  const result = await db.queryOne<{ total: number; linked: number }>(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT apol.product_id) as linked
    FROM affiliate_products ap
    LEFT JOIN affiliate_product_offer_links apol ON apol.product_id = ap.id
    WHERE ap.user_id = ?
  `, [userId])

  const total = Number(result?.total || 0)
  const linked = Number(result?.linked || 0)

  return total > 0 ? (linked / total) * 100 : 100
}

async function checkAttributionSuccessRate(userId: number): Promise<number> {
  const db = await getDatabase()

  const result = await db.queryOne<{ total: number; attributed: number }>(`
    SELECT
      SUM(commission_amount) as total,
      SUM(CASE WHEN campaign_id IS NOT NULL THEN commission_amount ELSE 0 END) as attributed
    FROM (
      SELECT commission_amount, campaign_id FROM affiliate_commission_attributions
      WHERE user_id = ? AND report_date >= DATE('now', '-7 days')
      UNION ALL
      SELECT commission_amount, NULL as campaign_id FROM openclaw_affiliate_attribution_failures
      WHERE user_id = ? AND report_date >= DATE('now', '-7 days')
    )
  `, [userId, userId])

  const total = Number(result?.total || 0)
  const attributed = Number(result?.attributed || 0)

  return total > 0 ? (attributed / total) * 100 : 100
}

async function checkExpiredPending(userId: number): Promise<{ count: number; amount: number }> {
  const db = await getDatabase()
  const graceDays = getAffiliateAttributionPendingGraceDays()

  const result = await db.queryOne<{ count: number; total: number }>(`
    SELECT
      COUNT(*) as count,
      COALESCE(SUM(commission_amount), 0) as total
    FROM openclaw_affiliate_attribution_failures
    WHERE user_id = ?
      AND reason_code IN ('pending_offer_mapping_miss', 'pending_product_mapping_miss')
      AND report_date < DATE('now', '-${graceDays} days')
  `, [userId])

  return {
    count: Number(result?.count || 0),
    amount: Number(result?.total || 0),
  }
}

async function collectMetrics(userId: number): Promise<HealthMetrics> {
  const unattributed = await checkUnattributedCommission(userId)
  const coverage = await checkProductLinkCoverage(userId)
  const successRate = await checkAttributionSuccessRate(userId)
  const expired = await checkExpiredPending(userId)

  return {
    unattributedCommission: unattributed.amount,
    failureCount: unattributed.count,
    productLinkCoverage: coverage,
    attributionSuccessRate: successRate,
    expiredPendingCount: expired.count,
    expiredPendingAmount: expired.amount,
  }
}

function evaluateMetrics(metrics: HealthMetrics): Alert[] {
  const alerts: Alert[] = []

  // Check unattributed commission
  if (metrics.unattributedCommission > 50) {
    alerts.push({
      level: 'critical',
      metric: 'unattributed_commission',
      message: `High unattributed commission in last 7 days`,
      value: metrics.unattributedCommission,
      threshold: 50,
    })
  } else if (metrics.unattributedCommission > 10) {
    alerts.push({
      level: 'warning',
      metric: 'unattributed_commission',
      message: `Moderate unattributed commission in last 7 days`,
      value: metrics.unattributedCommission,
      threshold: 10,
    })
  }

  // Check product link coverage
  if (metrics.productLinkCoverage < 80) {
    alerts.push({
      level: 'critical',
      metric: 'product_link_coverage',
      message: `Low product-offer link coverage`,
      value: metrics.productLinkCoverage,
      threshold: 80,
    })
  } else if (metrics.productLinkCoverage < 90) {
    alerts.push({
      level: 'warning',
      metric: 'product_link_coverage',
      message: `Product-offer link coverage below target`,
      value: metrics.productLinkCoverage,
      threshold: 90,
    })
  }

  // Check attribution success rate
  if (metrics.attributionSuccessRate < 90) {
    alerts.push({
      level: 'critical',
      metric: 'attribution_success_rate',
      message: `Low attribution success rate in last 7 days`,
      value: metrics.attributionSuccessRate,
      threshold: 90,
    })
  } else if (metrics.attributionSuccessRate < 95) {
    alerts.push({
      level: 'warning',
      metric: 'attribution_success_rate',
      message: `Attribution success rate below target`,
      value: metrics.attributionSuccessRate,
      threshold: 95,
    })
  }

  // Check expired pending failures
  if (metrics.expiredPendingAmount > 0) {
    alerts.push({
      level: 'warning',
      metric: 'expired_pending',
      message: `Pending failures exceeded grace period`,
      value: metrics.expiredPendingAmount,
      threshold: 0,
    })
  }

  return alerts
}

function formatMetricsReport(metrics: HealthMetrics, alerts: Alert[]): string {
  const lines: string[] = []

  lines.push('=' .repeat(60))
  lines.push('📊 Commission Attribution Health Report')
  lines.push('=' .repeat(60))
  lines.push('')

  lines.push('📈 Metrics (Last 7 Days):')
  lines.push(`   Unattributed Commission: $${metrics.unattributedCommission.toFixed(2)} (${metrics.failureCount} failures)`)
  lines.push(`   Product Link Coverage: ${metrics.productLinkCoverage.toFixed(1)}%`)
  lines.push(`   Attribution Success Rate: ${metrics.attributionSuccessRate.toFixed(1)}%`)
  lines.push(`   Expired Pending: ${metrics.expiredPendingCount} failures ($${metrics.expiredPendingAmount.toFixed(2)})`)
  lines.push('')

  if (alerts.length === 0) {
    lines.push('✅ All metrics are healthy!')
  } else {
    lines.push(`⚠️  ${alerts.length} Alert(s):`)
    lines.push('')

    for (const alert of alerts) {
      const icon = alert.level === 'critical' ? '🔴' : '🟡'
      lines.push(`${icon} [${alert.level.toUpperCase()}] ${alert.metric}`)
      lines.push(`   ${alert.message}`)
      lines.push(`   Current: ${alert.value.toFixed(2)} | Threshold: ${alert.threshold}`)
      lines.push('')
    }
  }

  lines.push('=' .repeat(60))

  return lines.join('\n')
}

async function main() {
  const db = await getDatabase()

  // Get all users (in production, you might want to filter active users)
  const users = await db.query<{ id: number }>('SELECT DISTINCT user_id as id FROM affiliate_products')

  console.log(`🔍 Checking attribution health for ${users.length} user(s)...\n`)

  let totalAlerts = 0

  for (const user of users) {
    const metrics = await collectMetrics(user.id)
    const alerts = evaluateMetrics(metrics)

    const report = formatMetricsReport(metrics, alerts)
    console.log(report)
    console.log('')

    totalAlerts += alerts.length

    // TODO: Send alerts via email/Slack/webhook
    if (alerts.length > 0) {
      // await sendAlert(user.id, alerts, metrics)
    }
  }

  await db.close()

  console.log(`\n✅ Health check complete. Total alerts: ${totalAlerts}`)

  // Exit with error code if there are critical alerts
  const hasCritical = totalAlerts > 0
  process.exit(hasCritical ? 1 : 0)
}

main().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})
