import type { HeadlineAsset, DescriptionAsset } from '../../server'
export function calculateCompleteness(
  headlines: HeadlineAsset[],
  descriptions: DescriptionAsset[]
) {
  // 3.1 资产数量 (0-9分)
  const headlineCount = Math.min(15, headlines.length)
  const descriptionCount = Math.min(4, descriptions.length)
  const assetCount = (headlineCount / 15) * 6.75 + (descriptionCount / 4) * 2.25 // Headlines占6.75分，Descriptions占2.25分

  // 3.2 字符合规性 (0-6分)
  const headlineCompliance =
    headlines.length > 0
      ? headlines.filter((h) => {
          const len = h.length || h.text.length
          return len >= 10 && len <= 30
        }).length / headlines.length
      : 0

  const descriptionCompliance =
    descriptions.length > 0
      ? descriptions.filter((d) => {
          const len = d.length || d.text.length
          return len >= 60 && len <= 90
        }).length / descriptions.length
      : 0

  const characterCompliance = headlineCompliance * 3.75 + descriptionCompliance * 2.25

  const totalScore = assetCount + characterCompliance

  return {
    score: Math.min(15, Math.round(totalScore)), // 确保不超过最大值15
    weight: 0.15 as const,
    details: {
      assetCount: Math.round(assetCount),
      characterCompliance: Math.round(characterCompliance),
    },
  }
}
