import { getDatabase } from '@/lib/db'
import { extractAsinFromOfferUrls } from '@/lib/openclaw/offer-asin'

async function main() {
  const db = await getDatabase()
  const rows = await db.query<{
    id: number
    url: string | null
    final_url: string | null
    asin: string | null
  }>(
    `
      SELECT id, url, final_url, asin
      FROM offers
      WHERE asin IS NULL
    `
  )

  let updated = 0
  for (const row of rows) {
    const asin = extractAsinFromOfferUrls(row.url, row.final_url)
    if (!asin) continue
    await db.exec('UPDATE offers SET asin = ? WHERE id = ?', [asin, row.id])
    updated += 1
  }

  console.log(`Backfilled ASIN for ${updated} offers (${rows.length} scanned).`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
