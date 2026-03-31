/**
 * 初始化Prompt版本数据
 * 从源代码中提取Prompt并导入到数据库
 */

import { getDatabase } from '../src/lib/db'

// 初始Prompt配置（简化版，实际使用时应从源文件动态提取）
const INITIAL_PROMPTS = [
  {
    promptId: 'ad_elements_headlines',
    version: 'v1.0',
    category: '广告创意',
    name: '广告标题生成',
    description: '基于产品信息生成15个Google Search广告标题',
    filePath: 'src/lib/ad-elements-extractor.ts',
    functionName: 'generateHeadlines',
    promptContent: `You are a professional Google Ads copywriter. Based on the following product information, generate 15 Google Search ad headlines.

Product Information:
- Product Name: {productName}
- Brand: {brand}
- Rating: {rating} ({reviews} reviews)
- Features: {features}

High-Volume Keywords:
{keywords}

Requirements:
1. Generate 15 headlines, each with a maximum of 30 characters (including spaces)
2. First 3 headlines must include brand name and core product name (e.g., "Teslong Inspection Camera")
3. Middle 5 headlines should incorporate high-volume keywords
4. Last 7 headlines should emphasize product features, benefits, promotions
5. Use high-intent purchase language (buy, shop, official, store, sale, discount, etc.)
6. Avoid using DKI dynamic insertion syntax

Output Format (JSON):
{
  "headlines": ["headline1", "headline2", ..., "headline15"]
}

Please strictly follow JSON format and ensure 15 headlines.`,
    language: 'English',
    changeNotes: '初始版本 - 支持多语言Prompt生成'
  },
  {
    promptId: 'ad_elements_descriptions',
    version: 'v1.0',
    category: '广告创意',
    name: '广告描述生成',
    description: '基于产品信息生成4个Google Search广告描述',
    filePath: 'src/lib/ad-elements-extractor.ts',
    functionName: 'generateDescriptions',
    promptContent: `You are a professional Google Ads copywriter. Based on the following product information, generate 4 Google Search ad descriptions.

Product Information:
- Product Name: {productName}
- Brand: {brand}
- Features: {features}

Requirements:
1. Generate 4 descriptions, each with a maximum of 90 characters (including spaces)
2. First 2 descriptions should highlight product features and benefits
3. Last 2 descriptions should emphasize promotions, discounts, or special offers
4. Use high-intent purchase language
5. Include call-to-action phrases

Output Format (JSON):
{
  "descriptions": ["description1", "description2", "description3", "description4"]
}

Please strictly follow JSON format and ensure 4 descriptions.`,
    language: 'English',
    changeNotes: '初始版本 - 支持特性突出和促销信息'
  },
  {
    promptId: 'keywords_generation',
    version: 'v1.0',
    category: '关键词',
    name: '关键词生成（已废弃）',
    description: '⚠️ 已废弃 (2025-12-14): 正向关键词生成已迁移到Keyword Planner API。请使用 unified-keyword-service.ts',
    filePath: 'src/lib/keyword-generator.ts',
    functionName: 'generateKeywords',
    promptContent: `⚠️ DEPRECATED (2025-12-14)

This prompt is no longer in use.

MIGRATION PATH:
- Positive keyword generation → unified-keyword-service.ts getUnifiedKeywordData()
- Uses Google Ads Keyword Planner API
- Brand whitelist filtering for relevance
- Search volume sorting (DESC) for high-value keywords

For negative keywords, use keyword-generator.ts generateNegativeKeywords() which is still active.`,
    language: 'English',
    changeNotes: '⚠️ 废弃: AI关键词生成被Keyword Planner API + 白名单过滤替代'
  },
  {
    promptId: 'competitor_analysis',
    version: 'v1.0',
    category: '竞品分析',
    name: '竞品分析',
    description: '分析竞品特性、定价和竞争力评分',
    filePath: 'src/lib/competitor-analyzer.ts',
    functionName: 'analyzeCompetitorsWithAI',
    promptContent: `You are an e-commerce competitive analysis expert. Based on the following product and competitor information, provide a competitive analysis.

Our Product:
- Name: {productName}
- Price: {price}
- Features: {features}

Competitors:
{competitorsList}

Requirements:
1. For each competitor, extract:
   - Brand name
   - Product model/name
   - Price
   - Key features
   - Star rating and review count
   - Unique selling points (USPs)

2. Calculate competitiveness score (0-100) based on:
   - Price competitiveness (30%)
   - Feature comparison (30%)
   - Rating and reviews (20%)
   - Brand reputation (20%)

3. Provide strategic recommendations

Output Format (JSON):
{
  "competitors": [
    {
      "brand": "Brand Name",
      "model": "Product Model",
      "price": 299.99,
      "currency": "USD",
      "rating": 4.5,
      "reviewCount": 1234,
      "keyFeatures": ["feature1", "feature2"],
      "usps": ["usp1", "usp2"],
      "competitivenessScore": 85
    }
  ],
  "overallAnalysis": {
    "ourPosition": "market leader|challenger|follower",
    "strengthsVsCompetitors": ["strength1", "strength2"],
    "weaknessesVsCompetitors": ["weakness1", "weakness2"],
    "recommendations": ["rec1", "rec2"]
  }
}`,
    language: 'English',
    changeNotes: '初始版本 - 支持多维度竞品分析'
  },
  {
    promptId: 'review_analysis',
    version: 'v1.0',
    category: '评论分析',
    name: '评论分析',
    description: '提取产品优缺点、用户情感和使用场景',
    filePath: 'src/lib/review-analyzer.ts',
    functionName: 'analyzeReviewsWithAI',
    promptContent: `You are an e-commerce review analysis expert. Based on the following product reviews, extract key insights.

Product Reviews:
{reviews}

Requirements:
1. Extract top pros and cons (at least 3 each)
2. Identify common use cases and scenarios
3. Analyze overall sentiment
4. Highlight most frequent concerns

Output Format (JSON):
{
  "pros": ["pro1", "pro2", "pro3"],
  "cons": ["con1", "con2", "con3"],
  "useCases": ["use case1", "use case2"],
  "sentiment": {
    "overall": "positive|neutral|negative",
    "score": 0-100,
    "distribution": {
      "positive": 70,
      "neutral": 20,
      "negative": 10
    }
  },
  "commonConcerns": ["concern1", "concern2"],
  "keyTakeaways": ["takeaway1", "takeaway2"]
}`,
    language: 'English',
    changeNotes: '初始版本 - 支持情感分析和关键洞察提取'
  },
  {
    promptId: 'launch_score_evaluation',
    version: 'v1.0',
    category: '投放评分',
    name: 'Launch Score评估',
    description: '5维度评估广告投放计划质量（关键词30分+市场契合25分+着陆页20分+预算15分+创意10分）',
    filePath: 'src/lib/scoring.ts',
    functionName: 'createLaunchScore',
    language: 'Chinese',
    changeNotes: '初始版本 - 包含否定关键词检查、跨境域名判断、竞争度分析',
    promptContent: `你是一个专业的Google Ads投放评估专家。请分析以下广告投放计划，并从5个维度进行评分。

评分维度：
1. 关键词质量（30分）- 相关性、否定关键词、意图匹配
2. 市场契合度（25分）- 目标国家匹配、跨境域名判断、受众定位
3. 着陆页质量（20分）- URL可信度、加载速度、移动优化
4. 预算合理性（15分）- CPC合理性、竞争度匹配、ROI潜力
5. 内容创意质量（10分）- 标题吸引力、描述说服力、独特性

重要规则：
- 关键词竞争度仅作参考，不影响评分
- Amazon.ca等跨境域名是正常现象，不应扣分
- 必须严格检查否定关键词（未设置扣5-10分）

输出JSON格式包含各维度详细评分、问题和建议。`
  },
  {
    promptId: 'creative_quality_scoring',
    version: 'v1.0',
    category: '创意评分',
    name: '广告创意质量评分',
    description: '评估单个广告创意的质量（标题40分+描述30分+吸引力20分+合规性10分）',
    filePath: 'src/lib/scoring.ts',
    functionName: 'calculateCreativeQualityScore',
    language: 'Chinese',
    changeNotes: '初始版本 - 快速评分单个创意变体',
    promptContent: `你是一个专业的Google Ads广告创意评估专家。请评估以下广告创意的质量，给出0-100分的评分。

评分标准（总分100分）：
1. 标题质量（40分）- 吸引力15分、长度规范10分、差异化10分、关键词自然5分
2. 描述质量（30分）- 说服力15分、长度规范10分、行动召唤5分
3. 整体吸引力（20分）- 符合导向10分、引起兴趣10分
4. 符合规范（10分）- 避免夸张5分、政策合规5分

输出格式：只返回一个0-100之间的整数，代表评分。例如：92`
  },
  {
    promptId: 'brand_analysis_store',
    version: 'v1.0',
    category: '信息提取',
    name: '品牌店铺分析',
    description: '分析品牌店铺页面，提取品牌定位、热销产品、目标受众等信息',
    filePath: 'src/lib/ai.ts',
    functionName: 'analyzePageWithAI (store mode)',
    language: 'English',
    changeNotes: '初始版本 - 支持热销商品优先分析和Hot Score排序',
    promptContent: `You are a professional brand analyst. Analyze the BRAND STORE PAGE and extract key brand information.

Hot Score Formula: Rating × log10(Review Count + 1)
- 🔥 TOP 5 HOT-SELLING = highest scores (proven winners)
- ✅ Other best sellers = good performers

Analysis Priority:
1. Focus on TOP 5 hot-selling products
2. Quality badges (Amazon's Choice, Best Seller)
3. Prime eligibility
4. Active promotions
5. High review counts (500+)

Extract brand positioning, value proposition, product categories, target audience from hot sellers.
Output JSON format.`
  },
  {
    promptId: 'product_analysis_single',
    version: 'v1.0',
    category: '信息提取',
    name: '单品产品分析',
    description: '分析单个产品页面，提取产品详情、价格、评价、促销等完整信息',
    filePath: 'src/lib/ai.ts',
    functionName: 'analyzePageWithAI (product mode)',
    language: 'English',
    changeNotes: '初始版本 - 包含定价、评价、促销、竞争优势等多维度信息',
    promptContent: `You are a professional product analyst. Analyze THIS SPECIFIC PRODUCT page comprehensively.

CRITICAL: Focus ONLY on the MAIN PRODUCT, ignore:
- "Customers also bought"
- "Frequently bought together"
- "Related products"
- "Compare with similar items"

Extract:
- Product description, USPs, features, target audience
- Pricing (current, original, discount, competitiveness)
- Reviews (rating, count, positives, concerns, use cases)
- Promotions (deals, urgency, free shipping)
- Competitive edges (badges, stock, popularity)

Output comprehensive JSON format.`
  },
  {
    promptId: 'brand_name_extraction',
    version: 'v1.0',
    category: '信息提取',
    name: '品牌名称提取',
    description: '从产品信息中提取准确的品牌名称',
    filePath: 'src/lib/ai.ts',
    functionName: 'extractBrandWithAI',
    language: 'English',
    changeNotes: '初始版本 - 快速准确提取品牌名称',
    promptContent: `You are a brand name extraction expert. Extract the brand name from product information.

RULES:
1. Return ONLY the brand name
2. 2-30 characters
3. Primary brand only
4. Remove "Store", "Official", "Shop"
5. Extract from title if uncertain

Examples:
- "Reolink 4K Security Camera" → "Reolink"
- "BAGSMART Store" → "BAGSMART"

Output: Brand name only, no explanation.`
  }
]

