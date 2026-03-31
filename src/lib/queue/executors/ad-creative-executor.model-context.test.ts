import { describe, expect, it } from 'vitest'

import { __testOnly } from '@/lib/creative-keyword-context-filter'
import { buildProductModelFamilyContext } from '@/lib/model-intent-family-filter'

describe('creative-keyword-context-filter intent tightening', () => {
  it('builds high-signal tokens from product/category context and excludes generic tokens', () => {
    const modelFamilyContext = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX EverFrost 2 58L Cooler with Extra Battery',
      scraped_data: JSON.stringify({ productTitle: 'Anker SOLIX EverFrost 2 58L Cooler' }),
    })
    const required = __testOnly.buildIntentContextAnchorTokens({
      brandName: 'Anker',
      categoryContext: 'Coolers & Refrigerators',
      productName: 'Anker SOLIX EverFrost 2 58L Cooler with Extra Battery',
      modelFamilyContext,
    })

    expect(required.has('anker')).toBe(false)
    expect(required.has('battery')).toBe(false)
    expect(required.has('cooler')).toBe(true)
    expect(required.has('refrigerator')).toBe(true)
    expect(required.has('everfrost')).toBe(true)
    expect(required.has('58l')).toBe(true)
  })

  it('keeps model-intent keywords with product anchors and removes unrelated model-like keywords', () => {
    const modelFamilyContext = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX EverFrost 2 58L Cooler',
      scraped_data: JSON.stringify({ productTitle: 'Anker SOLIX EverFrost 2 58L Cooler' }),
    })
    const required = __testOnly.buildIntentContextAnchorTokens({
      brandName: 'Anker',
      categoryContext: 'Coolers & Refrigerators',
      productName: 'Anker SOLIX EverFrost 2 58L Cooler',
      modelFamilyContext,
    })

    expect(__testOnly.hasIntentContextAnchor({ keyword: 'anker everfrost 2 cooler', anchorTokens: required, brandName: 'Anker' })).toBe(true)
    expect(__testOnly.hasIntentContextAnchor({ keyword: 'anker power bank 20000mah', anchorTokens: required, brandName: 'Anker' })).toBe(false)
    expect(__testOnly.hasIntentContextAnchor({ keyword: 'anker solix c300x', anchorTokens: required, brandName: 'Anker' })).toBe(false)
  })

  it('applies brand/product intent-specific keep rules', () => {
    const modelFamilyContext = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX EverFrost 2 58L Cooler',
      scraped_data: JSON.stringify({ productTitle: 'Anker SOLIX EverFrost 2 58L Cooler' }),
    })
    const required = __testOnly.buildIntentContextAnchorTokens({
      brandName: 'Anker',
      categoryContext: 'Coolers & Refrigerators',
      productName: 'Anker SOLIX EverFrost 2 58L Cooler',
      modelFamilyContext,
    })

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker',
      brandName: 'Anker',
      anchorTokens: required,
    })).toBe(true)
    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker power bank 20000mah',
      brandName: 'Anker',
      anchorTokens: required,
    })).toBe(false)
    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'product_intent',
      keyword: 'anker everfrost outdoor cooler',
      brandName: 'Anker',
      anchorTokens: required,
    })).toBe(true)
  })

  it('filters foreign product-model keywords from brand/product intent on product pages while keeping generic brand demand', () => {
    const modelFamilyContext = buildProductModelFamilyContext({
      brand: 'Anker',
      product_name: 'Anker SOLIX F3800 Portable Power Station, 3840Wh, 6000W AC Output',
      scraped_data: JSON.stringify({ productTitle: 'Anker SOLIX F3800 Portable Power Station' }),
    })
    const required = __testOnly.buildIntentContextAnchorTokens({
      brandName: 'Anker',
      categoryContext: 'Generators Patio Lawn Garden Portable Power',
      productName: 'Anker SOLIX F3800 Portable Power Station, 3840Wh, 6000W AC Output, Solar Generator',
      modelFamilyContext,
    })

    expect(required.has('f3800')).toBe(true)
    expect(required.has('3840wh')).toBe(true)
    expect(required.has('generator')).toBe(true)
    expect(required.has('station')).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker generator',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(true)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker solix f3800 price',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(true)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker solix c300x',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker 577 thunderbolt docking station',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker 767 solar generator',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'brand_intent',
      keyword: 'anker solix cooler',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'product_intent',
      keyword: 'anker solix c300x',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'product_intent',
      keyword: 'anker solix cooler',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'product_intent',
      keyword: 'anker 767 solar generator',
      brandName: 'Anker',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)
  })

  it('uses soft family signals as first-class anchors for model_intent tightening', () => {
    const modelFamilyContext = buildProductModelFamilyContext({
      brand: 'Novilla',
      product_name: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
      scraped_data: JSON.stringify({
        rawProductTitle: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
        rawAboutThisItem: ['King size support', '10 inch memory foam design', 'Medium firm feel'],
      }),
    })
    const required = __testOnly.buildIntentContextAnchorTokens({
      brandName: 'Novilla',
      categoryContext: 'Mattresses Bedroom Furniture',
      productName: 'Novilla King Size Mattress, 10 Inch Memory Foam Mattress, Medium Firm',
      modelFamilyContext,
      creativeType: 'model_intent',
    })

    expect(required.has('king')).toBe(true)
    expect(required.has('mattress')).toBe(true)
    expect(required.has('memory')).toBe(true)
    expect(required.has('foam')).toBe(true)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'model_intent',
      keyword: 'novilla king mattress',
      brandName: 'Novilla',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(true)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'model_intent',
      keyword: 'novilla memory foam mattress',
      brandName: 'Novilla',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(true)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'model_intent',
      keyword: 'novilla mattress',
      brandName: 'Novilla',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)

    expect(__testOnly.shouldKeepAfterIntentTightening({
      creativeType: 'model_intent',
      keyword: 'novilla queen mattress',
      brandName: 'Novilla',
      anchorTokens: required,
      pageType: 'product',
      modelFamilyContext,
    })).toBe(false)
  })
})
