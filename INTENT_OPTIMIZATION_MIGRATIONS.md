# Intent-Driven Optimization - 迁移文件说明

## 数据库迁移文件（SQLite + PostgreSQL）

### 205: 添加Intent字段到offers表

**SQLite**: `/migrations/205_add_intent_fields.sql`
**PostgreSQL**: `/pg-migrations/205_add_intent_fields.sql`

添加4个新字段到 `offers` 表：
- `user_scenarios` (TEXT): JSON数组，存储从评论提取的场景
- `pain_points` (TEXT): JSON数组，存储用户痛点
- `user_questions` (TEXT): JSON数组，存储用户常问问题
- `scenario_analyzed_at` (TEXT/TIMESTAMP): 场景分析时间戳

**差异**:
- PostgreSQL使用 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (幂等)
- PostgreSQL的 `scenario_analyzed_at` 使用 `TIMESTAMP` 类型
- SQLite的 `scenario_analyzed_at` 使用 `TEXT` 类型

---

### 206: 创建search_term_intent_analysis表

**SQLite**: `/migrations/206_create_intent_analysis.sql`
**PostgreSQL**: `/pg-migrations/206_create_intent_analysis.sql`

创建新表用于存储搜索词意图分析（Phase 3 Dashboard功能）。

**差异**:
- PostgreSQL使用 `SERIAL PRIMARY KEY` (自增主键)
- SQLite使用 `INTEGER PRIMARY KEY AUTOINCREMENT`
- PostgreSQL的 `analyzed_at` 使用 `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- SQLite的 `analyzed_at` 使用 `TEXT DEFAULT (datetime('now'))`

---

### 207: Prompt版本v5.0

**SQLite**: `/migrations/207_ad_creative_generation_v5.0.sql`
**PostgreSQL**: `/pg-migrations/207_ad_creative_generation_v5.0.sql`

更新 `prompt_versions` 表，添加v5.0版本记录。

**重要说明**:
- v5.0采用**动态注入策略**，不直接修改prompt_content
- Intent sections通过代码在运行时注入（见 `creative-orchestrator.ts`）
- 本迁移仅记录版本变更，实际prompt内容保持v4.48基础

**差异**:
- PostgreSQL使用 `ON CONFLICT ... DO UPDATE` (upsert)
- SQLite使用 `INSERT OR REPLACE`
- PostgreSQL的 `is_active` 使用 `boolean` 类型
- SQLite的 `is_active` 使用 `INTEGER` (0/1)

---

## 运行迁移

### SQLite (本地开发)

```bash
npm run db:migrate
```

### PostgreSQL (生产环境)

```bash
DATABASE_URL="postgresql://user:pass@host:5432/dbname" npm run db:migrate
```

---

## 验证迁移

### 检查offers表新字段

```sql
-- SQLite
PRAGMA table_info(offers);

-- PostgreSQL
\d offers
```

应该看到4个新字段：
- user_scenarios
- pain_points
- user_questions
- scenario_analyzed_at

### 检查search_term_intent_analysis表

```sql
-- SQLite
SELECT name FROM sqlite_master WHERE type='table' AND name='search_term_intent_analysis';

-- PostgreSQL
\dt search_term_intent_analysis
```

### 检查prompt版本

```sql
SELECT version, name, is_active, created_at
FROM prompt_versions
WHERE prompt_id = 'ad_creative_generation'
ORDER BY created_at DESC
LIMIT 5;
```

应该看到v5.0版本，且 `is_active = 1` (SQLite) 或 `is_active = true` (PostgreSQL)。

---

## 回滚方案

如果需要回滚：

### 回滚到v4.48 prompt

```sql
-- 停用v5.0
UPDATE prompt_versions
SET is_active = 0  -- PostgreSQL: false
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.0';

-- 激活v4.48
UPDATE prompt_versions
SET is_active = 1  -- PostgreSQL: true
WHERE prompt_id = 'ad_creative_generation' AND version = 'v4.48';
```

### 删除intent字段（不推荐）

```sql
-- SQLite不支持DROP COLUMN，需要重建表
-- PostgreSQL:
ALTER TABLE offers DROP COLUMN IF EXISTS user_scenarios;
ALTER TABLE offers DROP COLUMN IF EXISTS pain_points;
ALTER TABLE offers DROP COLUMN IF EXISTS user_questions;
ALTER TABLE offers DROP COLUMN IF EXISTS scenario_analyzed_at;
```

### 删除intent分析表

```sql
DROP TABLE IF EXISTS search_term_intent_analysis;
```

---

## 注意事项

1. **迁移顺序**: 必须按205 → 206 → 207的顺序执行
2. **幂等性**: 所有迁移都是幂等的，可以安全重复执行
3. **向后兼容**: 新字段允许NULL，不影响现有数据
4. **降级策略**: 代码会自动检测字段是否存在，无数据时自动降级到v4.48模式

---

## 相关文档

- **影响评估**: `/INTENT_OPTIMIZATION_BUCKET_IMPACT.md`
- **实施文档**: `/INTENT_OPTIMIZATION_IMPLEMENTATION.md`
- **迁移规范**: `/migrations/README.md`