async function initPrompts() {
  console.log('🚀 开始初始化Prompt数据...\n')

  try {
    const db = getDatabase()

    for (const prompt of INITIAL_PROMPTS) {
      // 检查是否已存在
      const existing = await db.queryOne<any>(
        'SELECT id FROM prompt_versions WHERE prompt_id = ? AND version = ?',
        [prompt.promptId, prompt.version]
      )

      if (existing) {
        console.log(`⏭️  跳过 ${prompt.name} (${prompt.version}) - 已存在`)
        continue
      }

      // 插入新Prompt版本
      await db.exec(
        `INSERT INTO prompt_versions
         (prompt_id, version, category, name, description, file_path, function_name,
          prompt_content, language, is_active, change_notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        [
          prompt.promptId,
          prompt.version,
          prompt.category,
          prompt.name,
          prompt.description,
          prompt.filePath,
          prompt.functionName,
          prompt.promptContent,
          prompt.language,
          prompt.changeNotes
        ]
      )

      console.log(`✅ 已导入 ${prompt.name} (${prompt.version})`)
    }

    console.log('\n✨ Prompt初始化完成!')

    // 显示统计
    const stats = await db.query<any>(
      `SELECT category, COUNT(*) as count
       FROM prompt_versions
       WHERE is_active = 1
       GROUP BY category`
    )

    console.log('\n📊 当前Prompt统计:')
    for (const stat of stats) {
      console.log(`   ${stat.category}: ${stat.count}个`)
    }

  } catch (error) {
    console.error('❌ 初始化失败:', error)
    process.exit(1)
  }
}

// 执行初始化
initPrompts()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
