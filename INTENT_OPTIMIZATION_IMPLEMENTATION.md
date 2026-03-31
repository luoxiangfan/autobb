# Intent-Driven Ad Creative Optimization - Implementation Summary

## 已完成的工作

### 1. 数据库层 ✅

**文件**:
- SQLite: `/migrations/205_add_intent_fields.sql`
- PostgreSQL: `/pg-migrations/205_add_intent_fields.sql`
- SQLite: `/migrations/206_create_intent_analysis.sql`
- PostgreSQL: `/pg-migrations/206_create_intent_analysis.sql`
- SQLite: `/migrations/207_ad_creative_generation_v5.0.sql` (prompt版本)
- PostgreSQL: `/pg-migrations/207_ad_creative_generation_v5.0.sql` (prompt版本)

**变更**:
- 在 `offers` 表添加4个新字段：
  - `user_scenarios` (TEXT): 存储从评论提取的场景数据
  - `pain_points` (TEXT): 存储用户痛点
  - `user_questions` (TEXT): 存储用户常问问题
  - `scenario_analyzed_at` (TEXT/TIMESTAMP): 场景分析时间戳
- 创建 `search_term_intent_analysis` 表（Phase 3用于dashboard）
- 更新 `prompt_versions` 表，添加v5.0版本记录

**运行迁移**:
```bash
# SQLite (本地开发)
npm run db:migrate

# PostgreSQL (生产环境)
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

---

### 2. TypeScript类型定义 ✅

**文件**: `/src/lib/offers.ts`

**变更**:
- 更新 `Offer` 接口，添加intent相关字段

---

### 3. 场景提取逻辑 ✅

**文件**: `/src/lib/scenario-extractor.ts` (新文件)

**功能**:
- `extractScenariosFromReviews()`: 从 `review_analysis` 自动提取场景数据
- 提取3类数据：
  1. 用户场景 (从 `useCases`)
  2. 用户痛点 (从 `painPoints`)
  3. 用户问题 (从 `painPoints` 和 `quantitativeHighlights` 生成)
- **降级策略**: 如果 `review_analysis` 为空，返回空数组（不会报错）

---

### 4. 集成到Offer创建流程 ✅

**文件**: `/src/lib/queue/executors/offer-extraction-executor.ts`

**变更**:
- 在保存 `review_analysis` 后，自动调用 `extractScenariosFromReviews()`
- 将提取的场景数据保存到数据库
- **非致命错误**: 场景提取失败不会中断offer创建流程

---

### 5. 创意生成Prompt优化 ✅

**文件**:
- `/src/lib/creative-splitted/creative-orchestrator.ts`
- `/src/lib/creative-splitted/creative-prompt-builder.ts`
- `/src/lib/creative-splitted/creative-types.ts`

**变更**:
1. **buildPromptVariables()**: 注入场景数据到prompt variables
   - 解析 `user_scenarios`, `pain_points`, `user_questions`
   - 解析 `review_analysis.quantitativeHighlights`
   - 构建4个新sections:
     - `user_scenarios_section`
     - `user_questions_section`
     - `pain_points_section`
     - `quantitative_highlights_section`

2. **buildIntentStrategySection()**: 根据bucket类型生成策略指导
   - **Bucket A (品牌/信任)**: 40% keyword + 60% intent (侧重数据驱动、信任证据)
   - **Bucket B (场景+功能)**: 30% keyword + 70% intent (侧重场景化、问答式)
   - **Bucket D (转化/价值)**: 40% keyword + 60% intent (侧重价值点、数据驱动)

3. **buildPrompt()**: 将intent sections注入到最终prompt

---

## 工作原理

### 数据流

```
1. Offer创建
   ↓
2. 抓取评论 → 生成review_analysis
   ↓
3. extractScenariosFromReviews(review_analysis)
   ↓
4. 保存到数据库 (user_scenarios, pain_points, user_questions)
   ↓
5. 创意生成时读取这些字段
   ↓
6. 注入到AI prompt
   ↓
7. AI生成平衡型创意 (keyword + intent)
```

### 降级策略

```typescript
// 场景1: 没有review_analysis
if (!offer.review_analysis) {
  // extractScenariosFromReviews() 返回空数组
  // prompt中不会有intent sections
  // AI继续使用纯关键词模式生成
}

