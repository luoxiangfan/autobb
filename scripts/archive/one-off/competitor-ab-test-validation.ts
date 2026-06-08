/**
 * Competitor compression A/B validation helpers for scripts/archive/one-off/run-competitor-ab-test.ts
 */

import {
  compressCompetitors,
  validateCompressionQuality,
  type CompetitorInfo,
} from '../../../src/lib/competitor-compressor'

const AB_TEST_SAMPLE_COMPETITORS: CompetitorInfo[] = [
  {
    name: 'Sony Alpha 7 IV',
    brand: 'Sony',
    price: '$2,499.99',
    rating: '4.8 out of 5 stars',
    reviewCount: 1234,
    usp: 'Professional full-frame mirrorless with 33MP sensor and real-time tracking',
    keyFeatures: ['33MP sensor', '4K 60p video', 'Real-time Eye AF'],
  },
  {
    name: 'Canon EOS R6 Mark II',
    brand: 'Canon',
    price: '$2,399.00',
    rating: '4.7 out of 5 stars',
    reviewCount: 892,
    usp: 'High-speed continuous shooting with superior autofocus system',
    keyFeatures: ['24.2MP sensor', '40fps burst', 'Dual Pixel AF II'],
  },
  {
    name: 'Nikon Z6 III',
    brand: 'Nikon',
    price: '$2,199.95',
    rating: '4.6 out of 5 stars',
    reviewCount: 567,
    usp: 'Excellent low-light performance with 5-axis image stabilization',
    keyFeatures: ['24.5MP sensor', 'ISO 100-51200', '5-axis VR'],
  },
]

const DEFAULT_TEST_COUNT = 30

export type CompetitorCompressionABTestResult = {
  testCount: number
  uspMatchRate: number
  featureMatchRate: number
  uspSimilarity: number
  competitivenessCorrelation: number
  avgTokenSavings: number
  avgTokenSavingsPercent: number
  recommendation: 'approve_compression' | 'reject_compression' | 'needs_review'
  details: string
}

export function validateCompetitorCompressionQuality(
  original: CompetitorInfo[],
  compressed: string
) {
  return validateCompressionQuality(original, compressed)
}

function parseCompressionRatioPercent(ratio: string): number {
  const match = String(ratio).match(/([\d.]+)/)
  return match ? Number.parseFloat(match[1]) : 0
}

function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export async function runCompetitorCompressionABTest(
  testCount: number = DEFAULT_TEST_COUNT
): Promise<CompetitorCompressionABTestResult> {
  const uspRetentions: number[] = []
  const featureRetentions: number[] = []
  const priceAccuracies: number[] = []
  const ratingAccuracies: number[] = []
  const tokenSavings: number[] = []
  const compressionPercents: number[] = []

  for (let i = 0; i < testCount; i += 1) {
    const compressed = compressCompetitors(AB_TEST_SAMPLE_COMPETITORS, 20)
    const quality = validateCompressionQuality(AB_TEST_SAMPLE_COMPETITORS, compressed.compressed)

    uspRetentions.push(quality.uspRetention)
    featureRetentions.push(quality.featureRetention)
    priceAccuracies.push(quality.priceAccuracy)
    ratingAccuracies.push(quality.ratingAccuracy)

    const savedChars = compressed.stats.originalChars - compressed.stats.compressedChars
    tokenSavings.push(Math.max(0, savedChars))
    compressionPercents.push(parseCompressionRatioPercent(compressed.stats.compressionRatio))
  }

  const uspMatchRate = average(uspRetentions)
  const featureMatchRate = average(featureRetentions)
  const uspSimilarity = average([average(uspRetentions), average(featureRetentions)])
  const competitivenessCorrelation = average([average(priceAccuracies), average(ratingAccuracies)])
  const avgTokenSavings = average(tokenSavings)
  const avgTokenSavingsPercent = average(compressionPercents)

  const meetsQuality =
    uspMatchRate >= 0.85 &&
    featureMatchRate >= 0.9 &&
    uspSimilarity >= 0.85 &&
    competitivenessCorrelation >= 0.9
  const meetsCompression = avgTokenSavingsPercent >= 40 && avgTokenSavingsPercent <= 55

  let recommendation: CompetitorCompressionABTestResult['recommendation']
  let details: string

  if (meetsQuality && meetsCompression) {
    recommendation = 'approve_compression'
    details = '压缩质量与压缩率均达到生产门槛，可进入灰度验证。'
  } else if (!meetsQuality) {
    recommendation = 'reject_compression'
    details = '压缩后 USP/特性/竞争力保留不足，需调整压缩策略后再测。'
  } else {
    recommendation = 'needs_review'
    details = '质量指标达标但压缩率偏离 40–55% 目标区间，建议人工复核后决策。'
  }

  return {
    testCount,
    uspMatchRate,
    featureMatchRate,
    uspSimilarity,
    competitivenessCorrelation,
    avgTokenSavings,
    avgTokenSavingsPercent,
    recommendation,
    details,
  }
}
