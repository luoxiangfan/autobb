/**
 * Offer 提取收敛 — 冒烟脚本
 *
 * 用法:
 *   npx tsx scripts/smoke-offer-extraction.ts
 *
 * 环境变量（可选）:
 *   SMOKE_BASE_URL   默认 http://localhost:3000
 *   SMOKE_USER_ID    用于 x-user-id 头
 *   SMOKE_OFFER_ID   已有 Offer ID，跑 rebuild/scrape API 探测
 */

const BASE = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const USER_ID = process.env.SMOKE_USER_ID
const OFFER_ID = process.env.SMOKE_OFFER_ID

async function runUnitChecks(): Promise<boolean> {
  console.log('\n=== 1. 单元测试（vitest）===\n')
  const { execSync } = await import('child_process')
  try {
    execSync(
      'npx vitest run src/lib/offer-extract-request.test.ts src/lib/offer-extract-regression.test.ts src/lib/offer-extraction-mode.test.ts src/lib/offer-extraction-task.test.ts src/lib/offer-scraped-products-sync.test.ts src/lib/offer-update-from-body.test.ts src/lib/__tests__/autoads-request-normalizers.test.ts src/lib/__tests__/offer-monetization.test.ts src/lib/__tests__/offer-utils-target-country.test.ts src/app/api/offers/__tests__/offer-extraction-routes.test.ts src/app/api/offers/batch/rebuild/route.test.ts',
      { stdio: 'inherit', cwd: process.cwd() }
    )
    return true
  } catch {
    console.error('单元测试失败')
    return false
  }
}

async function apiPost(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (USER_ID) headers['x-user-id'] = USER_ID

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    json = await res.text()
  }
  return { status: res.status, json }
}

async function runApiChecks(): Promise<void> {
  if (!USER_ID || !OFFER_ID) {
    console.log('\n=== 2. API 探测（跳过：设置 SMOKE_USER_ID + SMOKE_OFFER_ID）===\n')
    return
  }

  console.log('\n=== 2. API 探测 ===\n')

  const invalid = await apiPost(`/api/offers/${OFFER_ID}/rebuild`, { extraction_mode: 'bogus' })
  console.log('rebuild 非法模式:', invalid.status, invalid.json)
  if (invalid.status !== 400) {
    console.warn('  ⚠️ 预期 HTTP 400')
  } else {
    console.log('  ✓ 非法模式返回 400')
  }

  const rebuild = await apiPost(`/api/offers/${OFFER_ID}/rebuild`, { extraction_mode: 'fast' })
  console.log('rebuild fast:', rebuild.status, rebuild.json)
  if (rebuild.status === 200) {
    console.log('  ✓ 重建入队成功')
  }

  const extractStores = await apiPost('/api/offers/extract', {
    affiliate_link: 'https://www.amazon.com/stores/page/SMOKE',
    target_country: 'US',
  })
  console.log('extract stores URL:', extractStores.status, extractStores.json)
  if (extractStores.status === 200) {
    console.log('  ✓ extract stores URL 入队')
  }
}

async function main() {
  console.log('Offer 提取收敛 — 冒烟')
  console.log(`BASE=${BASE}`)

  const unitOk = await runUnitChecks()
  await runApiChecks()

  console.log('\n=== 3. 手动 UI 清单 ===')
  console.log('见 docs/smoke-offer-extraction.md\n')

  if (!unitOk) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
