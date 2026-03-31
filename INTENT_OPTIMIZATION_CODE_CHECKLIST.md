# Intent-Driven Optimization - 代码落地检查清单

## ✅ 已完成的代码修改

### 1. 数据库迁移文件 ✅

**SQLite**:
- ✅ `/migrations/205_add_intent_fields.sql` (811B)
- ✅ `/migrations/206_create_intent_analysis.sql` (1.3KB)
- ✅ `/migrations/207_ad_creative_generation_v5.0.sql` (2.7KB)

**PostgreSQL**:
- ✅ `/pg-migrations/205_add_intent_fields.sql` (872B)
- ✅ `/pg-migrations/206_create_intent_analysis.sql` (1.3KB)
- ✅ `/pg-migrations/207_ad_creative_generation_v5.0.sql` (2.8KB)

**验证**: 所有迁移文件已创建，支持SQLite和PostgreSQL双数据库

---

### 2. TypeScript类型定义 ✅

**文件**: `/src/lib/offers.ts`

**修改内容**:
```typescript
// Intent-driven optimization: 从review_analysis自动提取的场景数据
user_scenarios: string | null  // JSON: [{scenario, frequency, keywords, source}]
pain_points: string | null     // JSON: [string]
user_questions: string | null  // JSON: [{question, priority, category}]
scenario_analyzed_at: string | null
```

**验证**: ✅ 已添加4个新字段到Offer接口

---

**文件**: `/src/lib/creative-splitted/creative-types.ts`

**修改内容**:
```typescript
export interface PromptVariables {
  // ... 现有字段
  // 🎯 Intent-driven optimization fields
  user_scenarios_section?: string
  user_questions_section?: string
  pain_points_section?: string
  quantitative_highlights_section?: string
  intent_strategy_section?: string
}
```

**验证**: ✅ 已添加5个intent相关字段到PromptVariables接口

---

### 3. 场景提取逻辑 ✅

**文件**: `/src/lib/scenario-extractor.ts` (新建, 5.4KB)

**核心函数**:
- ✅ `extractScenariosFromReviews()`: 从review_analysis提取场景
- ✅ `extractKeywordsFromScenario()`: 从场景文本提取关键词
- ✅ `convertPainPointToQuestion()`: 将痛点转换为用户问题

**接口定义**:
- ✅ `ExtractedScenario`
- ✅ `ExtractedUserQuestion`
- ✅ `ExtractedScenarios`

**降级策略**: ✅ 如果review_analysis为null，返回空数组（不报错）

**验证**: ✅ 文件已创建，TypeScript编译无错误

---

### 4. 集成到Offer创建流程 ✅

**文件**: `/src/lib/queue/executors/offer-extraction-executor.ts`

**修改位置**: 第21行（import）+ 第647行（调用）

**修改内容**:
```typescript
// 导入
import { extractScenariosFromReviews } from '@/lib/scenario-extractor'

// 在保存review_analysis后调用
if (aiAnalysisResult?.reviewAnalysis) {
  try {
    const reviewAnalysisJson = JSON.stringify(aiAnalysisResult.reviewAnalysis)
    const extractedScenarios = extractScenariosFromReviews(reviewAnalysisJson)

    if (extractedScenarios.scenarios.length > 0 ||
        extractedScenarios.painPoints.length > 0 ||
        extractedScenarios.userQuestions.length > 0) {
      await updateOffer(createdOfferId, task.user_id, {
        user_scenarios: JSON.stringify(extractedScenarios.scenarios),
        pain_points: JSON.stringify(extractedScenarios.painPoints),
        user_questions: JSON.stringify(extractedScenarios.userQuestions),
        scenario_analyzed_at: new Date().toISOString()
      })
      console.log(`✅ 场景数据已提取: offer_id=${createdOfferId}`)
    }
  } catch (scenarioError: any) {
    console.error(`⚠️ 场景提取失败（非致命）: ${scenarioError.message}`)
  }
}
```

**验证**: ✅ 已集成，非致命错误处理

---

### 5. 创意生成Prompt优化 ✅

#### 5.1 buildPromptVariables() - 注入场景数据

**文件**: `/src/lib/creative-splitted/creative-orchestrator.ts`

**修改位置**: 第250-305行

**功能**:
- ✅ 解析 `offer.user_scenarios`, `offer.pain_points`, `offer.user_questions`
- ✅ 解析 `offer.review_analysis.quantitativeHighlights`
- ✅ 构建4个section: scenarios, questions, pain_points, quantitative_highlights
- ✅ 调用 `buildIntentStrategySection()` 生成策略指导
- ✅ 降级处理: try-catch包裹，失败时继续使用纯关键词模式

**验证**: ✅ 代码已添加，逻辑完整

---

#### 5.2 buildIntentStrategySection() - 按bucket生成策略

**文件**: `/src/lib/creative-splitted/creative-orchestrator.ts`

**修改位置**: 第116-191行

**功能**:
- ✅ 定义A/B/D三个bucket的策略配置
  - Bucket A: 40% keyword + 60% intent (信任证据、数据驱动)
  - Bucket B: 30% keyword + 70% intent (场景化、问答式)
  - Bucket D: 40% keyword + 60% intent (价值点、数据驱动)
- ✅ 生成详细的策略指导prompt
- ✅ 包含数据可用性统计
- ✅ 包含Google Ads合规要求

**验证**: ✅ 函数已实现，策略配置正确

---

#### 5.3 buildPrompt() - 注入intent sections到prompt

