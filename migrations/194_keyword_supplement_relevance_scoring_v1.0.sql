-- Migration: 194_keyword_supplement_relevance_scoring_v1.0.sql
-- Description: 新增补词相关性打分独立 Prompt v1.0
-- Date: 2026-02-27
-- Database: SQLite

-- 1) 取消当前激活版本（同 prompt_id 仅允许一个 active）
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'keyword_supplement_relevance_scoring' AND is_active = 1;

-- 2) 幂等写入 v1.0
INSERT OR REPLACE INTO prompt_versions (
  id,
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
)
VALUES (
  (SELECT id FROM prompt_versions WHERE prompt_id = 'keyword_supplement_relevance_scoring' AND version = 'v1.0'),
  'keyword_supplement_relevance_scoring',
  'v1.0',
  '关键词生成',
  '补词相关性打分v1.0',
  '用于广告创意补词场景，对候选关键词进行相关性评分与保留判定（JSON结构化输出）',
  'prompts/keyword_supplement_relevance_scoring_v1.0.txt',
  'rankSupplementCandidatesWithModel',
  replace('You are a strict SEO keyword relevance scorer for paid search.
Task: score candidate supplemental keywords for product ads.

Source: {{source}}
Brand: {{brandName}}
Target language: {{targetLanguage}}

Product title:
{{titleLine}}

About this item:
{{aboutBlock}}

Existing high-confidence keywords:
{{existingLines}}

Candidate keywords to score:
{{candidateLines}}

Scoring rules (0-100):
- Keep only query-like keywords clearly related to product category, product function, usage scenario, material, model, or spec.
- Reject generic slogans or vague claims (for example: easy clean, wide use).
- Reject terms detached from title/about or existing keyword context.
- Prefer phrases that users are likely to type in search.
- Keep wording concise and natural, avoid full-sentence claims.

Output JSON only with this structure:
{ "assessments": [ { "candidate": "...", "score": 0-100, "keep": true|false, "reason": "..." } ] }

Output requirements:
1. Include every candidate exactly once.
2. Keep candidate text unchanged.
3. Score and keep must be logically consistent.
4. No markdown, no extra fields.
', '
', char(10)),
  'English',
  NULL,
  1,
  replace('v1.0:
1. 新增独立补词相关性打分Prompt（prompt_id: keyword_supplement_relevance_scoring）
2. 用于补词场景候选关键词打分，输出结构化 assessments JSON
3. Prompt分类复用中文分类：关键词生成
4. 配合补词流程实现数据库Prompt版本化管理，可热更新
', '
', char(10)),
  '2026-02-27 10:00:00'
);

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'keyword_supplement_relevance_scoring' AND version = 'v1.0';
