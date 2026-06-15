import type { HeadlineAsset, DescriptionAsset } from '../../ad-creative'
export function calculateProductFocus(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  sitelinks?: Array<{ text: string; url: string; description?: string }>,
  callouts?: string[],
  categoryWhitelist?: string[] // 动态传入目标品类白名单
): { score: number; issues: string[] } {
  const issues: string[] = []
  let problemCount = 0

  const allHeadlines = headlines.map((h) => h.text.toLowerCase())
  const allDescriptions = descriptions.map((d) => d.text.toLowerCase())
  const allSitelinkTexts = (sitelinks || []).map((s) =>
    (s.text + ' ' + (s.description || '')).toLowerCase()
  )
  const allCallouts = (callouts || []).map((c) => c.toLowerCase())
  const allTexts = [...allHeadlines, ...allDescriptions, ...allSitelinkTexts, ...allCallouts]

  // 1. 动态生成"其他品类"列表（排除目标品类）
  const targetCategories = (categoryWhitelist || []).map((c) => c.toLowerCase())
  const allCategoryTerms = [
    // 门铃类
    'doorbell',
    'video doorbell',
    'smart doorbell',
    'door camera',
    // 吸尘器类
    'vacuum',
    'robot vacuum',
    'vacuum cleaner',
    'cordless vacuum',
    'robot mop',
    // 智能锁类
    'smart lock',
    'door lock',
    'fingerprint lock',
    'keyless lock',
    // 智能家居类
    'smart home',
    'home automation',
    'smart plug',
    'smart bulb',
    'smart speaker',
    // 母婴类
    'breast pump',
    'baby monitor',
    'baby gear',
    // 店铺通用类（单品链接不应出现）
    'browse our collection',
    'shop all',
    'browse collection',
    'explore our',
    'full lineup',
    'wide range',
    'our product line',
    'all products',
  ]

  // 过滤：只检查不在目标品类白名单中的品类词
  const otherCategoryTerms = allCategoryTerms.filter((term) => {
    // 检查term中是否包含目标品类词
    const isTargetCategory = targetCategories.some(
      (cat) => term.toLowerCase().includes(cat) || cat.includes(term.toLowerCase())
    )
    return !isTargetCategory // 排除目标品类，保留其他品类
  })

  // 2. 通用店铺/品牌文案列表
  const genericStoreTerms = [
    'browse our collection',
    'shop all cameras',
    'shop all products',
    'browse collection',
    'explore our full',
    'our product line',
    'all products',
    'wide range',
    'full lineup',
    'complete lineup',
    'smart home solutions',
    'home security solutions',
    'whole home',
    'entire home',
    'every room',
    'all your needs',
    'one stop shop',
    'everything you need',
    'full range of',
    'complete range of',
    'shop the full',
    'view all products',
    'see all products',
  ]

  // 3. 通用品牌卖点（单品不应使用）
  const genericBrandTerms = [
    'wide product range',
    'full product line',
    'complete security lineup',
    'smart home lineup',
    'full line of',
    'complete line of',
    'diverse selection',
    'extensive collection',
    'comprehensive range',
    'for all your',
    'for every need',
    'solutions for',
  ]

  // 4. 检查所有文本中的其他品类提及
  allTexts.forEach((text, idx) => {
    otherCategoryTerms.forEach((term) => {
      if (text.includes(term)) {
        const source =
          idx < allHeadlines.length
            ? 'Headline'
            : idx < allHeadlines.length + allDescriptions.length
              ? 'Description'
              : idx < allHeadlines.length + allDescriptions.length + allSitelinkTexts.length
                ? 'Sitelink'
                : 'Callout'
        issues.push(`${source} ${idx + 1} 包含其他品类词: "${term}"`)
        problemCount++
      }
    })
  })

  // 5. 检查Headlines是否太通用（没有产品信息）
  allHeadlines.forEach((text, idx) => {
    // 检查是否太通用（没有产品信息）
    const isTooGeneric =
      text.length < 15 ||
      (!text.includes('pro') &&
        !text.includes('max') &&
        !text.includes('2k') &&
        !text.includes('4k') &&
        !text.includes('camera') &&
        !text.includes('ring'))

    // 获取headline类型
    const headlineType = headlines[idx]?.type || ''

    if (isTooGeneric && headlineType && !text.includes(headlineType)) {
      // 排除正常类型标识（如"brand", "feature"等）
      if (
        ![
          'brand',
          'feature',
          'promo',
          'cta',
          'urgency',
          'social_proof',
          'question',
          'emotional',
        ].includes(headlineType)
      ) {
        issues.push(`Headline ${idx + 1} 可能太通用，缺乏产品细节`)
        problemCount += 0.5
      }
    }
  })

  // 6. 检查Sitelinks中的通用店铺文案
  allSitelinkTexts.forEach((text, idx) => {
    genericStoreTerms.forEach((term) => {
      if (text.includes(term)) {
        issues.push(`Sitelink ${idx + 1} 包含店铺通用文案: "${term}"（单品链接应避免）`)
        problemCount++
      }
    })
  })

  // 7. 检查Callouts中的通用品牌文案
  allCallouts.forEach((text, idx) => {
    genericBrandTerms.forEach((term) => {
      if (text.includes(term)) {
        issues.push(`Callout ${idx + 1} 包含通用品牌文案: "${term}"（单品应突出具体功能）`)
        problemCount++
      }
    })
  })

  // 8. 检查Descriptions中的店铺通用文案
  allDescriptions.forEach((text, idx) => {
    genericStoreTerms.forEach((term) => {
      if (text.includes(term)) {
        issues.push(`Description ${idx + 1} 包含店铺通用文案: "${term}"（单品链接应避免）`)
        problemCount++
      }
    })
  })

  // 9. 计算得分
  // 基于问题数量扣分
  let score = 4
  if (problemCount >= 3) score = 0
  else if (problemCount >= 2.5) score = 1
  else if (problemCount >= 1.5) score = 2
  else if (problemCount >= 0.5) score = 3

  // 10. 额外检查：是否提到多个品类（使用动态品类列表）
  const categoryMentions = allTexts.filter((text) =>
    allCategoryTerms.some((cat) => text.includes(cat))
  ).length

  if (categoryMentions > 3) {
    issues.push(`创意中提及多个品类（${categoryMentions}次），建议聚焦单一品类`)
    score = Math.max(0, score - 1)
  }

  // 输出调试信息
  if (score < 4) {
    console.log(`⚠️ 单品聚焦度评分: ${score}/4 (${problemCount}个问题)`)
    issues.forEach((issue) => console.log(`   - ${issue}`))
  } else {
    console.log(`✅ 单品聚焦度评分: ${score}/4 (无问题)`)
  }

  return { score, issues }
}
