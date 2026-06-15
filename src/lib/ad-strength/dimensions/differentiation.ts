import type { HeadlineAsset, DescriptionAsset } from '../../ad-creative'
export function calculateDifferentiation(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[],
  _brandName?: string,
  _productData?: any
): number {
  const allTexts = [...headlines.map((h) => h.text), ...descriptions.map((d) => d.text)]
    .join(' ')
    .toLowerCase()
  let score = 0

  // 1. 技术规格提及 (+1.5分)
  // 检查是否提到具体的技术参数（4K, HD, AI, WiFi, Bluetooth, 5G, LTE等）
  const techSpecs =
    /4k|8k|hd|uhd|ai|wifi|bluetooth|5g|lte|4g|poe|nvr|dvr|fps|mp|ghz|mah|watts|ip\d{2}/i
  const hasTechSpecs = techSpecs.test(allTexts)
  if (hasTechSpecs) {
    score += 1.5
    console.log(`   ✅ 提及技术规格 (+1.5分)`)
  }

  // 2. 独特功能提及 (+1.5分)
  // 检查是否提到独特的功能特性（no subscription, solar, battery, wireless, waterproof, night vision等）
  const uniqueFeatures =
    /no subscription|subscription.free|solar.powered|battery.powered|wireless|waterproof|night.vision|motion.detection|two.way.audio|cloud.storage|local.storage|voice.control|smart.home/i
  const hasUniqueFeatures = uniqueFeatures.test(allTexts)
  if (hasUniqueFeatures) {
    score += 1.5
    console.log(`   ✅ 提及独特功能 (+1.5分)`)
  }

  // 3. 避免过于通用的标题 (+1分)
  // 检查是否存在过于通用的标题（"Buy Now", "Shop Now", "Best Quality", "Trusted Brand"等）
  const genericPhrases = [
    /^buy now$/i,
    /^shop now$/i,
    /^get yours$/i,
    /^trusted [\w\s]+$/i, // "Trusted Security Cameras"
    /^best [\w\s]+$/i, // "Best Quality Products"
    /^high quality$/i,
    /^premium [\w\s]+$/i,
    /^top rated$/i,
    /^official site$/i, // "Official Site"
  ]

  const genericHeadlineCount = headlines.filter((h) => {
    const text = h.text.trim()
    return genericPhrases.some((pattern) => pattern.test(text))
  }).length

  if (genericHeadlineCount === 0) {
    score += 1
    console.log(`   ✅ 无通用标题 (+1分)`)
  } else if (genericHeadlineCount <= 2) {
    score += 0.5
    console.log(`   ⚠️ ${genericHeadlineCount}个通用标题 (+0.5分)`)
  } else {
    console.log(`   ❌ ${genericHeadlineCount}个通用标题 (+0分)`)
  }

  // 确保分数在0-4之间
  return Math.min(4, Math.max(0, score))
}
