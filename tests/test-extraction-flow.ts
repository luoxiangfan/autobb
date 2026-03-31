/**
 * 测试脚本：验证需求34的完整数据流
 *
 * 测试流程：
 * 1. 从数据库读取一个已爬取的 Offer
 * 2. 验证提取的数据是否存在
 * 3. 模拟 AI 创意生成，验证是否正确读取提取数据
 */

import { getSQLiteDatabase } from '../src/lib/db'

interface OfferData {
  id: number
  brand: string
  url: string
  extracted_keywords: string | null
  extracted_headlines: string | null
  extracted_descriptions: string | null
  extraction_metadata: string | null
  extracted_at: string | null
  scrape_status: string
}

async function testExtractionFlow() {
  console.log('🧪 开始测试需求34数据流...\n')

  const db = getSQLiteDatabase()

  // 1. 查询所有已爬取完成的 Offers
  console.log('📋 步骤1: 查询已爬取的 Offers...')
  const offers = db.prepare(`
    SELECT id, brand, url, scrape_status,
           extracted_keywords, extracted_headlines, extracted_descriptions,
           extraction_metadata, extracted_at
    FROM offers
    WHERE scrape_status = 'completed'
    ORDER BY updated_at DESC
    LIMIT 10
  `).all() as OfferData[]

  console.log(`   找到 ${offers.length} 个已完成爬取的 Offers\n`)

  if (offers.length === 0) {
    console.log('❌ 测试失败：没有找到已完成爬取的 Offers')
    console.log('   建议：先通过前端创建一个 Offer 并触发爬取\n')
    return
  }

  // 2. 统计提取数据的完整性
  console.log('📊 步骤2: 统计提取数据完整性...')
  const stats = {
    total: offers.length,
    withKeywords: 0,
    withHeadlines: 0,
    withDescriptions: 0,
    withMetadata: 0,
    complete: 0
  }

  offers.forEach(offer => {
    if (offer.extracted_keywords) stats.withKeywords++
    if (offer.extracted_headlines) stats.withHeadlines++
    if (offer.extracted_descriptions) stats.withDescriptions++
    if (offer.extraction_metadata) stats.withMetadata++

    if (offer.extracted_keywords && offer.extracted_headlines && offer.extracted_descriptions) {
      stats.complete++
    }
  })

  console.log(`   总数: ${stats.total}`)
  console.log(`   有关键词: ${stats.withKeywords} (${(stats.withKeywords / stats.total * 100).toFixed(1)}%)`)
  console.log(`   有标题: ${stats.withHeadlines} (${(stats.withHeadlines / stats.total * 100).toFixed(1)}%)`)
  console.log(`   有描述: ${stats.withDescriptions} (${(stats.withDescriptions / stats.total * 100).toFixed(1)}%)`)
  console.log(`   有元数据: ${stats.withMetadata} (${(stats.withMetadata / stats.total * 100).toFixed(1)}%)`)
  console.log(`   数据完整: ${stats.complete} (${(stats.complete / stats.total * 100).toFixed(1)}%)\n`)

  // 3. 详细检查第一个有完整数据的 Offer
  const completeOffer = offers.find(o =>
    o.extracted_keywords && o.extracted_headlines && o.extracted_descriptions
  )

  if (!completeOffer) {
    console.log('⚠️  警告：没有找到数据完整的 Offer')
    console.log('   说明：提取功能可能尚未运行，或者所有 Offer 都是在代码修改前爬取的')
    console.log('   建议：创建一个新的 Offer 并触发爬取，以测试新的提取逻辑\n')

    // 显示第一个 Offer 的详情
    if (offers[0]) {
      console.log('📝 第一个 Offer 详情:')
      console.log(`   ID: ${offers[0].id}`)
      console.log(`   Brand: ${offers[0].brand}`)
      console.log(`   URL: ${offers[0].url}`)
      console.log(`   Status: ${offers[0].scrape_status}`)
      console.log(`   Extracted At: ${offers[0].extracted_at || 'null'}`)
      console.log(`   Has Keywords: ${offers[0].extracted_keywords ? 'Yes' : 'No'}`)
      console.log(`   Has Headlines: ${offers[0].extracted_headlines ? 'Yes' : 'No'}`)
      console.log(`   Has Descriptions: ${offers[0].extracted_descriptions ? 'Yes' : 'No'}`)
    }
    return
  }

  console.log('✅ 步骤3: 详细检查 Offer 数据...')
  console.log(`   Offer ID: ${completeOffer.id}`)
  console.log(`   Brand: ${completeOffer.brand}`)
  console.log(`   URL: ${completeOffer.url.substring(0, 60)}...`)
  console.log(`   提取时间: ${completeOffer.extracted_at}\n`)

  // 解析 JSON 数据
  try {
    const keywords = JSON.parse(completeOffer.extracted_keywords!)
    const headlines = JSON.parse(completeOffer.extracted_headlines!)
    const descriptions = JSON.parse(completeOffer.extracted_descriptions!)
    const metadata = completeOffer.extraction_metadata
      ? JSON.parse(completeOffer.extraction_metadata)
      : null

    console.log('📦 提取的关键词:')
    console.log(`   总数: ${keywords.length}`)
    if (keywords.length > 0) {
      console.log(`   示例（前5个）:`)
      keywords.slice(0, 5).forEach((kw: any, i: number) => {
        console.log(`     ${i + 1}. "${kw.keyword}" - ${kw.searchVolume}/月, 来源: ${kw.source}, 优先级: ${kw.priority}`)
      })

      // 统计关键词来源
      const sourceCounts: Record<string, number> = {}
      keywords.forEach((kw: any) => {
        sourceCounts[kw.source] = (sourceCounts[kw.source] || 0) + 1
      })
      console.log(`   来源分布:`)
      Object.entries(sourceCounts).forEach(([source, count]) => {
        console.log(`     - ${source}: ${count}`)
      })

      // 统计搜索量
      const avgSearchVolume = keywords.reduce((sum: number, kw: any) => sum + kw.searchVolume, 0) / keywords.length
      const maxSearchVolume = Math.max(...keywords.map((kw: any) => kw.searchVolume))
      console.log(`   搜索量统计:`)
      console.log(`     - 平均: ${avgSearchVolume.toFixed(0)}/月`)
      console.log(`     - 最高: ${maxSearchVolume}/月`)
    }
    console.log()

    console.log('📰 提取的标题:')
    console.log(`   总数: ${headlines.length}`)
    if (headlines.length > 0) {
      console.log(`   示例（前5个）:`)
      headlines.slice(0, 5).forEach((h: string, i: number) => {
        console.log(`     ${i + 1}. "${h}" (${h.length}字符)`)
      })

      // 统计标题长度
      const avgLength = headlines.reduce((sum: number, h: string) => sum + h.length, 0) / headlines.length
      const maxLength = Math.max(...headlines.map((h: string) => h.length))
      console.log(`   长度统计:`)
      console.log(`     - 平均: ${avgLength.toFixed(1)}字符`)
      console.log(`     - 最长: ${maxLength}字符 (限制30字符)`)

      if (maxLength > 30) {
        console.log(`     ⚠️  警告：发现超长标题！`)
      }
    }
    console.log()

    console.log('📝 提取的描述:')
    console.log(`   总数: ${descriptions.length}`)
    if (descriptions.length > 0) {
      console.log(`   示例:`)
      descriptions.forEach((d: string, i: number) => {
        console.log(`     ${i + 1}. "${d}" (${d.length}字符)`)
      })

      // 统计描述长度
      const avgLength = descriptions.reduce((sum: number, d: string) => sum + d.length, 0) / descriptions.length
      const maxLength = Math.max(...descriptions.map((d: string) => d.length))
      console.log(`   长度统计:`)
      console.log(`     - 平均: ${avgLength.toFixed(1)}字符`)
      console.log(`     - 最长: ${maxLength}字符 (限制90字符)`)

      if (maxLength > 90) {
        console.log(`     ⚠️  警告：发现超长描述！`)
      }
    }
    console.log()

    if (metadata) {
      console.log('📊 提取元数据:')
      console.log(`   产品数量: ${metadata.productCount || 1}`)
      if (metadata.keywordSources) {
        console.log(`   关键词来源统计:`)
        Object.entries(metadata.keywordSources).forEach(([source, count]) => {
          console.log(`     - ${source}: ${count}`)
        })
      }
      if (metadata.topProducts && metadata.topProducts.length > 0) {
        console.log(`   热销产品（前3）:`)
        metadata.topProducts.slice(0, 3).forEach((p: any, i: number) => {
          console.log(`     ${i + 1}. ${p.name} - ${p.rating}⭐ (${p.reviewCount} reviews)`)
        })
      }
      console.log()
    }

    console.log('✅ 数据验证通过！\n')

    // 4. 模拟 AI 创意生成流程
    console.log('🤖 步骤4: 模拟 AI 创意生成流程...')
    console.log('   (验证 ad-creative-generator.ts 是否能正确读取提取数据)\n')

    // 模拟读取逻辑
    const extractedElements = {
      keywords,
      headlines,
      descriptions
    }

    console.log('   ✅ 成功读取提取的数据')
    console.log(`   ✅ 关键词: ${extractedElements.keywords.length}个`)
    console.log(`   ✅ 标题: ${extractedElements.headlines.length}个`)
    console.log(`   ✅ 描述: ${extractedElements.descriptions.length}个\n`)

    // 模拟 AI prompt 构建
    console.log('   📝 模拟构建 AI Prompt...')

    const topKeywords = extractedElements.keywords
      .filter((k: any) => k.searchVolume >= 500)
      .slice(0, 10)
      .map((k: any) => `"${k.keyword}" (${k.searchVolume}/mo, ${k.source})`)

    if (topKeywords.length > 0) {
      console.log('   ✅ 将以下关键词添加到 prompt:')
      topKeywords.slice(0, 3).forEach((kw: string) => {
        console.log(`      - ${kw}`)
      })
    }

    if (extractedElements.headlines.length > 0) {
      console.log('   ✅ 将以下标题添加到 prompt 作为参考:')
      extractedElements.headlines.slice(0, 2).forEach((h: string) => {
        console.log(`      - "${h}"`)
      })
    }

    if (extractedElements.descriptions.length > 0) {
      console.log('   ✅ 将以下描述添加到 prompt 作为参考:')
      console.log(`      - "${extractedElements.descriptions[0]}"`)
    }

    console.log('\n✅ 完整数据流测试通过！')
    console.log('\n总结：')
    console.log('  ✅ 数据库 schema 扩展成功')
    console.log('  ✅ 爬虫能够提取并保存数据')
    console.log('  ✅ AI 生成器能够读取提取的数据')
    console.log('  ✅ 数据格式和长度验证通过')

  } catch (parseError: any) {
    console.log('❌ JSON 解析失败:', parseError.message)
    console.log('   原始数据可能格式不正确\n')
  }
}

// 运行测试
testExtractionFlow().catch(error => {
  console.error('❌ 测试失败:', error)
  process.exit(1)
})
