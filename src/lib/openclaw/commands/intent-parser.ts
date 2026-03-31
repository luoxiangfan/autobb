import type { OpenclawCommandRiskLevel } from './risk-policy'
import { deriveOpenclawCommandRiskLevel, requiresOpenclawCommandConfirmation } from './risk-policy'
import { validateOpenclawApiRequest } from '@/lib/openclaw/canonical-routes'

export type ParseOpenclawCommandInput = {
  method: string
  path: string
  intent?: string | null
}

export type ParsedOpenclawCommandIntent = {
  method: string
  path: string
  intent: string
  riskLevel: OpenclawCommandRiskLevel
  requiresConfirmation: boolean
  summary: string
}

function deriveIntentFromPath(path: string): string {
  const cleanPath = path.split('?')[0]
  const parts = cleanPath.split('/').filter(Boolean)
  if (parts.length < 2) {
    return 'api.request'
  }

  const resource = parts[1]
  const target = parts[2]
  if (!target) {
    return `${resource}.list`
  }

  return `${resource}.${target}`
}

function buildSummary(params: {
  method: string
  path: string
  riskLevel: OpenclawCommandRiskLevel
  requiresConfirmation: boolean
}): string {
  const confirmLabel = params.requiresConfirmation ? '需要卡片确认' : '可直接执行'
  return `${params.method} ${params.path}（风险: ${params.riskLevel}，${confirmLabel}）`
}

export function parseOpenclawCommandIntent(
  input: ParseOpenclawCommandInput
): ParsedOpenclawCommandIntent {
  const validated = validateOpenclawApiRequest(input.method || '', String(input.path || '').trim())
  const method = validated.method
  const path = validated.path

  const riskLevel = deriveOpenclawCommandRiskLevel({ method, path })
  const requiresConfirmation = requiresOpenclawCommandConfirmation(riskLevel)
  const intent = String(input.intent || '').trim() || deriveIntentFromPath(path)

  return {
    method,
    path,
    intent,
    riskLevel,
    requiresConfirmation,
    summary: buildSummary({ method, path, riskLevel, requiresConfirmation }),
  }
}
