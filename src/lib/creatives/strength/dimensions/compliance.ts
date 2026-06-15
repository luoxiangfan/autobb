import type { HeadlineAsset, DescriptionAsset } from '../..'
import { FORBIDDEN_WORDS } from '../lexicons'
import { calculateSimilarity } from '../text-similarity'

export function calculateCompliance(headlines: HeadlineAsset[], descriptions: DescriptionAsset[]) {
  const allTexts = [...headlines.map((h) => h.text), ...descriptions.map((d) => d.text)]

  // 5.1 政策遵守 (0-6分)
  // 基础合规：6分，每发现1个问题扣2分
  let policyIssues = 0

  // 检查重复内容（超过80%相似视为重复）
  for (let i = 0; i < allTexts.length; i++) {
    for (let j = i + 1; j < allTexts.length; j++) {
      const similarity = calculateSimilarity(allTexts[i], allTexts[j])
      if (similarity > 0.8) policyIssues++
    }
  }

  const policyAdherence = Math.max(0, 6 - policyIssues * 2)

  // 5.2 无垃圾词汇 (0-4分)
  const forbiddenWordsFound = allTexts.filter((text) =>
    FORBIDDEN_WORDS.some((word) => text.toLowerCase().includes(word.toLowerCase()))
  ).length

  const noSpamWords = Math.max(0, 4 - forbiddenWordsFound)

  const totalScore = policyAdherence + noSpamWords

  return {
    score: Math.min(10, Math.round(totalScore)), // 确保不超过最大值10
    weight: 0.1 as const,
    details: {
      policyAdherence: Math.round(policyAdherence),
      noSpamWords: Math.round(noSpamWords),
    },
  }
}
