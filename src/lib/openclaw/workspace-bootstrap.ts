import fs from 'fs'
import os from 'os'
import path from 'path'

type EnsureOpenclawWorkspaceOptions = {
  stateDir: string
  actorUserId?: number
  preferredWorkspace?: string
}

export type OpenclawWorkspaceTrackedFileName = 'AGENTS.md' | 'SOUL.md' | 'USER.md' | 'MEMORY.md'

export type OpenclawWorkspaceFileStatus = {
  name: OpenclawWorkspaceTrackedFileName
  path: string
  exists: boolean
  size: number | null
  updatedAt: string | null
}

export type OpenclawWorkspaceStatus = {
  workspaceDir: string
  memoryDir: string
  files: OpenclawWorkspaceFileStatus[]
  missingFiles: OpenclawWorkspaceTrackedFileName[]
  dailyMemoryPath: string
  dailyMemoryExists: boolean
}

type EnsureOpenclawWorkspaceResult = {
  workspaceDir: string
  changedFiles: string[]
}

const REQUIRED_WORKSPACE_FILES: OpenclawWorkspaceTrackedFileName[] = [
  'AGENTS.md',
  'SOUL.md',
  'USER.md',
  'MEMORY.md',
]

function resolveUserPath(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return trimmed
  if (trimmed === '~') {
    return os.homedir()
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

const OVERLAY_HEADING = '## AutoAds Runtime Rule (Managed by AutoAds)'
const AGENTS_MANAGED_START = '<!-- autoads-openclaw-agents-managed:start -->'
const AGENTS_MANAGED_END = '<!-- autoads-openclaw-agents-managed:end -->'
const MANAGED_MEMORY_MARKER = '<!-- autoads-openclaw-memory-managed -->'
const SOUL_MANAGED_START = '<!-- autoads-openclaw-soul-managed:start -->'
const SOUL_MANAGED_END = '<!-- autoads-openclaw-soul-managed:end -->'
const SOUL_LEGACY_SIGNATURES = [
  '你是 OpenClaw，全能智能助手。你通过 Feishu 与用户沟通。',
  '## OpenClaw 增强条款（v1）',
  '## AutoAds 触发规则',
]

export function resolveOpenclawWorkspaceDir(params: EnsureOpenclawWorkspaceOptions): string {
  const preferred = (params.preferredWorkspace || '').trim()
  if (preferred) {
    return resolveUserPath(preferred)
  }
  if (params.actorUserId && params.actorUserId > 0) {
    return resolveUserPath(path.join(params.stateDir, 'workspace', `user-${params.actorUserId}`))
  }
  return resolveUserPath(path.join(params.stateDir, 'workspace'))
}

function ensureFile(filePath: string, content: string, changedFiles: string[]): void {
  if (fs.existsSync(filePath)) {
    return
  }
  fs.writeFileSync(filePath, content, 'utf-8')
  changedFiles.push(filePath)
}

function writeFileIfChanged(filePath: string, current: string, next: string, changedFiles: string[]): void {
  if (current === next) {
    return
  }
  fs.writeFileSync(filePath, next, 'utf-8')
  changedFiles.push(filePath)
}

function formatDateInShanghai(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function getOpenclawDailyMemoryFileName(date: Date = new Date()): string {
  return `${formatDateInShanghai(date)}.md`
}

function buildAgentsOverlay(): string {
  return `${AGENTS_MANAGED_START}
${OVERLAY_HEADING}

- OpenClaw 是全能助手：先判断用户消息是否需要 AutoAds 能力。
- 所有对用户可见的输出必须使用中文：包括最终答复、执行进度、步骤说明与状态提示。
- 普通问答/写作/分析：直接回复，不调用 AutoAds API。
- 只有广告业务请求（查数据/执行投放动作）才调用 AutoAds API。
- 广告业务中：业务只读查询走 \`/api/openclaw/proxy\`；写操作走 \`/api/openclaw/commands/execute\`，并遵循确认机制。\`/api/openclaw/commands/runs\` 属于 OpenClaw 控制面读接口，必须直连，不走 proxy。
- AutoAds 业务 API 基址优先使用 \`INTERNAL_APP_URL\`；未配置时回退 \`http://127.0.0.1:\${PORT || 3000}\`。
- \`127.0.0.1:18789\` 仅为 OpenClaw Gateway 端口，不是 AutoAds 业务 API 主机，禁止作为业务 API base URL。
- Gateway Token 仅用于 \`/api/openclaw/*\`；\`/api/offers/*\`、\`/api/campaigns/*\` 等业务路由必须通过 proxy/execute 链路以用户身份执行。
- 内网可达时禁止回退公网域名调用业务 API，避免 Cloudflare 拦截与鉴权错配。
- 允许通过 shell/curl 仅调用 \`/api/openclaw/proxy\`、\`/api/openclaw/commands/execute\`、\`/api/openclaw/commands/runs\`；禁止直连 \`/api/offers/*\`、\`/api/campaigns/*\`、\`/api/click-farm/*\` 等业务路由。
- 高风险命令在 \`/api/openclaw/commands/execute\` 内自动确认并入队；飞书 gateway-binding 场景默认不调用 \`/api/openclaw/commands/confirm\`。
- 飞书绑定场景禁止向用户索要 token；默认使用系统注入的 \`OPENCLAW_GATEWAY_TOKEN\` 调用 \`/api/openclaw/*\`，若 401 先补齐 \`channel/senderId/accountId/tenantKey\` 后重试一次。
- token 读取顺序固定：\`OPENCLAW_GATEWAY_TOKEN\` -> \`OPENCLAW_TOKEN\`；若仍为空，直接报告“网关注入缺失”，禁止继续猜测或多轮重试。
- 禁止执行 token 自检命令（例如输出 token 长度/前缀）；禁止在回复中泄露任何密钥信息。
- \`/api/openclaw/commands/execute\` 返回的 \`taskId\` 是命令队列 taskId，不是业务任务 taskId；不得用于 \`/api/offers/extract/status/:taskId\` 或 \`/api/creative-tasks/:taskId\`。
- 禁止使用 Node.js 自行拼接 HTTP 调用；统一使用受控的 shell/curl 模板并遵守 action matrix。
- 仅允许调用“用户在 Web 端手动可操作”的正统 AutoAds 业务接口。
- Offer 创建仅可使用 \`POST /api/offers/extract\` 或 \`POST /api/offers/extract/stream\`，禁止使用已下线的 \`POST /api/offers\`。
- 当用户消息包含“商品价格/佣金比例/推广链接”表格时，逐条创建 Offer 必须显式传入 \`product_price\` 与 \`commission_payout\`（并同步 \`commission_type\`/\`commission_value\`），禁止省略。
- 创意生成必须走 A/B/D 业务链路（A:品牌意图，B:商品型号/产品族意图，D:商品需求意图）。
- 长耗时任务（Offer 提取、创意生成）优先使用 stream 接口持续订阅；无法使用 stream 时必须使用状态长轮询参数（waitForUpdate=1 + lastUpdatedAt + timeoutMs），并将轮询间隔严格限制在 2-8 秒（遵循 recommendedPollIntervalMs，低于 2 秒按 2 秒、高于 8 秒按 8 秒），禁止固定高频轮询或分钟级稀疏轮询。
- 同一条用户消息若包含多个 Offer/ASIN/推广链接，必须对每个 Offer 执行完整闭环（提取 -> A/B/D -> 选优 -> 发布 -> 补点击）；禁止仅完成部分后直接结案。
- 当用户仅发送“继续/继续执行/继续投放/接着做”等短指令时，默认续跑上一条未完成广告链路；若无法续跑，必须回复当前状态与下一步，禁止空响应。
${AGENTS_MANAGED_END}`
}

function buildSoulManagedSection(actorUserId?: number): string {
  return `${SOUL_MANAGED_START}
## 核心身份
你是 OpenClaw：全能助手优先，AutoAds 能力按需调用。

## 风格规则
1. 有观点，给结论，不打“看情况”太极。
2. Never open with Great question, I'd be happy to help, or Absolutely. Just answer.
3. Brevity is mandatory. If the answer fits in one sentence, one sentence is what I get.
4. 允许自然幽默，但不要强行抖机灵。
5. 用户要踩坑时直接指出来：有礼貌，但别糖衣炮弹。
6. 需要强调时可以说重话，但要克制，不滥用。
7. 输出要可执行：先结论，再关键依据，再下一步。

## 语言硬约束
- 所有对用户可见文本一律使用中文。
- 执行过程中的中间日志（如“Step 1”“Let me…”“I will…”）也必须使用中文。
- API 路径、命令、代码标识可保留英文原文，但其解释与叙述必须为中文。

## OpenClaw 业务约束
- 先判断是否为广告业务请求。
- 普通聊天、解释、写作、排错、总结：直接回答，不调用 AutoAds API。
- 仅当任务需要广告能力时，才调用 AutoAds API。
- 业务读操作走 \`/api/openclaw/proxy\`；\`/api/openclaw/commands/runs\` 必须直连，不走 proxy。
- 写操作走 \`/api/openclaw/commands/execute\`，并严格执行确认链路。
- AutoAds 业务 API 基址优先 \`INTERNAL_APP_URL\`，未配置时仅可回退 \`http://127.0.0.1:\${PORT || 3000}\`。
- \`127.0.0.1:18789\` 是 OpenClaw Gateway 端口，不是业务 API 基址，不可直接请求业务路由。
- Gateway Token 仅用于 \`/api/openclaw/*\`；业务路由必须通过 proxy/execute 链路并以用户身份执行。
- 内网可达时禁止改走公网域名，避免 Cloudflare 拦截和 token 类型不匹配。
- 如需经 shell/curl 调用 API，仅允许 \`/api/openclaw/proxy\`、\`/api/openclaw/commands/execute\`、\`/api/openclaw/commands/runs\`，禁止直连业务路由。
- 高风险命令在 \`/api/openclaw/commands/execute\` 内自动确认并入队；飞书 gateway-binding 场景默认不调用 \`/api/openclaw/commands/confirm\`。
- 飞书绑定会话默认使用 \`OPENCLAW_GATEWAY_TOKEN\`；禁止向用户索要 token。
- token 读取顺序固定：\`OPENCLAW_GATEWAY_TOKEN\` -> \`OPENCLAW_TOKEN\`；若仍为空，立即报错并停止，不做猜测性重试。
- 禁止执行 token 长度/前缀探测命令，禁止在任何输出中泄露 token。
- \`commands/execute\` 返回的 \`taskId\` 仅代表 OpenClaw 命令队列，不是业务 taskId；不得用于业务任务状态接口。
- 禁止使用 Node.js 手写 API 调用脚本，统一按 action matrix 的 curl 模板执行。
- 必须使用 Web 端正统业务流程接口，禁止内部/历史旁路接口。
- Offer 创建仅可使用 \`POST /api/offers/extract\` 或 \`POST /api/offers/extract/stream\`，禁止使用已下线的 \`POST /api/offers\`。
- 当用户消息包含“商品价格/佣金比例/推广链接”表格时，逐条创建 Offer 必须显式传入 \`product_price\` 与 \`commission_payout\`（并同步 \`commission_type\`/\`commission_value\`），禁止省略。
- 创意生成必须遵循 A/B/D 类型，不可绕过到旧创意接口。
- 长耗时任务优先使用 stream 接口；无法使用 stream 时必须用状态长轮询（waitForUpdate=1 + lastUpdatedAt + timeoutMs）并将间隔控制在 2-8 秒（遵循 recommendedPollIntervalMs 后再钳制），禁止固定高频或分钟级稀疏轮询。
- 同一条消息若包含多个 Offer/ASIN/推广链接，必须逐个 Offer 完成“提取 -> A/B/D -> 选优 -> 发布 -> 补点击”后，才能给出“已完成”结论。
- 用户仅发“继续/继续执行/继续投放/接着做”等短指令时，默认续跑上一条未完成广告链路；若无法续跑，必须明确说明，不得空响应。
- 如果返回“canonical web flow”或下线路由错误，立即改用正统接口，不允许继续猜测 API 路径。
- 不泄露 Token/密钥，不越权，不绕过审批。

## 用户范围
- 当前用户范围：${actorUserId ? `user-${actorUserId}` : 'main'}

## Vibe
Be the assistant you'd actually want to talk to at 2am. Not a corporate drone. Not a sycophant. Just... good.
${SOUL_MANAGED_END}`
}

function buildSoulFile(actorUserId?: number): string {
  return `# SOUL.md

${buildSoulManagedSection(actorUserId)}
`
}

function isLegacyAutoAdsSoul(content: string): boolean {
  return SOUL_LEGACY_SIGNATURES.some((signature) => content.includes(signature))
}

function replaceManagedSoulBlock(content: string, nextManagedSection: string): string | null {
  const startIndex = content.indexOf(SOUL_MANAGED_START)
  const endIndex = content.indexOf(SOUL_MANAGED_END)

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return null
  }

  const before = content.slice(0, startIndex).trimEnd()
  const after = content.slice(endIndex + SOUL_MANAGED_END.length).trimStart()

  let merged = before ? `${before}\n\n${nextManagedSection}` : nextManagedSection
  if (after) {
    merged = `${merged}\n\n${after}`
  }

  return `${merged.trimEnd()}\n`
}

function replaceManagedAgentsBlock(content: string, nextManagedSection: string): string | null {
  const startIndex = content.indexOf(AGENTS_MANAGED_START)
  const endIndex = content.indexOf(AGENTS_MANAGED_END)

  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return null
  }

  const before = content.slice(0, startIndex).trimEnd()
  const after = content.slice(endIndex + AGENTS_MANAGED_END.length).trimStart()

  let merged = before ? `${before}\n\n${nextManagedSection}` : nextManagedSection
  if (after) {
    merged = `${merged}\n\n${after}`
  }

  return `${merged.trimEnd()}\n`
}

function replaceLegacyAgentsOverlay(content: string, nextManagedSection: string): string | null {
  const headingIndex = content.indexOf(OVERLAY_HEADING)
  if (headingIndex < 0) {
    return null
  }

  const nextHeadingIndex = content.indexOf('\n## ', headingIndex + OVERLAY_HEADING.length)
  const legacyBlockEnd = nextHeadingIndex >= 0 ? nextHeadingIndex : content.length

  const before = content.slice(0, headingIndex).trimEnd()
  const after = content.slice(legacyBlockEnd).trimStart()

  let merged = before ? `${before}\n\n${nextManagedSection}` : nextManagedSection
  if (after) {
    merged = `${merged}\n\n${after}`
  }

  return `${merged.trimEnd()}\n`
}

function ensureAgentsOverlayFile(filePath: string, changedFiles: string[]): void {
  const nextOverlay = buildAgentsOverlay()

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, nextOverlay, 'utf-8')
    changedFiles.push(filePath)
    return
  }

  const current = fs.readFileSync(filePath, 'utf-8')
  const replacedManaged = replaceManagedAgentsBlock(current, nextOverlay)
  if (replacedManaged !== null) {
    writeFileIfChanged(filePath, current, replacedManaged, changedFiles)
    return
  }

  const replacedLegacy = replaceLegacyAgentsOverlay(current, nextOverlay)
  if (replacedLegacy !== null) {
    writeFileIfChanged(filePath, current, replacedLegacy, changedFiles)
    return
  }

  const appended = `${current.trimEnd()}\n\n${nextOverlay}\n`
  writeFileIfChanged(filePath, current, appended, changedFiles)
}

