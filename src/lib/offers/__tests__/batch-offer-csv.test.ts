import { describe, expect, it } from 'vitest'
import { canonicalizeOfferBatchCsvHeader, decodeCsvTextSmart } from '@/lib/offers/batch-offer-csv'

describe('offer batch csv header', () => {
  it('supports Chinese headers (with BOM)', () => {
    expect(canonicalizeOfferBatchCsvHeader('\uFEFF推广链接')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('推广国家')).toBe('target_country')
    expect(canonicalizeOfferBatchCsvHeader('品牌名')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('产品价格')).toBe('product_price')
    expect(canonicalizeOfferBatchCsvHeader('佣金比例')).toBe('commission_payout')
    expect(canonicalizeOfferBatchCsvHeader('佣金类型')).toBe('commission_type')
    expect(canonicalizeOfferBatchCsvHeader('佣金值')).toBe('commission_value')
    expect(canonicalizeOfferBatchCsvHeader('佣金币种')).toBe('commission_currency')
    expect(canonicalizeOfferBatchCsvHeader('链接类型')).toBe('page_type')
    expect(canonicalizeOfferBatchCsvHeader('单品推广链接1')).toBe('product_link_1')
    expect(canonicalizeOfferBatchCsvHeader('单品推广链接2')).toBe('product_link_2')
    expect(canonicalizeOfferBatchCsvHeader('单品推广链接3')).toBe('product_link_3')
    expect(canonicalizeOfferBatchCsvHeader('平均产品价格')).toBe('product_price')
    expect(canonicalizeOfferBatchCsvHeader('平均佣金比例')).toBe('commission_payout')
  })

  it('supports headers with annotations', () => {
    expect(canonicalizeOfferBatchCsvHeader('推广链接 (affiliate_link)')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('推广国家（target_country）')).toBe('target_country')
    expect(canonicalizeOfferBatchCsvHeader('品牌名 / brand_name')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('产品价格 / product_price')).toBe('product_price')
    expect(canonicalizeOfferBatchCsvHeader('佣金比例｜commission_payout')).toBe('commission_payout')
    expect(canonicalizeOfferBatchCsvHeader('佣金类型 / commission_type')).toBe('commission_type')
    expect(canonicalizeOfferBatchCsvHeader('佣金值（commission_value）')).toBe('commission_value')
    expect(canonicalizeOfferBatchCsvHeader('佣金货币｜commission_currency')).toBe('commission_currency')
    expect(canonicalizeOfferBatchCsvHeader('链接类型 / page_type')).toBe('page_type')
    expect(canonicalizeOfferBatchCsvHeader('单品链接1 / product_link_1')).toBe('product_link_1')
  })

  it('supports common English variants', () => {
    expect(canonicalizeOfferBatchCsvHeader('affiliate_link')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('AffiliateLink')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('affiliate link')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('affiliate-link')).toBe('affiliate_link')
    expect(canonicalizeOfferBatchCsvHeader('targetCountry')).toBe('target_country')
    expect(canonicalizeOfferBatchCsvHeader('brand')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('brand_name')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('BrandName')).toBe('brand_name')
    expect(canonicalizeOfferBatchCsvHeader('pageType')).toBe('page_type')
    expect(canonicalizeOfferBatchCsvHeader('product_link_1')).toBe('product_link_1')
    expect(canonicalizeOfferBatchCsvHeader('productLink2')).toBe('product_link_2')
    expect(canonicalizeOfferBatchCsvHeader('store_product_link_3')).toBe('product_link_3')
    expect(canonicalizeOfferBatchCsvHeader('avg_product_price')).toBe('product_price')
    expect(canonicalizeOfferBatchCsvHeader('average_commission_payout')).toBe('commission_payout')
    expect(canonicalizeOfferBatchCsvHeader('commissionType')).toBe('commission_type')
    expect(canonicalizeOfferBatchCsvHeader('commission_value')).toBe('commission_value')
    expect(canonicalizeOfferBatchCsvHeader('commissionCurrency')).toBe('commission_currency')
  })

  it('decodes GBK/GB18030 CSV exported by Excel', () => {
    const gb18030HeaderBytes = Uint8Array.from([
      0xcd, 0xc6, 0xb9, 0xe3, 0xc1, 0xb4, 0xbd, 0xd3, 0x2c, // 推广链接,
      0xcd, 0xc6, 0xb9, 0xe3, 0xb9, 0xfa, 0xbc, 0xd2, 0x2c, // 推广国家,
      0xb2, 0xfa, 0xc6, 0xb7, 0xbc, 0xdb, 0xb8, 0xf1, 0x2c, // 产品价格,
      0xd3, 0xb6, 0xbd, 0xf0, 0xb1, 0xc8, 0xc0, 0xfd, // 佣金比例
      0x0d, 0x0a,
    ])

    const text = decodeCsvTextSmart(gb18030HeaderBytes)
    expect(text).toContain('推广链接,推广国家,产品价格,佣金比例')
    expect(text).not.toContain('\uFFFD')
  })
})