**文件**: `/src/lib/creative-splitted/creative-prompt-builder.ts`

**修改位置**: 第95-110行

**功能**:
```typescript
// 🎯 Intent-driven optimization: 注入场景数据sections
if (variables.user_scenarios_section) {
  prompt += '\n' + variables.user_scenarios_section
}
if (variables.user_questions_section) {
  prompt += '\n' + variables.user_questions_section
}
if (variables.pain_points_section) {
  prompt += '\n' + variables.pain_points_section
}
if (variables.quantitative_highlights_section) {
  prompt += '\n' + variables.quantitative_highlights_section
}
if (variables.intent_strategy_section) {
  prompt += '\n' + variables.intent_strategy_section
  console.log('[buildPrompt] 🎯 Intent-driven策略已注入')
}
```

**验证**: ✅ 已添加，按顺序注入所有intent sections

---

## 代码完整性验证

### TypeScript编译检查

```bash
npx tsc --noEmit --skipLibCheck src/lib/scenario-extractor.ts
# 结果: ✅ 无编译错误
```

### 关键函数存在性检查

```bash
# buildIntentStrategySection
grep -n "buildIntentStrategySection" src/lib/creative-splitted/creative-orchestrator.ts
# 结果: ✅ 第116行定义，第300行调用

# extractScenariosFromReviews
grep -n "extractScenariosFromReviews" src/lib/queue/executors/offer-extraction-executor.ts
# 结果: ✅ 第21行导入，第647行调用

# intent sections注入
grep -n "user_scenarios_section\|intent_strategy_section" src/lib/creative-splitted/creative-prompt-builder.ts
# 结果: ✅ 第97-110行注入逻辑
```

---

## 数据流验证

### 完整数据流

```
1. Offer创建
   ↓
2. 抓取评论 → 生成review_analysis
   ↓ (offer-extraction-executor.ts:647)
3. extractScenariosFromReviews(review_analysis)
   ↓ (scenario-extractor.ts:49)
4. 保存到数据库 (user_scenarios, pain_points, user_questions)
   ↓
5. 创意生成时读取这些字段
   ↓ (creative-orchestrator.ts:251-253)
6. 构建intent sections
   ↓ (creative-orchestrator.ts:267-295)
7. 生成bucket策略section
   ↓ (creative-orchestrator.ts:116-191)
8. 注入到AI prompt
   ↓ (creative-prompt-builder.ts:97-110)
9. AI生成平衡型创意 (keyword + intent)
```

**验证**: ✅ 数据流完整，每个环节都已实现

---

## 降级策略验证

### 场景1: 无review_analysis

```typescript
// scenario-extractor.ts:51-57
if (!reviewAnalysisJson) {
  return {
    scenarios: [],
    painPoints: [],
    userQuestions: []
  }
}
```

**验证**: ✅ 返回空数组，不报错

---

### 场景2: 解析失败

```typescript
// scenario-extractor.ts:115-122
} catch (error) {
  console.error('Failed to parse review_analysis:', error)
  return {
    scenarios: [],
    painPoints: [],
    userQuestions: []
  }
}
```

**验证**: ✅ 捕获异常，返回空数组

---

### 场景3: 场景提取失败

```typescript
// offer-extraction-executor.ts:665-668
} catch (scenarioError: any) {
  console.error(`⚠️ 场景提取失败（非致命）: ${scenarioError.message}`)
  // Non-fatal: continue without scenario data
}
```

**验证**: ✅ 非致命错误，不中断offer创建

---

### 场景4: 无场景数据时的prompt

```typescript
// creative-orchestrator.ts:299-302
if (bucket && (scenarios.length > 0 || userQuestions.length > 0 || quantitativeHighlights.length > 0)) {
  variables.intent_strategy_section = buildIntentStrategySection(...)
}
```

**验证**: ✅ 无数据时不生成intent_strategy_section，AI使用纯关键词模式

---

## 待执行的步骤

### 1. 运行数据库迁移

```bash
# SQLite (本地开发)
npm run db:migrate

# PostgreSQL (生产环境)
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

### 2. 重启应用

```bash
# 重启开发服务器以加载新代码
npm run dev
```

### 3. 测试验证

参考 `/INTENT_OPTIMIZATION_IMPLEMENTATION.md` 中的测试步骤。

---

## 总结

### ✅ 代码层面已完全落地

1. ✅ **数据库迁移**: 6个文件（SQLite + PostgreSQL）
2. ✅ **TypeScript类型**: 2个接口更新
3. ✅ **场景提取**: 1个新文件，3个核心函数
4. ✅ **Offer创建集成**: 1个文件修改，自动提取场景
5. ✅ **创意生成优化**: 3个文件修改，完整的intent注入逻辑
6. ✅ **降级策略**: 4层降级保护，向后兼容

### 🎯 核心特性

- **自动化**: 无需用户手动输入场景，从评论自动提取
- **平衡策略**: A/B/D三个bucket各有不同的keyword/intent比例
- **降级友好**: 无数据时自动回退到v4.48纯关键词模式
- **非破坏性**: 所有修改都是增量的，不影响现有功能

### 📊 代码统计

- **新增文件**: 4个（scenario-extractor.ts + 3个文档）
- **修改文件**: 5个（offers.ts, creative-types.ts, creative-orchestrator.ts, creative-prompt-builder.ts, offer-extraction-executor.ts）
- **迁移文件**: 6个（SQLite 3个 + PostgreSQL 3个）
- **总代码行数**: ~500行新增代码

**下一步**: 运行数据库迁移，然后开始测试！