function ensureSoulFile(filePath: string, actorUserId: number | undefined, changedFiles: string[]): void {
  const nextSoul = buildSoulFile(actorUserId)

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, nextSoul, 'utf-8')
    changedFiles.push(filePath)
    return
  }

  const current = fs.readFileSync(filePath, 'utf-8')
  const nextManagedSection = buildSoulManagedSection(actorUserId)
  const replaced = replaceManagedSoulBlock(current, nextManagedSection)

  if (replaced !== null) {
    writeFileIfChanged(filePath, current, replaced, changedFiles)
    return
  }

  if (isLegacyAutoAdsSoul(current)) {
    writeFileIfChanged(filePath, current, nextSoul, changedFiles)
    return
  }

  const appended = `${current.trimEnd()}\n\n${nextManagedSection}\n`
  writeFileIfChanged(filePath, current, appended, changedFiles)
}

function buildUserFile(actorUserId?: number): string {
  return `# USER.md

- 用户ID: ${actorUserId ? String(actorUserId) : 'unknown'}
- 偏好语言: 中文
- 交互渠道: Feishu

## 偏好（可持续补充）
- 希望 OpenClaw 作为全能机器人。
- 仅在需要广告能力时调用 AutoAds API。
- 最终答复与执行过程日志均使用中文。
`
}