// 场景2: review_analysis存在但场景数据不足
if (scenarios.length === 0 && userQuestions.length === 0) {
  // prompt中不会有intent sections
  // AI继续使用纯关键词模式生成
}

// 场景3: 有场景数据
if (scenarios.length > 0 || userQuestions.length > 0) {
  // 注入intent strategy section
  // AI按照bucket策略生成平衡型创意
}
```

---

## 如何测试

### 测试1: 验证场景提取

**前提**: 需要先运行数据库迁移

```bash
# 1. 创建一个新offer（必须是有评论的产品）
# 通过UI或API创建offer

# 2. 检查数据库
sqlite3 autobb.db
SELECT
  id,
  brand,
  user_scenarios IS NOT NULL as has_scenarios,
  pain_points IS NOT NULL as has_pain_points,
  user_questions IS NOT NULL as has_questions,
  scenario_analyzed_at
FROM offers
WHERE id = <your_offer_id>;

# 3. 查看提取的数据
SELECT user_scenarios FROM offers WHERE id = <your_offer_id>;
# 应该看到JSON数组，例如:
# [{"scenario":"Perfect for hiking","frequency":"high","keywords":["hiking","outdoor"],"source":"review"}]
```

**预期结果**:
- `user_scenarios`, `pain_points`, `user_questions` 字段有数据
- `scenario_analyzed_at` 有时间戳

---

### 测试2: 验证创意生成（Bucket B）

```bash
# 1. 为有场景数据的offer生成Bucket B创意
POST /api/offers/:id/generate-creatives-queue
{
  "bucket": "B"
}

# 2. 查看生成的headlines
# 应该看到混合型headlines:
# - 30% 关键词密集型: "Smart Watch Fitness Tracker GPS"
# - 40% 场景化: "Perfect for Hiking: 3-Day Battery + GPS"
# - 20% 问答式: "Worried About Battery? 72-Hour Runtime"
# - 10% 数据驱动: "18-Hour Battery - Verified by 5000+ Reviews"
```

**预期结果**:
- Headlines不再是100%关键词堆砌
- 出现场景化表达（"Perfect for...", "Ideal for..."）
- 出现问答式表达（"Worried about...?", "Need..."）
- 使用评论中的具体数字

---

### 测试3: 验证降级（无评论数据的offer）

```bash
# 1. 创建一个没有评论的offer（或review_analysis为空）

# 2. 生成创意
POST /api/offers/:id/generate-creatives-queue
{
  "bucket": "B"
}

# 3. 查看生成的headlines
# 应该看到纯关键词模式（降级成功）
```

**预期结果**:
- 不会报错
- 生成的headlines是纯关键词密集型（v4.48模式）
- Console log显示: "⚠️ 无评论数据，降级到纯关键词模式"

---

### 测试4: 对比A/B/D三种bucket

```bash
# 为同一个offer生成3种bucket的创意
POST /api/offers/:id/generate-creatives-queue {"bucket": "A"}
POST /api/offers/:id/generate-creatives-queue {"bucket": "B"}
POST /api/offers/:id/generate-creatives-queue {"bucket": "D"}

