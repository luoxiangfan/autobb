-- Migration: 218_ad_creative_generation_v5.4.sql
-- Description: ad_creative_generation v5.4 - competitive positioning signals hardening
-- Date: 2026-03-26
-- Database: SQLite

-- 1) 取消当前激活版本
UPDATE prompt_versions
SET is_active = 0
WHERE prompt_id = 'ad_creative_generation' AND is_active = 1;

-- 2) 基于 v5.3 生成 v5.4（幂等）
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
SELECT
  (SELECT id FROM prompt_versions WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.4'),
  'ad_creative_generation',
  'v5.4',
  base.category,
  '广告创意生成v5.4 - Competitive Positioning Signals',
  '新增竞争定位强化规则，要求输出价格优势/价值表达/对比表达，提升 Ad Strength 竞争定位维度稳定性。',
  'prompts/ad_creative_generation_v5.4.txt',
  base.function_name,
  REPLACE(
    REPLACE(
      REPLACE(
        REPLACE(
          base.prompt_content,
          '-- Google Ads 广告创意生成 v5.3',
          '-- Google Ads 广告创意生成 v5.4'
        ),
        '-- v5.3: Headline #1-#4 保护不动，retained keyword headlines 后移到 #5-#9，并要求与前4条保持多样性；低质量/无语义关键词不得强制落位',
        REPLACE(
          '-- v5.3: Headline #1-#4 保护不动，retained keyword headlines 后移到 #5-#9，并要求与前4条保持多样性；低质量/无语义关键词不得强制落位\n-- v5.4: 新增竞争定位强化规则，要求输出价格优势/价值表达/对比表达，提升 Ad Strength 竞争定位维度',
          '\n',
          char(10)
        )
      ),
      '- EXTRACTED 元素仅用于措辞参考，不得引入任何数字/承诺/限时/库存信息',
      '- EXTRACTED 元素仅用于措辞参考，不得引入任何数字/承诺/限时/库存信息

## 🎯 Ad Strength 竞争定位强化（CRITICAL）
目标：在不违反 Evidence-Only 的前提下，提升 Competitive Positioning 维度（priceAdvantage / competitiveComparison / valueEmphasis）。

**资产覆盖要求（至少满足 3 条）**：
1) 价格优势表达（至少 1 条 headline/description）：
- 若 VERIFIED FACTS/PROMOTION 提供金额、折扣、免运费、免安装、免月费等证据，必须写成可识别价格优势表达（如 `Save $X` / `X% Off` / `No Monthly Fees` / `Free Shipping`）
- 若无价格证据，禁止编造数字；允许使用非量化价格感知词（如 `affordable` / `budget-friendly`，或目标语言等价词）

2) 价值表达（至少 1 条 headline/description）：
- 必须出现明确价值词（如 `Great Value` / `Best Value` / `Value for Money` / `Worth It`，或目标语言等价词）
- 价值表达必须绑定真实卖点（性能、材质、覆盖范围、认证、静音、耐用等）

3) 对比表达（至少 1 条 headline/description）：
- 必须出现对比/替换语义词（如 `better` / `upgrade` / `switch to` / `replace`，或目标语言等价词）
- 禁止点名竞品品牌；仅允许基于已验证特性做温和对比，不得夸大

4) 推荐落位：
- 优先在 `Headline #5-#9` 与 `Description #1-#2` 完成以上覆盖，避免挤占 `Headline #1-#4` 保护槽位'
    ),
    '### 桶D（转化/价值）
- 优先突出可验证的优惠/价值点 + 强行动号召
- 若无证据，不写折扣/限时/数字，只写“价值/省心/替代方案”类表述',
    '### 桶D（转化/价值）
- 优先突出可验证的优惠/价值点 + 强行动号召
- 若无证据，不写折扣/限时/数字，只写“价值/省心/替代方案”类表述
- 至少 1 条资产要有“价格优势/价值词”，至少 1 条资产要有“better/replace/switch”等对比语义（可验证前提下优先量化）'
  ),
  base.language,
  base.created_by,
  1,
  REPLACE('v5.4 - Competitive Positioning Signals:
1. 新增竞争定位强化段落，要求覆盖价格优势、价值表达、对比表达
2. 价格表达继续遵守 Evidence-Only，禁止无证据编造金额/折扣
3. 桶D 增加硬约束：至少1条价值词 + 1条对比语义资产
4. 与 retained keyword slot contract 协同：优先落位 Headline #5-#9 与 Description #1-#2
', '\n', char(10)),
  '2026-03-26 14:30:00'
FROM prompt_versions base
WHERE base.prompt_id = 'ad_creative_generation' AND base.version = 'v5.3';

-- 3) 确保最终版本激活
UPDATE prompt_versions
SET is_active = 1
WHERE prompt_id = 'ad_creative_generation' AND version = 'v5.4';
