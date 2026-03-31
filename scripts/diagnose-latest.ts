#!/usr/bin/env tsx
/**
 * 诊断最新生成的关键词池和广告创意
 */

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 环境变量未设置')
  process.exit(1)
}

async function main() {
  const sql = postgres(DATABASE_URL)

  console.log('========== 最新数据诊断 ==========\n')

  // 1. 查询最新关键词池
  console.log('=== 1. 最新关键词池 ===\n')
  const pool = await sql`
    SELECT id, offer_id, total_keywords, created_at
    FROM offer_keyword_pools
    WHERE offer_id = 1993
    ORDER BY created_at DESC
    LIMIT 1
  `
  console.table(pool)

  if (pool.length === 0) {
    console.log('❌ 未找到关键词池')
    await sql.end()
    return
  }

  const poolId = pool[0].id

  // 2. 解析品牌关键词
  console.log('\n=== 2. 品牌关键词详细分析 ===\n')
  const poolData = await sql`
    SELECT brand_keywords::text as brand_keywords_text
    FROM offer_keyword_pools
    WHERE id = ${poolId}
  `

  if (poolData.length > 0) {
    let brandKeywords = JSON.parse(poolData[0].brand_keywords_text)
    if (typeof brandKeywords === 'string') {
      brandKeywords = JSON.parse(brandKeywords)
    }

    console.log(`品牌关键词总数: ${brandKeywords.length}`)
    console.log('\n所有品牌关键词:')
    console.table(brandKeywords.map((kw: any) => ({
      keyword: kw.keyword,
      searchVolume: kw.searchVolume || 0,
      competition: kw.competition || 'N/A',
      source: kw.source,
      volumeUnavailableReason: kw.volumeUnavailableReason || 'N/A'
    })))
  }

  // 3. 解析 Bucket A
  console.log('\n=== 3. Bucket A 关键词分析 ===\n')
  const bucketAData = await sql`
    SELECT bucket_a_keywords::text as bucket_a_text
    FROM offer_keyword_pools
    WHERE id = ${poolId}
  `

  if (bucketAData.length > 0) {
    let bucketA = JSON.parse(bucketAData[0].bucket_a_text)
    if (typeof bucketA === 'string') {
      bucketA = JSON.parse(bucketA)
    }

    console.log(`Bucket A 关键词总数: ${bucketA.length}`)
    console.log('\n前 10 个 Bucket A 关键词:')
    console.table(bucketA.slice(0, 10).map((kw: any) => ({
      keyword: kw.keyword,
      searchVolume: kw.searchVolume || 0,
      competition: kw.competition || 'N/A',
      source: kw.source,
      volumeUnavailableReason: kw.volumeUnavailableReason || 'N/A'
    })))

    // 统计
    const withVolume = bucketA.filter((k: any) => k.searchVolume > 0).length
    const withReason = bucketA.filter((k: any) => k.volumeUnavailableReason).length

    console.log(`\nBucket A 统计:`)
    console.log(`  - 有搜索量: ${withVolume}`)
    console.log(`  - 无搜索量: ${bucketA.length - withVolume}`)
    console.log(`  - 有 volumeUnavailableReason: ${withReason}`)
  }

  // 4. 查询广告创意
  console.log('\n=== 4. 最新广告创意 ===\n')
  const creative = await sql`
    SELECT id, offer_id, created_at, keywords
    FROM ad_creatives
    WHERE id = 2495
  `
  console.table(creative.map((c: any) => ({
    id: c.id,
    offer_id: c.offer_id,
    created_at: c.created_at
  })))

  if (creative.length > 0 && creative[0].keywords) {
    const keywords = JSON.parse(creative[0].keywords)
    console.log(`\n关键词总数: ${keywords.length}`)
    console.log(`关键词类型: ${typeof keywords[0]}`)

    if (Array.isArray(keywords)) {
      console.log('\n前 5 个关键词:')
      console.table(keywords.slice(0, 5).map((kw: any) => {
        if (typeof kw === 'string') {
          return { keyword: kw, type: 'string', searchVolume: 'N/A' }
        } else {
          return {
            keyword: kw.keyword || kw,
            type: 'object',
            searchVolume: kw.searchVolume || 0
          }
        }
      }))
    }
  }

  // 5. 检查 global_keywords 表
  console.log('\n=== 5. global_keywords 表检查 ===\n')
  const globalKw = await sql`
    SELECT keyword, search_volume, created_at
    FROM global_keywords
    WHERE keyword ILIKE '%mercola%'
      AND country = 'US'
      AND created_at > '2026-01-21 07:00:00'
    ORDER BY search_volume DESC
    LIMIT 10
  `

  if (globalKw.length > 0) {
    console.log('✅ 7:00 之后有新的 Mercola 关键词:')
    console.table(globalKw)
  } else {
    console.log('⚠️ 7:00 之后没有新的 Mercola 关键词')

    // 查看最近的
    const recentKw = await sql`
      SELECT keyword, search_volume, created_at
      FROM global_keywords
      WHERE keyword ILIKE '%mercola%'
        AND country = 'US'
      ORDER BY created_at DESC
      LIMIT 10
    `
    console.log('\n最近的 Mercola 关键词:')
    console.table(recentKw)
  }

  await sql.end()
}

main().catch(console.error)