# 对比headlines风格:
# Bucket A: 侧重信任证据、数据驱动
# Bucket B: 侧重场景化、问答式
# Bucket D: 侧重价值点、促销/CTA
```

---

## 预期效果

### Bucket A (品牌/信任导向)

**优化前**:
```
- "Apple Watch Series 8 GPS Fitness Tracker"
- "Apple Watch Heart Rate Monitor Sleep Tracking"
- "Apple Watch Waterproof Smart Watch Official"
```

**优化后**:
```
- "Apple Watch Series 8 GPS Fitness Tracker" (关键词密集)
- "Official Apple Watch - Authorized Retailer" (品牌信任)
- "18-Hour Battery - Verified by 5000+ Reviews" (数据驱动)
- "Worried About Fakes? 100% Authentic Guarantee" (问答式)
```

---

### Bucket B (场景+功能导向) - 最大改进

**优化前**:
```
- "Smart Watch Hiking GPS Tracker Waterproof"
- "Fitness Tracker Swimming Heart Rate Monitor"
- "Watch Elderly Health Monitoring Fall Detection"
```

**优化后**:
```
- "Smart Watch Hiking GPS Tracker Waterproof" (关键词密集)
- "Perfect for Hiking: 3-Day Battery + GPS Tracking" (场景化)
- "Worried About Getting Lost? Built-in GPS + Offline Maps" (问答式)
- "72-Hour Battery Life - Tested by 200+ Hikers" (数据驱动)
```

---

### Bucket D (转化/价值导向)

**优化前**:
```
- "Smart Watch Sale Fitness Tracker Discount"
- "Buy Smart Watch Best Price Free Shipping"
- "Smart Watch Deal GPS Heart Rate Monitor"
```

**优化后**:
```
- "Smart Watch Sale Fitness Tracker Discount" (关键词密集)
- "Save $50 Today - Limited Time Offer" (促销/CTA)
- "4.8★ Rating - 10,000+ Verified Buyers" (数据驱动)
- "Why Pay More? Same Features, Half the Price" (问答式)
```

---

## 监控指标

### 创意生成日志

查看console log中的关键信息：

```
[Prompt] 🎯 注入场景数据: 5个场景
[Prompt] 🎯 注入用户问题: 8个问题
[Prompt] 🎯 注入痛点数据: 3个痛点
[Prompt] 🎯 注入量化数据: 4个数据点
[Prompt] 🎯 应用Bucket B的intent策略
[buildPrompt] 🎯 Intent-driven策略已注入
```

### 数据库查询

```sql
-- 统计有场景数据的offer数量
SELECT
  COUNT(*) as total_offers,
  SUM(CASE WHEN user_scenarios IS NOT NULL THEN 1 ELSE 0 END) as offers_with_scenarios,
  SUM(CASE WHEN user_questions IS NOT NULL THEN 1 ELSE 0 END) as offers_with_questions
FROM offers
WHERE deleted_at IS NULL;

-- 查看最近提取的场景
SELECT
  id,
  brand,
  json_extract(user_scenarios, '$[0].scenario') as first_scenario,
  json_array_length(user_scenarios) as scenario_count,
  scenario_analyzed_at
FROM offers
WHERE user_scenarios IS NOT NULL
ORDER BY scenario_analyzed_at DESC
LIMIT 10;
```

---

## 已知限制

1. **需要评论数据**: 只有包含 `review_analysis` 的offer才能享受intent优化
2. **评论质量依赖**: 如果评论质量差（没有明确场景描述），提取的场景可能不够丰富
3. **语言支持**: 当前的 `convertPainPointToQuestion()` 函数主要针对英文，中文支持有限
4. **AI生成质量**: 最终创意质量仍依赖AI模型的理解和生成能力

---

## 下一步工作（可选）

### Phase 3: Intent Analysis Dashboard

**文件**:
- `/src/app/api/dashboard/intent-insights/route.ts` (新建)
- `/src/components/dashboard/IntentInsightsCard.tsx` (新建)
- `/src/app/(app)/dashboard/page.tsx` (修改)

**功能**:
- 分析搜索词背后的用户意图
- 识别场景覆盖缺口
- 提供优化建议

**优先级**: P1 (可以在验证Phase 1-2效果后再实施)

---

## 回滚方案

如果需要回滚到v4.48（纯关键词模式）：

1. **不运行数据库迁移**: 新字段不存在，代码会自动降级
2. **或者注释掉场景提取代码**:
   ```typescript
   // 在 offer-extraction-executor.ts 中注释掉这段:
   // if (aiAnalysisResult?.reviewAnalysis) {
   //   const extractedScenarios = extractScenariosFromReviews(...)
   //   ...
   // }
   ```
3. **或者在prompt builder中跳过intent sections**:
   ```typescript
   // 在 creative-prompt-builder.ts 中注释掉:
   // if (variables.intent_strategy_section) {
   //   prompt += '\n' + variables.intent_strategy_section
   // }
   ```

---

## 文档

- **影响评估**: `/INTENT_OPTIMIZATION_BUCKET_IMPACT.md`
- **实现总结**: 本文档

---

## 联系

如有问题或需要调整，请联系开发团队。
