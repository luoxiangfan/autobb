/**
 * 数据修复脚本：修复广告创意中的关键词搜索量不一致问题
 *
 * 问题：
 * - 广告创意160：eufy = 2900
 * - 广告创意161：eufy = 4400
 *
 * 根因：
 * - Historical Metrics API（精确匹配）返回 2900
 * - Keyword Ideas API（相关建议）返回 4400
 * - 两个API返回值不一致，导致同一关键词在不同广告创意中显示不同搜索量
 *
 * 解决方案：
 * - 统一使用 Historical Metrics API 的精确搜索量
 * - 重新查询所有关键词的精确搜索量
 * - 更新数据库中的 keywords_with_volume 字段
 *
 * 用法：npx tsx scripts/fix-keyword-volume-consistency.ts
 */

import { getSQLiteDatabase } from '../src/lib/db'
import { getKeywordSearchVolumes } from '../src/lib/keyword-planner'

interface KeywordWithVolume {
  keyword: string
  searchVolume: number | string // 可能是字符串类型
  competition?: string
  competitionIndex?: number | string
  source?: string
}

async function fixKeywordVolumeConsistency() {
  console.log('🔧 开始修复关键词搜索量一致性问题\n')

  const db = getSQLiteDatabase()

  // 1. 查询需要修复的广告创意
  const creatives = db.prepare(`
    SELECT id, offer_id, keywords_with_volume
    FROM ad_creatives
    WHERE id IN (160, 161)
      AND keywords_with_volume IS NOT NULL
  `).all() as Array<{
    id: number
    offer_id: number
    keywords_with_volume: string
  }>

  if (creatives.length === 0) {
    console.log('⚠️  未找到需要修复的广告创意')
    return
  }

  console.log(`📊 找到 ${creatives.length} 个需要修复的广告创意\n`)

  // 2. 获取offer的国家和语言信息
  const offer = db.prepare(`
    SELECT id, target_country, target_language
    FROM offers
    WHERE id = ?
  `).get(250) as {
    id: number
    target_country: string
    target_language: string
  } | undefined

  if (!offer) {
    console.error('❌ 未找到offer 250')
    return
  }

  const country = offer.target_country
  const targetLanguage = offer.target_language
  const lang = targetLanguage.toLowerCase().substring(0, 2)
  const language = lang === 'it' ? 'it' : 'en'

  console.log(`🌍 Offer ${offer.id}: country=${country}, language=${language} (${targetLanguage})\n`)

  // 3. 修复每个广告创意
  for (const creative of creatives) {
    console.log(`\n📝 处理广告创意 ${creative.id}:`)

    try {
      // 3.1 解析现有关键词数据
      const existingKeywords: KeywordWithVolume[] = JSON.parse(creative.keywords_with_volume)
      console.log(`   原始关键词数: ${existingKeywords.length}`)

      // 3.2 提取所有关键词文本
      const keywordTexts = existingKeywords.map(kw => kw.keyword)

      // 3.3 记录原始数据（用于对比）
      const originalEufy = existingKeywords.find(kw => kw.keyword.toLowerCase() === 'eufy')
      const originalEufi = existingKeywords.find(kw => kw.keyword.toLowerCase() === 'eufi')
      console.log(`   原始数据:`)
      if (originalEufy) {
        console.log(`      - eufy: ${originalEufy.searchVolume} ${originalEufy.source ? `(source: ${originalEufy.source})` : ''}`)
      }
      if (originalEufi) {
        console.log(`      - eufi: ${originalEufi.searchVolume} ${originalEufi.source ? `(source: ${originalEufi.source})` : ''}`)
      }

      // 3.4 重新查询精确搜索量（使用Historical Metrics API）
      console.log(`   🔍 查询 ${keywordTexts.length} 个关键词的精确搜索量...`)
      const accurateVolumes = await getKeywordSearchVolumes(
        keywordTexts,
        country,
        language,
        1 // userId = 1 (autoads)
      )

      // 3.5 创建精确搜索量映射表
      const volumeMap = new Map<string, { volume: number; competition: string; competitionIndex: number }>()
      accurateVolumes.forEach(vol => {
        const canonical = vol.keyword.toLowerCase().trim()
        volumeMap.set(canonical, {
          volume: vol.avgMonthlySearches,
          competition: vol.competition,
          competitionIndex: vol.competitionIndex
        })
      })

      // 3.6 更新关键词数据（使用精确搜索量）
      const updatedKeywords: KeywordWithVolume[] = existingKeywords.map(kw => {
        const canonical = kw.keyword.toLowerCase().trim()
        const accurate = volumeMap.get(canonical)

        if (accurate) {
          return {
            keyword: kw.keyword,
            searchVolume: accurate.volume, // 使用精确值（数字类型）
            competition: accurate.competition,
            competitionIndex: accurate.competitionIndex,
            source: kw.source || 'AI_GENERATED' // 保留原来源标记
          }
        }

        // 如果API没返回，保留原值但标记来源
        return {
          ...kw,
          searchVolume: typeof kw.searchVolume === 'string' ? parseInt(kw.searchVolume) : kw.searchVolume,
          source: 'FALLBACK'
        }
      })

      // 3.7 去重：移除拼写变体（如eufi），保留主关键词（eufy）
      const deduplicatedKeywords: KeywordWithVolume[] = []
      const seenCanonical = new Set<string>()

      // 拼写变体映射表
      const variantMap: Record<string, string> = {
        'eufi': 'eufy'
      }

      for (const kw of updatedKeywords) {
        const canonical = variantMap[kw.keyword.toLowerCase()] || kw.keyword.toLowerCase()

        if (!seenCanonical.has(canonical)) {
          seenCanonical.add(canonical)
          // 如果是变体，使用规范形式
          if (variantMap[kw.keyword.toLowerCase()]) {
            deduplicatedKeywords.push({
              ...kw,
              keyword: variantMap[kw.keyword.toLowerCase()] // 使用规范形式
            })
            console.log(`   🔧 变体处理: "${kw.keyword}" → "${variantMap[kw.keyword.toLowerCase()]}"`)
          } else {
            deduplicatedKeywords.push(kw)
          }
        } else {
          console.log(`   🗑️  去重: "${kw.keyword}" (已存在: "${canonical}")`)
        }
      }

      // 3.8 记录修复后的数据
      const updatedEufy = deduplicatedKeywords.find(kw => kw.keyword.toLowerCase() === 'eufy')
      console.log(`\n   ✅ 修复后数据:`)
      if (updatedEufy) {
        console.log(`      - eufy: ${updatedEufy.searchVolume} (source: ${updatedEufy.source || 'UNKNOWN'})`)
      }
      console.log(`   📊 关键词数: ${existingKeywords.length} → ${deduplicatedKeywords.length}`)

      // 3.9 更新数据库
      db.prepare(`
        UPDATE ad_creatives
        SET keywords_with_volume = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        JSON.stringify(deduplicatedKeywords),
        creative.id
      )

      console.log(`   ✅ 广告创意 ${creative.id} 已更新`)

    } catch (error: any) {
      console.error(`   ❌ 修复失败:`, error.message)
    }
  }

  console.log('\n✅ 修复完成！')
  console.log('\n📋 验证方法：')
  console.log('   sqlite3 ./data/autoads.db "SELECT id, json_extract(keywords_with_volume, \'$[*].keyword\'), json_extract(keywords_with_volume, \'$[*].searchVolume\') FROM ad_creatives WHERE id IN (160, 161);"')
}

// 运行修复
fixKeywordVolumeConsistency().catch(error => {
  console.error('❌ 脚本执行失败:', error)
  process.exit(1)
})
