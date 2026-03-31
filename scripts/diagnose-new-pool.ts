#!/usr/bin/env tsx
/**
 * 排查新生成的关键词池问题
 */

import postgres from 'postgres'

const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL 环境变量未设置')
  process.exit(1)
}

async function main() {
  const sql = postgres(DATABASE_URL)

  console.log('========== 新生成关键词池排查 ==========\n')

  // 1. 查询新关键词池基本信息
  console.log('=== 1. 新关键词池基本信息 ===\n')
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
  console.log('\n=== 2. 品牌关键词分析 ===\n')
  const poolData = await sql`
    SELECT brand_keywords::text as brand_keywords_text
    FROM offer_keyword_pools
    WHERE id = ${poolId}
  `

  if (poolData.length > 0) {
    let brandKeywords = JSON.parse(poolData[0].brand_keywords_text)

    // 双重 JSON 解析
    if (typeof brandKeywords === 'string') {
      brandKeywords = JSON.parse(brandKeywords)
    }

    console.log(`品牌关键词总数: ${brandKeywords.length}`)
    console.log('\n前 10 个品牌关键词:')
    console.table(brandKeywords.slice(0, 10).map((kw: any) => ({
      keyword: kw.keyword,
      searchVolume: kw.searchVolume || 0,
      source: kw.source,
      competition: kw.competition || 'N/A'
    })))

    // 统计
    const withVolume = brandKeywords.filter((k: any) => k.searchVolume > 0).length
    const withoutVolume = brandKeywords.filter((k: any) => !k.searchVolume || k.searchVolume === 0).length

    console.log(`\n品牌关键词统计:`)
    console.log(`  - 有搜索量: ${withVolume}`)
    console.log(`  - 无搜索量: ${withoutVolume}`)

    if (withoutVolume > 0) {
      console.log(`  - ❌ 问题: ${withoutVolume} 个品牌关键词缺少搜索量数据`)
    }
  }

  // 3. 解析 bucket A 关键词
  console.log('\n=== 3. Bucket A 关键词分析 ===\n')
  const bucketAData = await sql`
    SELECT bucket_a_keywords::text as bucket_a_text
    FROM offer_keyword_pools
    WHERE id = ${poolId}
  `

  if (bucketAData.length > 0) {
    let bucketAKeywords = JSON.parse(bucketAData[0].bucket_a_text)

    if (typeof bucketAKeywords === 'string') {
      bucketAKeywords = JSON.parse(bucketAKeywords)
    }

    console.log(`Bucket A 关键词总数: ${bucketAKeywords.length}`)
    console.log('\n前 10 个 Bucket A 关键词:')
    console.table(bucketAKeywords.slice(0, 10).map((kw: any) => ({
      keyword: kw.keyword,
      searchVolume: kw.searchVolume || 0,
      source: kw.source,
      competition: kw.competition || 'N/A'
    })))

    const withVolume = bucketAKeywords.filter((k: any) => k.searchVolume > 0).length
    const withoutVolume = bucketAKeywords.filter((k: any) => !k.searchVolume || k.searchVolume === 0).length

    console.log(`\nBucket A 统计:`)
    console.log(`  - 有搜索量: ${withVolume}`)
    console.log(`  - 无搜索量: ${withoutVolume}`)
  }

  // 4. 查询新生成的广告创意
  console.log('\n=== 4. 新生成的广告创意 ===\n')
  const creatives = await sql`
    SELECT id, offer_id, created_at
    FROM ad_creatives
    WHERE id IN (2491, 2493)
    ORDER BY id
  `
  console.table(creatives)

  // 5. 查询广告创意的关键词
  for (const creative of creatives) {
    console.log(`\n--- 广告创意 ${creative.id} 的关键词 ---`)
    const creativeData = await sql`
      SELECT keywords
      FROM ad_creatives
      WHERE id = ${creative.id}
    `

    if (creativeData.length > 0 && creativeData[0].keywords) {
      const keywords = JSON.parse(creativeData[0].keywords)
      console.log(`关键词总数: ${keywords.length}`)
      console.log(`关键词类型: ${typeof keywords[0]}`)

      if (Array.isArray(keywords) && keywords.length > 0) {
        console.log('\n前 5 个关键词:')
        console.table(keywords.slice(0, 5).map((kw: any) => {
          if (typeof kw === 'string') {
            return { keyword: kw, searchVolume: 'N/A (字符串)', type: 'string' }
          } else {
            return {
              keyword: kw.keyword || kw.text || kw,
              searchVolume: kw.searchVolume || kw.avgMonthlySearches || 0,
              type: 'object'
            }
          }
        }))
      }
    }
  }

  // 6. 检查 global_keywords 表
  console.log('\n=== 5. global_keywords 表验证 ===\n')
  const globalKeywords = await sql`
    SELECT keyword, search_volume, created_at
    FROM global_keywords
    WHERE keyword ILIKE '%mercola%'
      AND country = 'US'
      AND created_at > '2026-01-21 06:00:00'
    ORDER BY search_volume DESC
    LIMIT 10
  `

  if (globalKeywords.length > 0) {
    console.log('✅ global_keywords 表中有新的 Mercola 关键词:')
    console.table(globalKeywords)
  } else {
    console.log('⚠️ global_keywords 表中没有新的 Mercola 关键词（6:00 之后）')
  }

  await sql.end()
}

main().catch(console.error)
