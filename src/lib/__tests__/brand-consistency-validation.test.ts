/**
 * 品牌一致性校验测试（2026-01-26）
 * 测试防止因抓取失败导致AI返回错误品牌信息的校验逻辑
 */
import { describe, it, expect } from 'vitest'

// 模拟 validateBrandConsistency 函数的逻辑（从 offer-extraction.ts 复制）
function validateBrandConsistency(
  inputBrand: string,
  brandDescription?: string,
  uniqueSellingPoints?: string,
  category?: string
): { isConsistent: boolean; detectedBrand?: string; reason?: string } {
  if (!inputBrand) {
    return { isConsistent: true }
  }

  const inputBrandLower = inputBrand.toLowerCase().trim()

  const knownOtherBrands = [
    'lilysilk', 'u-share', 'ushare', 'u share',
    'pajama', 'silk pajama', 'picture frame', 'photo frame'
  ]

  if (brandDescription) {
    const descLower = brandDescription.toLowerCase()

    for (const otherBrand of knownOtherBrands) {
      if (descLower.includes(otherBrand) && !inputBrandLower.includes(otherBrand)) {
        return {
          isConsistent: false,
          detectedBrand: otherBrand,
          reason: `品牌描述中提到了 "${otherBrand}"，但录入品牌是 "${inputBrand}"`
        }
      }
    }

    const brandStartMatch = descLower.match(/^([a-z][a-z0-9\-_\s]{1,20})\s+(is|specializes|focuses|offers|provides)/i)
    if (brandStartMatch) {
      const detectedBrand = brandStartMatch[1].trim()
      const b1 = inputBrandLower.replace(/[\s\-_]/g, '')
      const b2 = detectedBrand.replace(/[\s\-_]/g, '')
      if (b1 !== b2 && !b1.includes(b2) && !b2.includes(b1)) {
        return {
          isConsistent: false,
          detectedBrand,
          reason: `品牌描述以 "${detectedBrand}" 开头，但录入品牌是 "${inputBrand}"`
        }
      }
    }
  }

  const electronicsBrands = ['anker', 'reolink', 'eufy', 'soundcore', 'nebula']
  const nonElectronicsCategories = [
    'pajama', 'sleepwear', 'clothing', 'apparel', 'fashion',
    'picture frame', 'photo frame', 'home decor', 'furniture',
    'jewelry', 'cosmetics', 'beauty', 'skincare'
  ]

  if (category && electronicsBrands.includes(inputBrandLower)) {
    const categoryLower = category.toLowerCase()
    for (const nonElecCat of nonElectronicsCategories) {
      if (categoryLower.includes(nonElecCat)) {
        return {
          isConsistent: false,
          reason: `电子产品品牌 "${inputBrand}" 的类别不应该是 "${category}"`
        }
      }
    }
  }

  return { isConsistent: true }
}

describe('validateBrandConsistency', () => {
  it('应该通过：品牌和描述一致', () => {
    const result = validateBrandConsistency(
      'Anker',
      'Anker is a leading brand in mobile charging technology.',
      'Fast charging, portable design'
    )
    expect(result.isConsistent).toBe(true)
  })

  it('应该失败：品牌描述提到了其他品牌 LILYSILK', () => {
    const result = validateBrandConsistency(
      'Anker',
      'LILYSILK is a luxury lifestyle brand specializing in high-quality mulberry silk products.',
      'Crafted from 100% Grade 6A Mulberry Silk'
    )
    expect(result.isConsistent).toBe(false)
    expect(result.detectedBrand).toBe('lilysilk')
  })

  it('应该失败：品牌描述提到了 U-SHARE', () => {
    const result = validateBrandConsistency(
      'Anker',
      'U-SHARE specializes in providing affordable picture frames.',
      'High-Value Set of 10 Frames'
    )
    expect(result.isConsistent).toBe(false)
    expect(result.detectedBrand).toBe('u-share')
  })

  it('应该失败：电子产品品牌的类别是睡衣', () => {
    const result = validateBrandConsistency(
      'Anker',
      'Quality products for everyone.',
      undefined,
      "Men's Pajama Sets"
    )
    expect(result.isConsistent).toBe(false)
    expect(result.reason).toContain('类别不应该是')
  })

  it('应该失败：电子产品品牌的类别是相框', () => {
    const result = validateBrandConsistency(
      'Reolink',
      undefined,
      undefined,
      'Wall & Tabletop Picture Frames'
    )
    expect(result.isConsistent).toBe(false)
  })

  it('应该通过：电子产品品牌的正确类别', () => {
    const result = validateBrandConsistency(
      'Anker',
      'Anker provides high-quality charging solutions.',
      undefined,
      'Cell Phone Accessories'
    )
    expect(result.isConsistent).toBe(true)
  })

  it('应该通过：空品牌名', () => {
    const result = validateBrandConsistency('', 'Some description')
    expect(result.isConsistent).toBe(true)
  })
})
