import { describe, expect, it } from 'vitest'
import { collectYeahPromosReportRows } from '@/lib/openclaw/yeahpromos-commission-rows'

describe('collectYeahPromosReportRows', () => {
  it('parses nested data.Data rows with sale_comm', () => {
    const rows = collectYeahPromosReportRows({
      code: '100000',
      data: {
        Data: [
          { advert_id: 100, advert_name: 'Brand A', sale_comm: 5.5 },
        ],
      },
    })

    expect(rows).toEqual([
      {
        commission: 5.5,
        advertId: '100',
        brandName: 'Brand A',
        asin: null,
      },
    ])
  })

  it('resolves commission from alternate field names used by YeahPromos feeds', () => {
    const rows = collectYeahPromosReportRows({
      data: {
        rows: [
          { advertId: 200, advertName: 'Brand B', commission_amount: 12.25 },
          { advertId: 201, advertName: 'Brand C', Commission: 3.75 },
        ],
      },
    })

    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, row) => sum + row.commission, 0)).toBeCloseTo(16, 2)
  })

  it('extracts ASIN from sku or product link fields', () => {
    const rows = collectYeahPromosReportRows({
      data: [
        {
          advert_id: 300,
          advert_name: 'Brand D',
          sale_comm: 4,
          sku: 'B0TEST1234',
        },
        {
          advert_id: 301,
          advert_name: 'Brand E',
          sale_comm: 6,
          link: 'https://www.amazon.com/dp/B0LINK1234?tag=abc',
        },
      ],
    })

    expect(rows.map((row) => row.asin)).toEqual(['B0TEST1234', 'B0LINK1234'])
  })
})
