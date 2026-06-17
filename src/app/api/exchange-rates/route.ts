import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { loadAndGetUsdExchangeRates } from '@/lib/common/exchange-rates-snapshot'
import { countUsdExchangeRateRows } from '@/lib/common/exchange-rates-service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request)
  if (!auth.authenticated || !auth.user) {
    return NextResponse.json({ error: '未授权' }, { status: 401 })
  }

  try {
    const [rates, rowCount] = await Promise.all([
      loadAndGetUsdExchangeRates(),
      countUsdExchangeRateRows(),
    ])
    return NextResponse.json({
      rates,
      source: rowCount > 0 ? 'database' : 'fallback',
      rowCount,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
