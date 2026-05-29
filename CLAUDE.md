# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**AutoAds** is a production Next.js/TypeScript application for AI-powered Google Ads automation: offer scraping, creative generation, campaign management, performance analytics, and OpenClaw agent integration.

## Technology Stack

- **Frontend**: Next.js 14+ (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API Routes, Node.js
- **Database**: SQLite (local dev), PostgreSQL (production); migrations in `migrations/` and `pg-migrations/`
- **Auth**: Supabase Auth (Google OAuth); Google Ads OAuth or service account (mutually exclusive — see `AGENTS.md`)
- **AI**: Database-driven versioned prompts; Claude / Gemini integrations
- **Testing**: Vitest

## Development Commands

```bash
npm install          # install dependencies
npm run db:init      # initialize SQLite (first run)
npm run db:migrate   # apply incremental migrations
npm run dev          # development server
npm run build        # production build
npm run lint         # ESLint
npm test             # Vitest
npm run type-check   # TypeScript
npm run validate-schema
```

## Agent workflow (mandatory after code edits)

After changing application code, run **`npm run lint`** and **`npm run type-check`** in the repo root; both must pass before reporting work complete.

If the change touches SQL or the database layer (`migrations/`, `pg-migrations/`, raw SQL, `db-helpers`), review SQL correctness (table aliases, `?` placeholders vs `params`, column types) and run **`npm run db:migrate`**, **`npm run validate-schema`**, and targeted **`npm test`** for dual SQLite/PostgreSQL behavior. See [AGENTS.md](./AGENTS.md) —「代码修改后的质量门禁（必须）」and「数据库 / SQL 修改后的检查（必须）」.

## Key Directories

| Path | Purpose |
|------|---------|
| `src/app/` | Next.js App Router pages and API routes |
| `src/lib/` | Core business logic (creatives, offers, Google Ads, OpenClaw, queue) |
| `src/components/` | React UI components |
| `migrations/` | SQLite schema and incremental migrations |
| `pg-migrations/` | PostgreSQL migrations |
| `scripts/` | DB, validation, and maintenance scripts |
| `docs/` | Operations and feature documentation |

## Environment Variables

Copy `.env.example` to `.env.local` for local development. See `README.md` for the full variable list and deployment notes.

## Related Documentation

- [README.md](./README.md) — setup, architecture, deployment
- [AGENTS.md](./AGENTS.md) — agent workflow rules, Google Ads auth conventions, GitNexus usage, issue tracking (bd)
- [migrations/README.md](./migrations/README.md) — migration naming and recent increments
- [migrations/DATABASE_INITIALIZATION_GUIDE.md](./migrations/DATABASE_INITIALIZATION_GUIDE.md) — database setup

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **autobb** (36115 symbols, 65582 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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
