#!/usr/bin/env tsx
/**
 * Production verification script for offer 4270 currency fix
 *
 * This script verifies that:
 * 1. Commission is correctly converted from USD to CNY
 * 2. Cost is correctly converted from CNY to USD
 * 3. ROI is consistent across currencies
 */

import { getDatabase } from '../src/lib/db'
import {
  getOfferPerformanceSummary,
  calculateOfferROI,
  getOfferCurrencyInfo
} from '../src/lib/offer-performance'
import { formatCurrency, EXCHANGE_RATES } from '../src/lib/currency'

async function verifyOffer(offerId: number, userId: number) {
  console.log(`\n=== Verifying Offer ${offerId} ===\n`)

  const daysBack = 30

  // Get currency info
  const currencyInfo = await getOfferCurrencyInfo(offerId, userId, daysBack)
  console.log('Currency Info:', currencyInfo)

  // Get data in both currencies
  const summaryCNY = await getOfferPerformanceSummary(offerId, userId, daysBack, 'CNY')
  const summaryUSD = await getOfferPerformanceSummary(offerId, userId, daysBack, 'USD')

  const roiCNY = await calculateOfferROI(offerId, userId, 0, daysBack, 'CNY')
  const roiUSD = await calculateOfferROI(offerId, userId, 0, daysBack, 'USD')

  // Display results
  console.log('\n--- CNY View ---')
  console.log('Cost:', formatCurrency(summaryCNY.cost, 'CNY'))
  console.log('Commission:', formatCurrency(summaryCNY.commission, 'CNY'))
  console.log('ROI:', roiCNY.roi_percentage.toFixed(2) + '%')

  console.log('\n--- USD View ---')
  console.log('Cost:', formatCurrency(summaryUSD.cost, 'USD'))
  console.log('Commission:', formatCurrency(summaryUSD.commission, 'USD'))
  console.log('ROI:', roiUSD.roi_percentage.toFixed(2) + '%')

  // Verify conversion ratios
  console.log('\n--- Verification ---')
  const expectedRatio = EXCHANGE_RATES.CNY
  const actualCostRatio = summaryCNY.cost / summaryUSD.cost
  const actualCommissionRatio = summaryCNY.commission / summaryUSD.commission

  console.log('Expected exchange rate (USD to CNY):', expectedRatio.toFixed(2))
  console.log('Actual cost ratio:', actualCostRatio.toFixed(2))
  console.log('Actual commission ratio:', actualCommissionRatio.toFixed(2))

  const costRatioMatch = Math.abs(actualCostRatio - expectedRatio) < 0.1
  const commissionRatioMatch = Math.abs(actualCommissionRatio - expectedRatio) < 0.1
  const roiMatch = Math.abs(roiCNY.roi_percentage - roiUSD.roi_percentage) < 0.01

  console.log('\n--- Test Results ---')
  console.log('✓ Cost conversion:', costRatioMatch ? 'PASS' : 'FAIL')
  console.log('✓ Commission conversion:', commissionRatioMatch ? 'PASS' : 'FAIL')
  console.log('✓ ROI consistency:', roiMatch ? 'PASS' : 'FAIL')

  if (costRatioMatch && commissionRatioMatch && roiMatch) {
    console.log('\n✅ All tests passed!')
    return true
  } else {
    console.log('\n❌ Some tests failed!')
    return false
  }
}

async function main() {
  const db = await getDatabase()

  console.log('=== Currency Fix Verification ===')
  console.log('Date:', new Date().toISOString())

  // Verify offer 4270
  const success = await verifyOffer(4270, 62)

  await db.close()

  process.exit(success ? 0 : 1)
}

main().catch((error) => {
  console.error('Verification failed:', error)
  process.exit(1)
})