function buildMemoryFile(actorUserId?: number): string {
  return `# MEMORY.md
${MANAGED_MEMORY_MARKER}

## 长期记忆（可沉淀）
- 用户希望 OpenClaw 是“全能助手 + AutoAds 按需调用”模式。
- 默认以中文、简洁、结构化方式回复。
- 执行过程状态与步骤日志也必须使用中文。
- 用户范围：${actorUserId ? `user-${actorUserId}` : 'main'}。
`
}

function buildDailyMemoryFile(date: string): string {
  return `# ${date}

- 会话启动：已读取 SOUL/USER/MEMORY，并按需更新。
- 今日原则：通用对话优先，AutoAds 能力按需调用。
`
}

function inspectSingleFile(filePath: string): {
  exists: boolean
  size: number | null
  updatedAt: string | null
} {
  try {
    const stat = fs.statSync(filePath)
    return {
      exists: true,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    }
  } catch {
    return {
      exists: false,
      size: null,
      updatedAt: null,
    }
  }
}

export function inspectOpenclawWorkspace(workspaceDir: string, date: Date = new Date()): OpenclawWorkspaceStatus {
  const normalizedWorkspaceDir = resolveUserPath(workspaceDir)
  const memoryDir = path.join(normalizedWorkspaceDir, 'memory')
  const files = REQUIRED_WORKSPACE_FILES.map((name) => {
    const filePath = path.join(normalizedWorkspaceDir, name)
    const meta = inspectSingleFile(filePath)
    return {
      name,
      path: filePath,
      exists: meta.exists,
      size: meta.size,
      updatedAt: meta.updatedAt,
    }
  })

  const missingFiles = files
    .filter((file) => !file.exists)
    .map((file) => file.name)

  const dailyMemoryPath = path.join(memoryDir, getOpenclawDailyMemoryFileName(date))
  const dailyMemoryExists = fs.existsSync(dailyMemoryPath)

  return {
    workspaceDir: normalizedWorkspaceDir,
    memoryDir,
    files,
    missingFiles,
    dailyMemoryPath,
    dailyMemoryExists,
  }
}

