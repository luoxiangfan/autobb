-- Migration: 081_launch_score_v4.16_matchtype_scoring.sql
-- Purpose: Update Launch Score to v4.16 with intelligent matchType scoring strategy
-- Date: 2025-12-18
-- Author: Claude Code
--
-- Changes:
-- 1. Create new launch_score v4.16 prompt version
-- 2. Deactivate v4.15 (previous version)
-- 3. Update matchType scoring logic (0-6 points):
--    - Reward EXACT match for brand keywords (brand protection)
--    - Reward PHRASE match for brand-related and generic keywords (quality control)
--    - Penalize excessive BROAD match usage (>30% = risk)
--    - Scoring examples:
--      * EXACT: 5 + PHRASE: 25 + BROAD: 0 = 6 points (perfect)
--      * EXACT: 3 + PHRASE: 20 + BROAD: 7 = 4 points (good)
--      * EXACT: 0 + PHRASE: 15 + BROAD: 15 = 2 points (risky)
--
-- Related Code Changes:
-- - src/lib/ad-creative-generator.ts: Auto-assign matchType during creative generation
-- - src/lib/keyword-generator.ts: KISS-principle negative keywords (10 categories, 77+ keywords)
--
-- Migration Strategy:
-- - Only insert new prompt version, no table structure changes
-- - Existing launch_scores data remains compatible
-- - Prompt cache must be cleared after migration

BEGIN TRANSACTION;

-- 1. Deactivate v4.15
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'launch_score' AND version = 'v4.15';

