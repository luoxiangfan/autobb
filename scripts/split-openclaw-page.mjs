import fs from 'fs'

const pagePath = 'src/app/(app)/openclaw/page.tsx'
const lines = fs.readFileSync(pagePath, 'utf8').split(/\r?\n/)
const slice = (from, to) => lines.slice(from - 1, to)

fs.mkdirSync('src/app/(app)/openclaw/_components', { recursive: true })

// types & constants & utils & form-controls
fs.writeFileSync(
  'src/app/(app)/openclaw/types.ts',
  `${slice(24, 443).join('\n').replace(/^type /gm, 'export type ')}\n`
)
fs.writeFileSync(
  'src/app/(app)/openclaw/constants.ts',
  `${slice(445, 559).join('\n').replace(/^const /gm, 'export const ')}\n`
)

const utilsImports = `import {
  HIGH_RISK_COMMAND_LOOKBACK_DAYS,
  OPENCLAW_TIMEZONE,
  STRATEGY_CRON_OPTIONS,
} from './constants'
import type {
  FeishuChatExecutionState,
  FeishuChatHealthDecision,
  FeishuChatHealthLogItem,
  FeishuChatWorkflowState,
  FeishuReceiveIdType,
  OpenclawCommandRiskLevel,
  OpenclawStrategyRecommendation,
} from './types'

`
const utilsBody = slice(561, 1014)
  .join('\n')
  .replace(/^const /gm, 'export const ')
  .replace(/^function /gm, 'export function ')
  .replace(/^type /gm, 'export type ')
fs.writeFileSync('src/app/(app)/openclaw/utils.ts', `${utilsImports}${utilsBody}\n`)

fs.writeFileSync(
  'src/app/(app)/openclaw/_components/form-controls.tsx',
  `'use client'

import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'

${slice(4981, 5034).join('\n').replace(/^function /gm, 'export function ')}
`
)

const hookLines = slice(1017, 2752)

const declared = new Set()
for (const line of hookLines) {
  const arrayMatch = line.match(/^  const \[([^\]]+)\] =/)
  if (arrayMatch) {
    for (const part of arrayMatch[1].split(',')) {
      const segment = part.trim()
      if (!segment) continue
      const alias = segment.includes(':') ? segment.split(':')[1]?.trim() : segment
      if (alias) declared.add(alias)
    }
    continue
  }
  const objectStart = line.match(/^  const \{/)
  if (objectStart) {
    let block = line
    let index = hookLines.indexOf(line)
    while (!block.includes('} =') && index + 1 < hookLines.length) {
      index += 1
      block += `\n${hookLines[index]}`
    }
    const inner = block.replace(/^  const \{\n?/, '').replace(/\} =[\s\S]*$/, '')
    for (const part of inner.split(',')) {
      const segment = part.trim()
      if (!segment) continue
      const alias = segment.includes(':') ? segment.split(':')[1]?.trim() : segment
      if (alias) declared.add(alias)
    }
    continue
  }
  const fnMatch = line.match(/^  const (handle[A-Za-z0-9_]+) =/)
  if (fnMatch) {
    declared.add(fnMatch[1])
    continue
  }
  const constMatch = line.match(/^  const ([A-Za-z_][A-Za-z0-9_]*)(?::[^=]+)? =/)
  if (constMatch) declared.add(constMatch[1])
}