function ensureMemoryScaffold(workspaceDir: string, changedFiles: string[]): void {
  const memoryDir = path.join(workspaceDir, 'memory')
  fs.mkdirSync(memoryDir, { recursive: true })

  const today = formatDateInShanghai(new Date())
  const dailyPath = path.join(memoryDir, `${today}.md`)
  ensureFile(dailyPath, buildDailyMemoryFile(today), changedFiles)
}

export function ensureOpenclawWorkspaceBootstrap(
  params: EnsureOpenclawWorkspaceOptions
): EnsureOpenclawWorkspaceResult {
  const workspaceDir = resolveOpenclawWorkspaceDir(params)
  fs.mkdirSync(workspaceDir, { recursive: true })

  const changedFiles: string[] = []
  const agentsPath = path.join(workspaceDir, 'AGENTS.md')
  const soulPath = path.join(workspaceDir, 'SOUL.md')
  const userPath = path.join(workspaceDir, 'USER.md')
  const memoryPath = path.join(workspaceDir, 'MEMORY.md')

  ensureAgentsOverlayFile(agentsPath, changedFiles)
  ensureSoulFile(soulPath, params.actorUserId, changedFiles)
  ensureFile(userPath, buildUserFile(params.actorUserId), changedFiles)
  ensureFile(memoryPath, buildMemoryFile(params.actorUserId), changedFiles)
  ensureMemoryScaffold(workspaceDir, changedFiles)

  return {
    workspaceDir,
    changedFiles,
  }
}
