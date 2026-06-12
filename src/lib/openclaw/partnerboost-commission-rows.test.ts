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
          ] } }],
      reportPayloads: [{
        data: {
          list: [
            { estCommission: 5, asin: 'B0TXASIN01' },
          ] } }] })

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ commission: 12.5, asin: 'B0TXASIN01', rawBrand: null })
    expect(rows[1]).toMatchObject({ commission: 7.25, asin: 'B0TXASIN02', rawBrand: null })
    expect(rows.reduce((sum, row) => sum + row.commission, 0)).toBeCloseTo(19.75, 2)
  })

  it('falls back to amazon_report when transaction payloads are empty', () => {
    const rows = collectPartnerboostReportRows({
      transactionPayloads: [],
      reportPayloads: [{
        data: {
          list: [{ estCommission: 8.4, asin: 'B0REPORT01' }] } }] })

    expect(rows).toEqual([
      { commission: 8.4, asin: 'B0REPORT01', rawBrand: null },
    ])
  })

  it('extracts raw brand from merchant_name and matched amazon_report row', () => {
    const rows = collectPartnerboostReportRows({
      transactionPayloads: [{
        data: {
          list: [
            { sale_comm: 12.5, order_id: 'order-1' },
          ] } }],
      reportPayloads: [{
        data: {
          list: [
            {
              order_id: 'order-1',
              asin: 'B0TXASIN01',
              merchant_name: 'Acme Brand_CA' },
          ] } }] })

    expect(rows).toEqual([
      { commission: 12.5, asin: 'B0TXASIN01', rawBrand: 'Acme Brand_CA' },
    ])
  })
})
