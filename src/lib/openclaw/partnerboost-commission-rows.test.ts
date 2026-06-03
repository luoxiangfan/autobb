import { describe, expect, it } from 'vitest'
import { collectPartnerboostReportRows } from '@/lib/openclaw/partnerboost-commission-rows'

describe('collectPartnerboostReportRows', () => {
  it('prefers transaction rows over amazon_report when both exist', () => {
    const rows = collectPartnerboostReportRows({
      transactionPayloads: [{
        data: {
          list: [
            { sale_comm: 12.5, asin: 'B0TXASIN01', order_id: 'order-1' },
            { sale_comm: 7.25, asin: 'B0TXASIN02', order_id: 'order-2' },
          ],
        },
      }],
      reportPayloads: [{
        data: {
          list: [
            { estCommission: 5, asin: 'B0TXASIN01' },
          ],
        },
      }],
    })

    expect(rows).toHaveLength(2)
    expect(rows.reduce((sum, row) => sum + row.commission, 0)).toBeCloseTo(19.75, 2)
  })

  it('falls back to amazon_report when transaction payloads are empty', () => {
    const rows = collectPartnerboostReportRows({
      transactionPayloads: [],
      reportPayloads: [{
        data: {
          list: [{ estCommission: 8.4, asin: 'B0REPORT01' }],
        },
      }],
    })

    expect(rows).toEqual([
      { commission: 8.4, asin: 'B0REPORT01' },
    ])
  })
})
