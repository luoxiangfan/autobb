/**
 * 命名规范使用示例
 *
 * 演示如何在实际发布场景中使用命名规范
 */

import { generateNamingScheme } from '../src/lib/naming-convention'

console.log('📋 Google Ads命名规范使用示例\n')

// 示例1: 单创意模式
console.log('=== 示例1: 单创意模式 ===')
const singleCreativeNaming = generateNamingScheme({
  offer: {
    id: 215,
    brand: 'Eufy',
    offerName: 'Eufy_IT_01',
    category: 'Electronics'
  },
  config: {
    targetCountry: 'IT',
    budgetAmount: 50,
    budgetType: 'DAILY',
    biddingStrategy: 'TARGET_CPA',
    maxCpcBid: 2.5
  },
  creative: {
    id: 121,
    theme: 'Cleaning'
  }
})

console.log('Campaign:', singleCreativeNaming.campaignName)
console.log('Ad Group:', singleCreativeNaming.adGroupName)
console.log('Ad:', singleCreativeNaming.adName)
console.log()

// 示例2: 智能优化模式 (3个变体)
console.log('=== 示例2: 智能优化模式 (3个变体) ===')
for (let i = 1; i <= 3; i++) {
  const smartOptNaming = generateNamingScheme({
    offer: {
      id: 216,
      brand: 'Eufy',
      offerName: 'Eufy_IT_01',
      category: 'Security'
    },
    config: {
      targetCountry: 'IT',
      budgetAmount: 100 / 3,  // 均匀分配预算
      budgetType: 'TOTAL',
      biddingStrategy: 'MAXIMIZE_CONVERSIONS',
      maxCpcBid: 1.8
    },
    creative: {
      id: 120 + i,  // 121, 122, 123
      theme: 'Safety'
    },
    smartOptimization: {
      enabled: true,
      variantIndex: i,
      totalVariants: 3
    }
  })

  console.log(`\nVariant ${i}:`)
  console.log('  Campaign:', smartOptNaming.campaignName)
  console.log('  Ad Group:', smartOptNaming.adGroupName)
  console.log('  Ad:', smartOptNaming.adName)
}
console.log()

// 示例3: 不同投放策略对比
console.log('=== 示例3: 不同投放策略对比 ===')
const strategies = [
  'MAXIMIZE_CONVERSIONS',
  'TARGET_CPA',
  'TARGET_ROAS',
  'MANUAL_CPC'
] as const

strategies.forEach(strategy => {
  const naming = generateNamingScheme({
    offer: {
      id: 300,
      brand: 'Nike',
      offerName: 'Nike_US_01',
      category: 'Sports'
    },
    config: {
      targetCountry: 'US',
      budgetAmount: 75,
      budgetType: 'DAILY',
      biddingStrategy: strategy,
      maxCpcBid: 3.0
    },
    creative: {
      id: 500,
      theme: 'Running'
    }
  })

  console.log(`\n${strategy}:`)
  console.log('  ', naming.campaignName)
})
console.log()

// 示例4: 特殊字符处理
console.log('=== 示例4: 特殊字符处理 ===')
const specialCharsNaming = generateNamingScheme({
  offer: {
    id: 400,
    brand: 'L\'Oréal & Co.',  // 包含特殊字符
    offerName: 'Loreal_FR_01',
    category: 'Beauty & Care'
  },
  config: {
    targetCountry: 'FR',
    budgetAmount: 120.5,  // 小数预算
    budgetType: 'DAILY',
    biddingStrategy: 'ENHANCED_CPC',
    maxCpcBid: 0.8
  },
  creative: {
    id: 600,
    theme: 'Anti-Aging & Moisturizer'
  }
})

console.log('原始品牌: "L\'Oréal & Co."')
console.log('清理后Campaign:', specialCharsNaming.campaignName)
console.log('清理后Ad Group:', specialCharsNaming.adGroupName)
console.log()

// 示例5: 无Category的情况
console.log('=== 示例5: 无Category的情况 ===')
const noCategoryNaming = generateNamingScheme({
  offer: {
    id: 500,
    brand: 'Generic Brand',
    offerName: 'GenericBrand_DE_01'
    // 没有category
  },
  config: {
    targetCountry: 'DE',
    budgetAmount: 30,
    budgetType: 'DAILY',
    biddingStrategy: 'MAXIMIZE_CLICKS'
  },
  creative: {
    id: 700
    // 没有theme
  }
})

console.log('Campaign:', noCategoryNaming.campaignName)
console.log('Ad Group:', noCategoryNaming.adGroupName)
console.log('Ad:', noCategoryNaming.adName)
console.log()

console.log('✅ 所有示例完成！')
