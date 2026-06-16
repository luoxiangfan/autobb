import type { HeadlineAsset, DescriptionAsset } from '../../server'
export function calculateBrandContentConsistency(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  brandName?: string,
  category?: string
): { penalty: number; issues: string[] } {
  if (!brandName) {
    return { penalty: 0, issues: [] }
  }

  const issues: string[] = []
  let penalty = 0
  const brandLower = brandName.toLowerCase().trim()

  // 合并所有文本
  const allTexts = [...headlines.map((h) => h.text), ...descriptions.map((d) => d.text)].join(' ')
  const allTextsLower = allTexts.toLowerCase()

  // 已知的其他品牌名（从历史问题案例中提取）
  const knownOtherBrands = [
    'lilysilk',
    'u-share',
    'ushare',
    'tommy hilfiger',
    'calvin klein',
    'gucci',
    'prada',
    'nike',
    'adidas',
    'apple',
    'samsung',
    'sony',
    'lg',
    'philips',
    'panasonic',
    'bose',
    'jbl',
  ].filter((b) => !brandLower.includes(b) && !b.includes(brandLower))

  // 1. 检测创意中是否提到了其他品牌
  for (const otherBrand of knownOtherBrands) {
    if (allTextsLower.includes(otherBrand)) {
      // 检查是否在 DKI 占位符中 {KeyWord:xxx}
      const dkiPattern = new RegExp(`\\{keyword:${otherBrand}\\}`, 'i')
      if (!dkiPattern.test(allTexts)) {
        issues.push(`创意中提到了其他品牌 "${otherBrand}"`)
        penalty += 5
      }
    }
  }

  // 2. 检测品牌名是否在创意中出现（排除 DKI 占位符）
  // 移除 DKI 占位符后检查
  const textWithoutDKI = allTextsLower.replace(/\{keyword:[^}]+\}/gi, '')
  const brandMentioned = textWithoutDKI.includes(brandLower)

  // 如果创意完全没有提到品牌（且不是使用 DKI），可能有问题
  const hasDKI = /\{keyword:/i.test(allTexts)
  if (!brandMentioned && !hasDKI && headlines.length > 5) {
    // 只有在有足够多的 headlines 时才检查
    // 因为有些创意可能故意不提品牌（场景导向型）
    // 但如果完全没有品牌提及，至少记录一下
    // issues.push(`创意中未提及品牌 "${brandName}"`)
    // 不扣分，只记录
  }

  // 3. 检测类别-内容不匹配
  // 已知的电子产品品牌
  const electronicsBrands = [
    'anker',
    'reolink',
    'eufy',
    'soundcore',
    'nebula',
    'ecoflow',
    'jackery',
  ]

  // 明显不相关的产品类别关键词
  const nonElectronicsKeywords = [
    'pajama',
    'sleepwear',
    'silk',
    'clothing',
    'apparel',
    'fashion',
    'picture frame',
    'photo frame',
    'home decor',
    'furniture',
    'jewelry',
    'cosmetics',
    'beauty',
    'skincare',
    'perfume',
    'mulberry',
    'cashmere',
    'cotton',
    'linen',
    'wool',
  ]

  if (electronicsBrands.includes(brandLower)) {
    for (const nonElecKw of nonElectronicsKeywords) {
      if (allTextsLower.includes(nonElecKw)) {
        issues.push(`电子产品品牌 "${brandName}" 的创意中出现了不相关内容 "${nonElecKw}"`)
        penalty += 8 // 严重问题，大幅扣分
      }
    }
  }

  // 4. 检测类别字段是否与品牌明显不匹配
  if (category && electronicsBrands.includes(brandLower)) {
    const categoryLower = category.toLowerCase()
    const nonElectronicsCategories = [
      'pajama',
      'sleepwear',
      'clothing',
      'apparel',
      'fashion',
      'picture frame',
      'photo frame',
      'home decor',
      'furniture',
    ]
    for (const cat of nonElectronicsCategories) {
      if (categoryLower.includes(cat)) {
        issues.push(`品牌 "${brandName}" 的类别 "${category}" 明显不匹配`)
        penalty += 10 // 非常严重的问题
        break
      }
    }
  }

  // 输出调试信息
  if (penalty > 0) {
    console.warn(`⚠️ 品牌-内容一致性检查失败:`)
    issues.forEach((issue) => console.warn(`   - ${issue}`))
    console.warn(`   总扣分: ${penalty}`)
  }

  return {
    penalty: Math.min(penalty, 20), // 最多扣20分
    issues,
  }
}
