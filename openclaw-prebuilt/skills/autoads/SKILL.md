---
name: autoads
description: 通过 AutoAds OpenClaw API 执行广告运营动作（严格按 Web action matrix 调用，禁止猜测端点或字段）。
---

# AutoAds（Canonical + Web Matrix）

先读取 `references/web-actions.md`，并仅从该矩阵选择动作。

## 必须遵守

1. 写操作（`POST`/`PUT`/`PATCH`/`DELETE`）只走 `/api/openclaw/commands/execute`。
2. 业务读操作（`GET /api/*`）只走 `/api/openclaw/proxy`。
3. OpenClaw 控制面读操作（`GET /api/openclaw/commands/runs`）必须直连，不能走 proxy。
4. 只能使用 `references/web-actions.md` 中存在的 `method + path + body keys`。
5. 禁止猜测路由、字段、query 名；若缺关键参数，先向用户补齐或先做读操作确认。
6. 若响应出现 `canonical web flow` 或 `410`，表示路径错误/已下线，必须回到矩阵路径。
7. 同容器部署时业务 API 只走内网：`INTERNAL_APP_URL` 或 `http://127.0.0.1:${PORT:-3000}`。
8. `127.0.0.1:18789` 是 OpenClaw Gateway，不是 AutoAds 业务 API。
9. 禁止使用 Node.js 自行拼接 HTTP 调用；统一使用本文件的 `curl` 模板。
10. 禁止输出或探测 token 长度/前缀（例如 `echo ${#TOKEN}`）；不要在回复中暴露任何密钥信息。

## 认证与上下文

- `/api/openclaw/*` 统一使用 `Authorization: Bearer <token>`。
- 飞书场景默认使用 `OPENCLAW_GATEWAY_TOKEN`，并透传：`channel`, `senderId`，可选 `accountId`, `tenantKey`。
- 禁止向用户索要业务 API token。
- token 解析顺序固定：`OPENCLAW_GATEWAY_TOKEN` -> `OPENCLAW_TOKEN`。若仍为空，直接停止并提示“网关注入缺失”，不要继续猜测或重试。
- `commands/execute` 返回的 `taskId` 是 OpenClaw 命令队列 taskId，不是业务 taskId。不得把它用于 `/api/offers/extract/status/:taskId` 或 `/api/creative-tasks/:taskId`。

## 决策顺序

1. 将用户需求映射为一个或多个 `action_id`（来源于 `references/web-actions.md`）。
2. 逐个执行动作，写请求必须带：`intent`、`idempotencyKey`、用户上下文字段。
3. 若返回 `pending_confirm`，调用 `/api/openclaw/commands/confirm` 完成确认。
4. 需要追踪时，直连 `/api/openclaw/commands/runs` 并带 `channel/senderId`。
5. 写动作后先跟踪 `runId` 到 `completed/failed`。若 `runs.items[].responsePreview.taskId` 存在，该值才是业务 taskId，可用于业务状态接口。
6. 若拿不到业务 taskId，再用业务读接口核验实体状态（如 Offer 是否出现、创意列表是否新增），不要用 OpenClaw `taskId` 轮询业务任务接口。
7. 对 Offer/Creative 长耗时任务：优先使用 stream 接口；无法 stream 时，状态轮询必须带 `waitForUpdate=1`、`lastUpdatedAt=<上次updatedAt>`、`timeoutMs=30000`，并将轮询间隔严格控制在 2-8 秒（先参考 `recommendedPollIntervalMs` 再钳制）。

## 请求模板

### 初始化（不要单独执行 `export`）

> 某些执行器会把 `export ...` 当成可执行文件，导致 `Exec: export ... failed`。以下 `curl` 模板已内置 host/token fallback，不需要再单独执行初始化导出命令。

### 读（proxy）

```bash
curl -sS "${AUTOADS_HOST:-${INTERNAL_APP_URL:-http://127.0.0.1:${PORT:-3000}}}/api/openclaw/proxy" \
  -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN:-${OPENCLAW_TOKEN:-${OPENCLAW_AUTH_TOKEN:-}}}" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "GET",
    "path": "/api/offers",
    "channel": "feishu",
    "senderId": "<sender_open_id>",
    "accountId": "<account_id>",
    "tenantKey": "<tenant_key>"
  }'
```

> 注意：`<sender_open_id>/<account_id>/<tenant_key>` 必须替换为当前会话真实值；占位符原样提交会导致 401 或绑定失败。

### 写（execute）

```bash
curl -sS "${AUTOADS_HOST:-${INTERNAL_APP_URL:-http://127.0.0.1:${PORT:-3000}}}/api/openclaw/commands/execute" \
  -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN:-${OPENCLAW_TOKEN:-${OPENCLAW_AUTH_TOKEN:-}}}" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "path": "/api/offers/extract",
    "intent": "offer.create",
    "idempotencyKey": "offer-extract-<unique>",
    "channel": "feishu",
    "senderId": "<sender_open_id>",
    "accountId": "<account_id>",
    "tenantKey": "<tenant_key>",
    "body": {
      "affiliate_link": "https://example.com/aff-link",
      "target_country": "US"
    }
  }'
```

### 确认（confirm）

```bash
curl -sS "${AUTOADS_HOST:-${INTERNAL_APP_URL:-http://127.0.0.1:${PORT:-3000}}}/api/openclaw/commands/confirm" \
  -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN:-${OPENCLAW_TOKEN:-${OPENCLAW_AUTH_TOKEN:-}}}" \
  -H "Content-Type: application/json" \
  -d '{
    "runId": "<RUN_ID>",
    "confirmToken": "<CONFIRM_TOKEN>",
    "decision": "confirm",
    "channel": "feishu",
    "senderId": "<sender_open_id>",
    "accountId": "<account_id>",
    "tenantKey": "<tenant_key>"
  }'
```

### 记录查询（runs，直连）

```bash
curl -sS -G "${AUTOADS_HOST:-${INTERNAL_APP_URL:-http://127.0.0.1:${PORT:-3000}}}/api/openclaw/commands/runs" \
  -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN:-${OPENCLAW_TOKEN:-${OPENCLAW_AUTH_TOKEN:-}}}" \
  --data-urlencode "channel=feishu" \
  --data-urlencode "senderId=<sender_open_id>" \
  --data-urlencode "accountId=<account_id>" \
  --data-urlencode "tenantKey=<tenant_key>" \
  --data-urlencode "limit=20"
```

## 失败处理

- `400`: 字段不合法或缺失；只按矩阵修正，不允许“试错式猜字段”。
- `401`: 认证/绑定上下文失效；提示重登或重绑。
- `409`: 业务冲突；直接向用户说明冲突原因。
- `422`: 业务策略阻断（如评分/账号状态）；按响应 `action/details` 给用户决策。
- `5xx`: 仅在幂等安全前提下重试一次。