const hookImports = `'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { usePagination } from '@/hooks'
import { parseAiModelsJson, setAiModelsSelectedModel } from '@/lib/openclaw/config/ai-models'
import {
  AI_GLOBAL_EDIT_KEYS,
  AI_GLOBAL_KEY_SET,
  AI_GLOBAL_KEYS,
  AI_MINIMAL_PLACEHOLDER,
  FEISHU_BASIC_EXAMPLE_VALUES,
  FEISHU_CHAT_COMMUNICATION_USER_KEYS,
  FEISHU_CHAT_MINIMAL_USER_KEYS,
  FEISHU_CHAT_USER_KEYS,
  HIGH_RISK_COMMAND_PAGE_LIMIT,
  HIGH_RISK_COMMAND_LOOKBACK_DAYS,
  PARTNERBOOST_USER_KEYS,
  REPORT_TREND_RANGE_OPTIONS,
  DEFAULT_REPORT_TREND_RANGE_DAYS,
  STRATEGY_CRON_OPTIONS,
  STRATEGY_MINIMAL_USER_KEYS,
  USER_DEFAULT_VALUES,
  USER_KEYS,
} from './constants'
import type {
  DailyReport,
  FeishuChatHealthLogItem,
  FeishuChatHealthResponse,
  FeishuVerifyResultState,
  FeishuVerifySessionState,
  GatewaySkillRow,
  GatewayStatusResponse,
  OpenclawAiAuthOverrideWarning,
  OpenclawCommandRunItem,
  OpenclawCommandRunsResponse,
  OpenclawGatewayReloadResponse,
  OpenclawSettingsResponse,
  OpenclawSettingsSaveResponse,
  OpenclawStrategyRecommendation,
  SettingItem,
  StrategyBatchAction,
  StrategyBatchFailure,
  StrategyBatchScope,
  StrategyConfirmRequest,
  StrategyConfirmTone,
  StrategyRecommendationStatusFilter,
  StrategyRecommendationsResponse,
  TokenRecord,
  WorkspaceBootstrapResponse,
  WorkspaceStatusResponse,
} from './types'
import {
  formatAgeSeconds,
  formatCountdown,
  formatDuration,
  formatFeishuRunIdShort,
  formatMoney,
  formatMoneyWithUnit,
  formatNumber,
  formatTimestamp,
  formatTimestampCompactLines,
  hasText,
  isLikelyCronExpression,
  isStrategyRecommendationExecutable,
  isStrategyRecommendationQueued,
  isTruthy,
  normalizeFeishuId,
  normalizeIsoDateText,
  parseFeishuVerifyTarget,
  parseLocalDate,
  renderTriState,
  resolveCommandConfirmStatusText,
  resolveCommandRiskBadge,
  resolveFeishuExecutionBadge,
  resolveFeishuHealthDecisionBadge,
  resolveFeishuHealthSenderText,
  resolveFeishuWorkflowBadge,
  resolveImpactConfidenceText,
  resolveImpactEstimationSourceText,
  resolveNormalizedReportDateRange,
  resolvePostReviewStatusText,
  resolveRecentHighRiskCreatedAfter,
  resolveStrategyCronPreset,
  resolveStrategyRecommendationExecuteDatePolicy,
  resolveStrategyRecommendationStatusBadge,
  resolveStrategyRecommendationStatusRank,
  resolveStrategyRecommendationTypeLabel,
  resolveStrategyRecommendationTypeRank,
  resolveStrategyRecommendationTypeTone,
  shiftOpenclawLocalIsoDate,
} from './utils'
import { STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS } from './utils'

`

const returnKeys = [...declared].sort()
const returnBody = returnKeys.map((k) => `    ${k},`).join('\n')

fs.writeFileSync(
  'src/app/(app)/openclaw/use-openclaw-page.ts',
  `${hookImports}export function useOpenClawPage() {
${hookLines.join('\n')}
  return {
${returnBody}
  }
}

export type OpenClawPageViewModel = ReturnType<typeof useOpenClawPage>
`
)

fs.writeFileSync(
  'src/app/(app)/openclaw/openclaw-page-context.tsx',
  `'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useOpenClawPage, type OpenClawPageViewModel } from './use-openclaw-page'

const OpenClawPageContext = createContext<OpenClawPageViewModel | null>(null)

export function OpenClawPageProvider({ children }: { children: ReactNode }) {
  const value = useOpenClawPage()
  return <OpenClawPageContext.Provider value={value}>{children}</OpenClawPageContext.Provider>
}

export function useOpenClawPageContext(): OpenClawPageViewModel {
  const value = useContext(OpenClawPageContext)
  if (!value) {
    throw new Error('useOpenClawPageContext must be used within OpenClawPageProvider')
  }
  return value
}
`
)