-- 2. Create v4.16 version
INSERT OR REPLACE INTO prompt_versions (
  prompt_id,
  version,
  category,
  name,
  description,
  file_path,
  function_name,
  prompt_content,
  language,
  created_by,
  is_active,
  change_notes,
  created_at
) VALUES (
  'launch_score',
  'v4.16',
  '投放评分',
  'Launch Score评估v4.16 - 智能matchType评分',
  '更新matchType评分逻辑：奖励品牌词EXACT精准匹配和非品牌词PHRASE控制性扩展策略。最优策略：纯品牌词→EXACT，品牌相关词→PHRASE，非品牌通用词→PHRASE，BROAD占比≤10%为最优。',
  'src/lib/scoring.ts',
  'calculateLaunchScore',
  '你是一位专业的Google Ads广告投放评估专家，使用4维度评分系统进行评估。

**重要：所有输出必须使用简体中文，包括问题描述(issues)和改进建议(suggestions)。**

=== 广告系列概览 ===
品牌: {{brand}}
产品: {{productName}}
目标国家: {{targetCountry}}
目标语言: {{targetLanguage}}
广告预算: {{budget}}
最高CPC: {{maxCpc}}

=== 品牌搜索数据 ===
品牌名称: {{brand}}
品牌月搜索量: {{brandSearchVolume}}
品牌竞争程度: {{brandCompetition}}

=== 关键词数据 ===
关键词总数: {{keywordCount}}
匹配类型分布: {{matchTypeDistribution}}
关键词搜索量:
{{keywordsWithVolume}}

否定关键词 ({{negativeKeywordsCount}}个): {{negativeKeywords}}

=== 广告创意 ===
标题数量: {{headlineCount}}
描述数量: {{descriptionCount}}
标题示例: {{sampleHeadlines}}
描述示例: {{sampleDescriptions}}
标题多样性: {{headlineDiversity}}%
广告强度: {{adStrength}}

=== 着陆页 ===
最终网址: {{finalUrl}}
页面类型: {{pageType}}

=== 4维度评分系统 (总分100分) ===

**维度1: 投放可行性 (40分)**
评估该广告系列是否值得投放，基于市场潜力。

- 品牌搜索量得分 (0-15分):
  * 月搜索量0-100: 0-3分 (品牌知名度很低)
  * 月搜索量100-500: 4-7分 (新兴品牌)
  * 月搜索量500-2000: 8-11分 (成熟品牌)
  * 月搜索量2000+: 12-15分 (强势品牌)

- 竞争度得分 (0-15分):
  * 竞争度评估基于关键词搜索数据中的竞争度级别:
  * 低竞争 (LOW): 12-15分 (有利可图，易获胜)
  * 中等竞争 (MEDIUM): 7-11分 (正常竞争，需要优化)
  * 高竞争 (HIGH): 0-6分 (激烈竞争，需要大量投入)

- 市场潜力得分 (0-10分):
  * 基于品牌搜索量与竞争度的综合判断:
  * 高搜索量 + 低竞争: 9-10分 (最优市场)
  * 高搜索量 + 中竞争: 7-8分 (良好市场)
  * 高搜索量 + 高竞争: 5-6分 (需要投入)
  * 中搜索量 + 低竞争: 7-8分 (稳定市场)
  * 中搜索量 + 中竞争: 5-6分 (正常市场)
  * 中搜索量 + 高竞争: 3-4分 (需谨慎)
  * 低搜索量 + 任何竞争: 0-3分 (市场小)

**维度2: 广告质量 (30分)**
评估广告创意的质量和效果。

- 广告强度得分 (0-15分):
  * POOR(差): 0-3分
  * AVERAGE(一般): 4-8分
  * GOOD(良好): 9-12分
  * EXCELLENT(优秀): 13-15分

- 标题多样性得分 (0-8分):
  * 评估15个标题的独特性和多样性
  * 高多样性(>80%): 7-8分
  * 中等多样性(50-80%): 4-6分
  * 低多样性(<50%): 0-3分

- 描述质量得分 (0-7分):
  * 强CTA和卖点: 6-7分
  * 一般但可用: 3-5分
  * 弱或缺少CTA: 0-2分

**维度3: 关键词策略 (20分)**
评估关键词选择和定向策略。

- 相关性得分 (0-8分):
  * 关键词与产品/品牌的匹配程度
  * 高相关性: 7-8分
  * 中等相关性: 4-6分
  * 低相关性: 0-3分

- 匹配类型得分 (0-6分) **新策略(v4.16)**:
  * 评估策略：品牌词精准化 + 非品牌词控制性扩展

  **最优策略 (5-6分)**：
  - 纯品牌词使用EXACT精准匹配（品牌保护）
  - 品牌相关词使用PHRASE词组匹配（受控扩展）
  - 非品牌通用词使用PHRASE词组匹配（质量控制）
  - BROAD广泛匹配占比 ≤ 10%（新账户慎用）

  **良好策略 (3-4分)**：
  - 大部分关键词使用EXACT或PHRASE
  - BROAD广泛匹配占比 10-30%
  - 品牌词未完全保护（部分使用PHRASE）

  **风险策略 (0-2分)**：
  - 品牌词未使用EXACT精准匹配（严重问题）
  - BROAD广泛匹配占比 > 30%（流量失控风险）
  - 仅使用单一匹配类型

  **评分示例**：
  - EXACT: 5个 + PHRASE: 25个 + BROAD: 0个 = 6分（完美策略）
  - EXACT: 3个 + PHRASE: 20个 + BROAD: 7个 = 4分（良好）
  - EXACT: 0个 + PHRASE: 15个 + BROAD: 15个 = 2分（风险）
  - Not specified（未设置）: 3-4分（中等，提示需要设置）

- 否定关键词得分 (0-6分):
  * 完善的否定词列表(20+个): 5-6分
  * 基本覆盖(10-20个): 3-4分
  * 最少覆盖(5-10个): 1-2分
  * 无否定关键词: 0分 (严重问题)

**维度4: 基础配置 (10分)**
评估技术设置和配置。

- 国家/语言匹配得分 (0-5分):
  * 完全匹配: 5分
  * 轻微不匹配: 2-4分
  * 严重不匹配: 0-1分

- 最终网址得分 (0-5分):
  * URL可以正常访问(HTTP 200): 5分 (满分)
  * URL无法访问或存在问题: 0分

=== 输出格式 ===
仅返回有效的JSON，使用以下精确结构:

{
  "launchViability": {
    "score": 38,
    "brandSearchVolume": 1500,
    "brandSearchScore": 14,
    "profitMargin": 0,
    "profitScore": 0,
    "competitionLevel": "LOW",
    "competitionScore": 14,
    "marketPotentialScore": 10,
    "issues": [],
    "suggestions": ["考虑扩展到其他低竞争市场"]
  },
  "adQuality": {
    "score": 28,
    "adStrength": "GOOD",
    "adStrengthScore": 12,
    "headlineDiversity": 85,
    "headlineDiversityScore": 7,
    "descriptionQuality": 90,
    "descriptionQualityScore": 6,
    "issues": [],
    "suggestions": ["可进一步提升标题差异化至95%以上"]
  },
  "keywordStrategy": {
    "score": 18,
    "relevanceScore": 7,
    "matchTypeScore": 6,
    "negativeKeywordsScore": 5,
    "totalKeywords": 15,
    "negativeKeywordsCount": 8,
    "matchTypeDistribution": {
      "EXACT": 5,
      "PHRASE": 8,
      "BROAD": 2
    },
    "issues": [],
    "suggestions": ["增加品牌保护型否定关键词"]
  },
  "basicConfig": {
    "score": 10,
    "countryLanguageScore": 5,
    "finalUrlScore": 5,
    "budgetScore": 0,
    "targetCountry": "US",
    "targetLanguage": "English",
    "finalUrl": "https://example.com",
    "dailyBudget": 10,
    "maxCpc": 0.17,
    "issues": [],
    "suggestions": []
  },
  "overallRecommendations": [
    "优先建议1：针对最重要的改进点",
    "重要建议2：显著影响投放效果的优化",
    "可选建议3：进一步提升的方向"
  ]
}

**输出规则（严格遵守）：**
1. 使用上述精确的字段名称
2. 所有评分必须在各维度限制范围内
3. 总分 = launchViability.score + adQuality.score + keywordStrategy.score + basicConfig.score (范围0-100，各维度独立评分)
4. 仅返回JSON对象，不要添加其他文本、markdown标记或代码块
5. **所有issues、suggestions和overallRecommendations必须使用简体中文**
6. profitMargin字段保留但设置为0（不再评估盈亏平衡CPC）
7. profitScore字段必须设置为0（已取消利润空间评分）
8. 新增marketPotentialScore字段(0-10分)在launchViability中，用于综合评估品牌搜索量与竞争度
9. basicConfig中budgetScore字段已移除评分职责，保留字段但设置为0
10. 如果某些数据缺失（如匹配类型为"Not specified"），给予合理的中等分数，不要过度惩罚
11. issues数组描述具体问题，suggestions数组提供可操作的改进建议
12. overallRecommendations提供3-5条最重要的综合改进建议
13. **v4.16新增**: matchType评分遵循"品牌词精准化 + 非品牌词控制性扩展"策略，奖励EXACT品牌保护和PHRASE质量控制',
  'Chinese',
  1,
  1,
  'v4.15 → v4.16: 更新matchType评分逻辑，奖励品牌词EXACT精准匹配和非品牌词PHRASE控制性扩展策略。新策略：纯品牌词→EXACT，品牌相关词→PHRASE，非品牌通用词→PHRASE，BROAD占比≤10%为最优。',
  datetime('now')
);

COMMIT;

-- Verification Query (run after migration to verify activation):
-- SELECT version, is_active, name FROM prompt_versions
-- WHERE prompt_id = 'launch_score'
-- ORDER BY created_at DESC LIMIT 5;

-- Expected Result:
-- v4.16 | 1 | Launch Score评估v4.16 - 智能matchType评分
-- v4.15 | 0 | Launch Score评估v4.15
-- v4.14 | 0 | Launch Score评估v4.14

-- Post-Migration Steps:
-- 1. Clear prompt cache: npx tsx scripts/clear-prompt-cache.ts
-- 2. Verify new prompt loaded correctly
-- 3. Test Launch Score calculation with new matchType scoring
