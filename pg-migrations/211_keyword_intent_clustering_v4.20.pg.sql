-- Migration: 211_keyword_intent_clustering_v4.20.pg.sql
-- Description: keyword_intent_clustering v4.20 - Canonical creative alignment
-- Date: 2026-03-17
-- Database: PostgreSQL

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = FALSE
WHERE prompt_id = 'keyword_intent_clustering' AND is_active = TRUE;

-- 2) 基于 v4.19 生成 v4.20（幂等）
INSERT INTO prompt_versions (
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
SELECT
  'keyword_intent_clustering',
  'v4.20',
  base.category,
  '关键词意图聚类v4.20 - Canonical Creative Alignment',
  '在 v4.19 的稳定输出基础上，补充 raw bucket 与 canonical creative type 的对齐规则，避免旧桶语义直接污染 brand_intent / model_intent / product_intent。',
  'prompts/keyword_intent_clustering_v4.20.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        base.prompt_content,
        $$店铺链接分桶策略 (Store Page) - v4.19 输出稳定版$$,
        $$店铺链接分桶策略 (Store Page) - v4.20 Canonical Intent版$$
      ),
      $$## 🔥 v4.19 核心原则：精准分配 + 明确排除 + 输出稳定$$,
      $$## 🔥 v4.20 核心原则：raw bucket兼容 + canonical创意语义对齐 + 输出稳定$$
    ),
    $$注意事项：
1. 仅返回一个完整JSON对象；禁止markdown、解释、分析、额外文本
2. 所有原始关键词必须出现且仅出现一次（跨桶不得重复）
3. 禁止输出输入列表之外的新关键词
4. description字段使用短语（中文不超过12字，英文不超过8词）
5. 若无法判断归类，放入桶S，不要输出解释
6. balanceScore = 1 - (max差异 / 总数)
7. 🔥 严格遵循排除规则和优先级！不要将促销词分到桶A，不要将型号词分到桶B
8. 输出必须以最外层 } 结束$$,
    $$注意事项：
1. 仅返回一个完整JSON对象；禁止markdown、解释、分析、额外文本
2. 所有原始关键词必须出现且仅出现一次（跨桶不得重复）
3. 禁止输出输入列表之外的新关键词
4. description字段使用短语（中文不超过12字，英文不超过8词）
5. 若无法判断归类，放入桶S，不要输出解释
6. balanceScore = 1 - (max差异 / 总数)
7. raw buckets 仅用于聚类兼容，不代表最终创意类型；最终创意只允许 brand_intent、model_intent、product_intent 三类
8. 桶A必须优先保留品牌加商品或品类锚点，不能被纯品牌导航词或纯店铺信任词主导
9. 桶B和桶C必须优先保留可验证型号、系列、热门商品线等强锚点；不要把明确型号词丢进桶D或桶S
10. 桶D和桶S必须优先覆盖品牌关联的商品需求、功能、场景、产品线词；纯促销词、纯评测词、纯信息查询词不得成为主分配结果
11. 店铺页桶C优先承载热门商品线或热门型号集合，不能退化成泛店铺信任词
12. 输出必须以最外层 } 结束$$
  ),
  base.language,
  base.created_by,
  TRUE,
  $$v4.20:
1. 在 v4.19 的稳定输出约束上，新增 raw bucket 与 canonical creative type 的对齐规则
2. 明确 A 侧重品牌加商品锚点，B/C 侧重型号系列与热门商品线，D/S 侧重商品需求覆盖
3. 明确禁止纯导航、纯信任、纯促销、纯评测、纯信息查询词主导最终聚类结果
4. 目标：让关键词聚类继续兼容旧桶输出，同时服务 brand_intent / model_intent / product_intent 三类创意
$$,
  '2026-03-17 01:10:00'
FROM prompt_versions base
WHERE base.prompt_id = 'keyword_intent_clustering' AND base.version = 'v4.19'
ON CONFLICT (prompt_id, version)
DO UPDATE SET
  category = EXCLUDED.category,
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  file_path = EXCLUDED.file_path,
  function_name = EXCLUDED.function_name,
  prompt_content = EXCLUDED.prompt_content,
  language = EXCLUDED.language,
  created_by = EXCLUDED.created_by,
  is_active = EXCLUDED.is_active,
  change_notes = EXCLUDED.change_notes,
  created_at = EXCLUDED.created_at;

-- 3) 确保新版本激活
UPDATE prompt_versions
SET is_active = TRUE
WHERE prompt_id = 'keyword_intent_clustering' AND version = 'v4.20';
