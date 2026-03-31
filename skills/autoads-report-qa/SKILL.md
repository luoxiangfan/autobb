---
name: autoads-report-qa
description: 基于 AutoAds 日报和策略状态进行问答、归因与行动建议。适用于“解释今天ROAS变化”“为什么发布失败”“该怎么调预算/出价/素材”这类报表解读场景。优先读取 `/api/openclaw/reports/daily`、`/api/openclaw/strategy/status`、`/api/openclaw/commands/runs`，输出结论+证据+下一步。
---

# AutoAds Report QA

面向报表问答，固定执行三步：

1. 拉取数据
2. 结构化归因
3. 生成可执行建议

## 数据读取顺序

1. `/api/openclaw/reports/daily?date=YYYY-MM-DD`
2. `/api/openclaw/strategy/status`
3. 直连 `/api/openclaw/commands/runs?limit=20&channel=feishu&senderId=<sender_open_id>`（可选 `accountId/tenantKey`）

如果用户没指定日期，默认当天（网关时区）。

## 输出格式

每次回答都按以下结构输出：

- `结论`：一句话回答问题。
- `关键指标`：最多 5 条（ROAS、ROI、花费、转化、发布成功/失败）。
- `根因判断`：分成“数据证据”和“推断”。
- `行动建议`：仅 3 条，按优先级排序，需可执行。
- `风险提示`：若建议涉及高风险写操作，明确提示将触发确认流。

## 归因规则（最小集）

- 若 `publishFailureRate` 上升且 `topPublishFailureReasons` 非空：优先归因为发布链路问题。
- 若花费升高但转化不升：优先建议降预算/降CPC并收敛关键词。
- 若 ROAS 连续低于目标：进入防守策略（缩量 + 小步测试）。
- 若策略 `guardLevel` 为 `strong`：禁止给出放量建议。

## 回答边界

- 不编造缺失数据。
- 数据不足时明确说“样本不足”，并给“补数动作”。
- 不直接执行写操作，除非用户明确要求执行。

## 示例问题

- “今天 ROAS 为什么掉了？”
- “昨天发布失败的主要原因是什么？”
- “明天预算和 maxCpc 应该怎么调？”
