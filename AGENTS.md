# AGENTS.md

## 沟通与需求澄清（默认规则）

在给出方案前，先进行需求澄清：

1. 一次只问一个问题。
2. 根据用户回答继续追问下一个最关键问题。
3. 持续澄清，直到对用户真实需求与目标达到约 95% 的把握。
4. 达到上述把握后，再给出方案。

## 例外

- 若用户明确要求“不要提问、直接给方案/代码”，则按用户要求直接执行。

## 问题修复后复盘规则

- 现在问题解决了，但请你重新Review一下今天的几轮修改，看看是不是补丁叠补丁的修改，如果是的话，重构成最优解。

## 破坏性重构执行指令

- 执行破坏性重构：彻底移除历史兼容补丁与逻辑兜底，在确保架构整洁的同时，通过内嵌防御性编程与优雅降级机制，优先保障系统的可用性与容错均衡。

## Google Ads 共享认证（开发约定）

**产品规则：OAuth 与服务账号二选一。** 同一用户（或共享管理员）在任意时刻只能生效一种认证方式；切换前须在设置页删除当前方式（见 `settings` 删除确认）。**不要实现「OAuth 失效后自动改用用户级服务账号」或「同时配置两种方式」的兜底。**

调用 Google Ads API 或判断用户是否已配置认证时：

1. 优先 `getGoogleAdsAuthContext(userId)`，勿在同一请求内重复 `getUserAuthType` + `getGoogleAdsCredentials`。
2. 是否已配置用 `hasConfiguredGoogleAdsAuthFromContext` 或 `hasConfiguredGoogleAdsAuth`；勿仅用 `auth.serviceAccountId` 判断服务账号。
3. 发起 API 调用时用 `resolveGoogleAdsApiAuthFromContext(ctx, linkedAccountServiceAccountId)`。`linkedAccountServiceAccountId` 仅在**当前用户认证类型为服务账号**时参与解析（见 `resolveEffectiveServiceAccountId`）；OAuth 用户不会按账号 SA 改走服务账号 API。
4. 账号同步/发布等预检用 `resolveGoogleAdsApiAuthForAccount`，勿仅用 `google_ads_accounts.refresh_token` 判断 OAuth 是否可用。
5. 模块说明见 `src/lib/google-ads-auth-context.ts` 文件头注释。

## GitNexus 使用规范（本仓库）

### 何时必须使用

1. 修改任何函数/类/方法前，必须先做影响面分析。
2. 对陌生模块排查问题时，优先用图谱检索，不先盲目全文搜索。

### 标准流程（固定顺序）

1. `gitnexus status`
2. `gitnexus analyze`（若索引过期）
3. `gitnexus query "<业务概念或错误现象>"`
4. `gitnexus context <symbol> -f <filePath>`
5. `gitnexus impact <symbol> --depth 2`

### 常用命令速查

```bash
gitnexus status
gitnexus analyze
gitnexus query "checkout timeout"
gitnexus context evaluateAdStrength -f src/lib/ad-strength-evaluator.ts
gitnexus impact evaluateAdStrength --depth 2
```

### 执行要求

1. 进入代码修改前，先汇报 `impact` 结果（直接调用方、风险级别、影响模块）。
2. 若风险为 HIGH/CRITICAL，先给出降风险方案，再实施修改。
3. 改动完成后，说明是否需要重新 `analyze` 以保持索引新鲜。
4. 改动完成后，检查是否存在错误

### 当前仓库限制

1. 该问题已解决：通过忽略 `openclaw/`、`openclaw-v1/`、`openclaw-prebuilt/`，索引已降到约 `9.8k` 节点，`stats.embeddings > 0`。
2. 在当前网络环境，生成 embeddings 时需使用镜像源：
   `HF_ENDPOINT=https://hf-mirror.com gitnexus analyze --force --embeddings .`
3. 若升级/重装了全局 `gitnexus` 后问题复现，需重新应用本机的 GitNexus ignore/embedder 补丁后再重建索引。

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **autobb** (41101 symbols, 73002 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/autobb/context` | Codebase overview, check index freshness |
| `gitnexus://repo/autobb/clusters` | All functional areas |
| `gitnexus://repo/autobb/processes` | All execution flows |
| `gitnexus://repo/autobb/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

Use 'bd' for task tracking


<!-- BEGIN BEADS INTEGRATION v:1 profile:full hash:d4f96305 -->
## Issue Tracking with bd (beads)

**IMPORTANT**: This project uses **bd (beads)** for ALL issue tracking. Do NOT use markdown TODOs, task lists, or other tracking methods.

### Temporary Exception (Current Repo State)

- `bd dolt push` is currently **not required** in this repository.
- `bd dolt pull` is currently **not required** in this repository.
- Reason: Dolt remote is not configured (`remote 'origin' not found`), so push will fail consistently.
- Track restoration work in bead `autobb-8to`.

### Why bd?

- Dependency-aware: Track blockers and relationships between issues
- Git-friendly: Dolt-powered version control with native sync
- Agent-optimized: JSON output, ready work detection, discovered-from links
- Prevents duplicate tracking systems and confusion

### Quick Start

**Check for ready work:**

```bash
bd ready --json
```

**Create new issues:**

```bash
bd create "Issue title" --description="Detailed context" -t bug|feature|task -p 0-4 --json
bd create "Issue title" --description="What this issue is about" -p 1 --deps discovered-from:bd-123 --json
```

**Claim and update:**

```bash
bd update <id> --claim --json
bd update bd-42 --priority 1 --json
```

**Complete work:**

```bash
bd close bd-42 --reason "Completed" --json
```

### Issue Types

- `bug` - Something broken
- `feature` - New functionality
- `task` - Work item (tests, docs, refactoring)
- `epic` - Large feature with subtasks
- `chore` - Maintenance (dependencies, tooling)

### Priorities

- `0` - Critical (security, data loss, broken builds)
- `1` - High (major features, important bugs)
- `2` - Medium (default, nice-to-have)
- `3` - Low (polish, optimization)
- `4` - Backlog (future ideas)

### Workflow for AI Agents

1. **Check ready work**: `bd ready` shows unblocked issues
2. **Claim your task atomically**: `bd update <id> --claim`
3. **Work on it**: Implement, test, document
4. **Discover new work?** Create linked issue:
   - `bd create "Found bug" --description="Details about what was found" -p 1 --deps discovered-from:<parent-id>`
5. **Complete**: `bd close <id> --reason "Done"`

### Auto-Sync

bd automatically syncs via Dolt:

- Each write auto-commits to Dolt history
- `bd dolt push` / `bd dolt pull` are temporarily skipped in this repo (see exception above)
- No manual export/import needed!

### Important Rules

- ✅ Use bd for ALL task tracking
- ✅ Always use `--json` flag for programmatic use
- ✅ Link discovered work with `discovered-from` dependencies
- ✅ Check `bd ready` before asking "what should I work on?"
- ❌ Do NOT create markdown TODO lists
- ❌ Do NOT use external issue trackers
- ❌ Do NOT duplicate tracking systems

For more details, see README.md and docs/QUICKSTART.md.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   # bd dolt push  # temporarily skipped: Dolt remote missing (tracked by autobb-8to)
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- END BEADS INTEGRATION -->