function buildTabComponent(name, fileName, from, to, extraImports) {
  const bodyLines = slice(from, to)
  let start = 0
  let end = bodyLines.length
  if (bodyLines[0]?.includes('<TabsContent')) start = 1
  if (bodyLines[end - 1]?.includes('</TabsContent>')) end -= 1
  const body = bodyLines.slice(start, end).join('\n')

  const usedKeys = [...declared].filter((key) => new RegExp(`\\b${key}\\b`).test(body))
  const destructure = usedKeys.map((k) => `  ${k},`).join('\n')

  const content = `'use client'

import { toast } from 'sonner'
import { Eye } from 'lucide-react'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ResponsivePagination } from '@/components/ui/responsive-pagination'
import { TrendChartDynamic } from '@/components/charts/dynamic'
import { InputWithLabel, KpiCard, SwitchWithLabel } from './form-controls'
import {
  AI_GLOBAL_KEYS,
  AI_MINIMAL_PLACEHOLDER,
  FEISHU_BASIC_EXAMPLE_VALUES,
  FEISHU_CHAT_USER_KEYS,
  HIGH_RISK_COMMAND_LOOKBACK_DAYS,
  REPORT_TREND_RANGE_OPTIONS,
  STRATEGY_CRON_OPTIONS,
} from '../constants'
import type { StrategyBatchScope, StrategyRecommendationStatusFilter } from '../types'
import {
  formatAgeSeconds,
  formatCountdown,
  formatDuration,
  formatFeishuRunIdShort,
  formatMoney,
  formatMoneyWithUnit,
  formatNumber,
  formatTimestamp,
  formatTimestampCompactLines,
  hasText,
  isLikelyCronExpression,
  isStrategyRecommendationExecutable,
  isStrategyRecommendationQueued,
  isTruthy,
  normalizeCurrencyCode,
  parseLocalDate,
  renderTriState,
  resolveCommandConfirmStatusText,
  resolveCommandRiskBadge,
  resolveFeishuExecutionBadge,
  resolveFeishuHealthDecisionBadge,
  resolveFeishuHealthSenderText,
  resolveFeishuWorkflowBadge,
  resolveImpactConfidenceText,
  resolveImpactEstimationSourceText,
  resolvePostReviewStatusText,
  resolveStrategyRecommendationStatusBadge,
  resolveStrategyRecommendationTypeLabel,
  resolveStrategyRecommendationTypeTone,
  shiftOpenclawLocalIsoDate,
  STRATEGY_T_MINUS_1_EXECUTABLE_TYPE_LABELS,
} from '../utils'
import { Switch } from '@/components/ui/switch'
${extraImports}
import { useOpenClawPageContext } from '../openclaw-page-context'

export function ${name}() {
  const {
${destructure}
  } = useOpenClawPageContext()

  return (
    <>
${body}
    </>
  )
}
`
  fs.writeFileSync(`src/app/(app)/openclaw/_components/${fileName}`, content)
}

buildTabComponent('OpenClawConfigTab', 'open-claw-config-tab.tsx', 2775, 3728, '')
buildTabComponent('OpenClawFeishuHealthTab', 'open-claw-feishu-health-tab.tsx', 3731, 3976, '')
buildTabComponent('OpenClawStrategyTab', 'open-claw-strategy-tab.tsx', 3979, 4675, '')
buildTabComponent('OpenClawReportTab', 'open-claw-report-tab.tsx', 4677, 4975, '')

const shell = `'use client'

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { OpenClawPageProvider, useOpenClawPageContext } from './openclaw-page-context'
import { OpenClawConfigTab } from './_components/open-claw-config-tab'
import { OpenClawFeishuHealthTab } from './_components/open-claw-feishu-health-tab'
import { OpenClawStrategyTab } from './_components/open-claw-strategy-tab'
import { OpenClawReportTab } from './_components/open-claw-report-tab'

function OpenClawPageShell() {
  const { loading, settings } = useOpenClawPageContext()

  if (loading) {
    return <div className="p-6 text-sm text-slate-500">加载 OpenClaw 配置...</div>
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">OpenClaw</h1>
          <p className="text-slate-500 text-sm mt-1">飞书协作 + AutoAds 自动化控制台</p>
        </div>
        <Link
          href="/help/openclaw-config"
          className={\`\${buttonVariants({ variant: 'outline', size: 'sm' })} gap-2\`}
        >
          配置指南
        </Link>
      </div>

      <Tabs defaultValue="config">
        <TabsList className="bg-slate-100">
          <TabsTrigger value="config">配置中心</TabsTrigger>
          {settings?.isAdmin === true && <TabsTrigger value="feishu-health">飞书链路健康</TabsTrigger>}
          <TabsTrigger value="strategy">自动分析</TabsTrigger>
          <TabsTrigger value="report">每日报表</TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="space-y-6">
          <OpenClawConfigTab />
        </TabsContent>

        {settings?.isAdmin === true && (
          <TabsContent value="feishu-health" className="space-y-6">
            <OpenClawFeishuHealthTab />
          </TabsContent>
        )}

        <TabsContent value="strategy" className="space-y-6">
          <OpenClawStrategyTab />
        </TabsContent>

        <TabsContent value="report" className="space-y-6">
          <OpenClawReportTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function OpenClawPage() {
  return (
    <OpenClawPageProvider>
      <OpenClawPageShell />
    </OpenClawPageProvider>
  )
}
`

fs.writeFileSync('src/app/(app)/openclaw/page.tsx', shell)
console.log(`declared ${declared.size} hook symbols`)
