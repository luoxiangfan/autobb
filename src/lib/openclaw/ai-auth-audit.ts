import fs from 'fs'
import path from 'path'

type JsonRecord = Record<string, unknown>

type AuthProfileCredential = {
  type?: string
  provider?: string
  key?: string
  token?: string
  access?: string
  refresh?: string
  expires?: number
}

type AuthStoreDocument = {
  version?: number
  profiles?: Record<string, AuthProfileCredential>
  order?: Record<string, string[]>
  [key: string]: unknown
}

type ManagedProviderEntry = {
  providerId: string
  providerKey: string
  apiKey: string
  managedProfileId: string
}

export type OpenclawAiAuthOverrideWarning = {
  providerId: string
  source: 'auth-profile' | 'env'
  sourceLabel: string
  profileIds?: string[]
  authProfilesPath?: string
  envVar?: string
  message: string
  suggestion: string
}

const AUTH_PROFILE_FILENAME = 'auth-profiles.json'
const AUTH_STORE_VERSION = 1
const DEFAULT_AGENT_ID = 'main'
const MANAGED_PROFILE_PREFIX = 'autoads-managed:'

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as JsonRecord
}

function normalizeProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase()
  if (normalized === 'z.ai' || normalized === 'z-ai') return 'zai'
  if (normalized === 'opencode-zen') return 'opencode'
  if (normalized === 'qwen') return 'qwen-portal'
  if (normalized === 'kimi-code') return 'kimi-coding'
  return normalized
}

function normalizeSecret(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function resolveManagedProfileId(providerId: string): string {
  return `${MANAGED_PROFILE_PREFIX}${normalizeProviderId(providerId)}`
}

function isManagedProfileId(profileId: string): boolean {
  return profileId.startsWith(MANAGED_PROFILE_PREFIX)
}

function resolveStateDir(configPath?: string): string {
  const overridePath = normalizeSecret(process.env.OPENCLAW_CONFIG_PATH)
  if (overridePath) {
    return path.dirname(overridePath)
  }
  if (configPath && configPath.trim()) {
    return path.dirname(configPath)
  }
  const overrideStateDir = normalizeSecret(process.env.OPENCLAW_STATE_DIR)
  if (overrideStateDir) {
    return overrideStateDir
  }
  return path.join(process.cwd(), '.openclaw')
}

function resolveAuthProfilePathCandidates(stateDir: string): string[] {
  const candidates: string[] = []

  const explicitAgentDir = normalizeSecret(process.env.OPENCLAW_AGENT_DIR)
    || normalizeSecret(process.env.PI_CODING_AGENT_DIR)
  if (explicitAgentDir) {
    candidates.push(path.join(explicitAgentDir, AUTH_PROFILE_FILENAME))
  }

  candidates.push(path.join(stateDir, 'agents', DEFAULT_AGENT_ID, 'agent', AUTH_PROFILE_FILENAME))
  return Array.from(new Set(candidates))
}

function loadAuthProfileStore(stateDir: string): { store: AuthStoreDocument | null; pathname?: string } {
  const candidates = resolveAuthProfilePathCandidates(stateDir)
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      const raw = fs.readFileSync(candidate, 'utf-8')
      if (!raw.trim()) continue
      const parsed = JSON.parse(raw)
      const store = asRecord(parsed)
      if (!store) continue
      return { store: store as AuthStoreDocument, pathname: candidate }
    } catch {
      // keep trying other candidates
    }
  }
  return { store: null }
}

function hasUsableProfileCredential(profile: AuthProfileCredential): boolean {
  const profileType = (profile.type || '').trim()
  if (profileType === 'api_key') {
    return Boolean(normalizeSecret(profile.key))
  }
  if (profileType === 'token') {
    const token = normalizeSecret(profile.token)
    if (!token) return false
    if (typeof profile.expires !== 'number' || !Number.isFinite(profile.expires) || profile.expires <= 0) {
      return true
    }
    return Date.now() < profile.expires
  }
  if (profileType === 'oauth') {
    return Boolean(normalizeSecret(profile.access) || normalizeSecret(profile.refresh))
  }
  return false
}

function resolveOrderedProfileIdsForProvider(
  store: AuthStoreDocument | null,
  providerId: string,
): string[] {
  if (!store?.profiles || typeof store.profiles !== 'object') {
    return []
  }

  const providerKey = normalizeProviderId(providerId)
  const matched = Object.entries(store.profiles)
    .filter(([, profile]) => {
      const profileProvider = normalizeProviderId(String(profile?.provider || ''))
      return profileProvider === providerKey && hasUsableProfileCredential(profile || {})
    })
    .map(([profileId]) => profileId)

  if (matched.length === 0) {
    return []
  }

  const orderMap = store.order && typeof store.order === 'object' ? store.order : undefined
  if (!orderMap) {
    return matched
  }

  let explicitOrder: string[] | undefined
  for (const [key, order] of Object.entries(orderMap)) {
    if (normalizeProviderId(key) !== providerKey || !Array.isArray(order)) {
      continue
    }
    explicitOrder = order
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
    break
  }

  if (!explicitOrder || explicitOrder.length === 0) {
    return matched
  }

  const inOrder = explicitOrder.filter((profileId) => matched.includes(profileId))
  const remaining = matched.filter((profileId) => !inOrder.includes(profileId))
  return [...inOrder, ...remaining]
}

function resolveEnvVarCandidates(providerId: string): string[] {
  const normalized = normalizeProviderId(providerId)

  if (normalized === 'github-copilot') {
    return ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN']
  }
  if (normalized === 'anthropic') {
    return ['ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY']
  }
  if (normalized === 'chutes') {
    return ['CHUTES_OAUTH_TOKEN', 'CHUTES_API_KEY']
  }
  if (normalized === 'zai') {
    return ['ZAI_API_KEY', 'Z_AI_API_KEY']
  }
  if (normalized === 'opencode') {
    return ['OPENCODE_API_KEY', 'OPENCODE_ZEN_API_KEY']
  }
  if (normalized === 'qwen-portal') {
    return ['QWEN_OAUTH_TOKEN', 'QWEN_PORTAL_API_KEY']
  }
  if (normalized === 'minimax-portal') {
    return ['MINIMAX_OAUTH_TOKEN', 'MINIMAX_API_KEY']
  }
  if (normalized === 'kimi-coding') {
    return ['KIMI_API_KEY', 'KIMICODE_API_KEY']
  }
  if (normalized === 'huggingface') {
    return ['HUGGINGFACE_HUB_TOKEN', 'HF_TOKEN']
  }

  const envMap: Record<string, string> = {
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    voyage: 'VOYAGE_API_KEY',
    groq: 'GROQ_API_KEY',
    deepgram: 'DEEPGRAM_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    xai: 'XAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    litellm: 'LITELLM_API_KEY',
    'vercel-ai-gateway': 'AI_GATEWAY_API_KEY',
    'cloudflare-ai-gateway': 'CLOUDFLARE_AI_GATEWAY_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    xiaomi: 'XIAOMI_API_KEY',
    synthetic: 'SYNTHETIC_API_KEY',
    venice: 'VENICE_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    together: 'TOGETHER_API_KEY',
    qianfan: 'QIANFAN_API_KEY',
    ollama: 'OLLAMA_API_KEY',
    vllm: 'VLLM_API_KEY',
  }

  const mapped = envMap[normalized]
  if (mapped) return [mapped]

  const fallback = normalized
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
  return fallback ? [`${fallback}_API_KEY`] : []
}

function resolveActiveEnvVar(providerId: string, env: NodeJS.ProcessEnv): string | null {
  const candidates = resolveEnvVarCandidates(providerId)
  for (const envVar of candidates) {
    if (normalizeSecret(env[envVar])) {
      return envVar
    }
  }
  return null
}

function formatProfileList(profileIds: string[]): string {
  if (profileIds.length <= 3) {
    return profileIds.join(', ')
  }
  return `${profileIds.slice(0, 3).join(', ')} 等 ${profileIds.length} 个`
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function dedupeStrings(value: string[]): string[] {
  const seen = new Set<string>()
  const output: string[] = []
  for (const entry of value) {
    const normalized = String(entry || '').trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }
  return output
}

function collectManagedProviderEntries(config: Record<string, any> | undefined): ManagedProviderEntry[] {
  const providers = asRecord(asRecord(config)?.models)?.providers
  const providersRecord = asRecord(providers)
  if (!providersRecord) {
    return []
  }

  const entries: ManagedProviderEntry[] = []
  for (const [providerId, providerConfigRaw] of Object.entries(providersRecord)) {
    const providerConfig = asRecord(providerConfigRaw)
    if (!providerConfig) continue

    const apiKey = normalizeSecret(providerConfig.apiKey)
    if (!apiKey) continue

    const authMode = normalizeSecret(providerConfig.auth)?.toLowerCase()
    if (authMode && authMode !== 'api-key') {
      continue
    }

    const providerKey = normalizeProviderId(providerId)
    entries.push({
      providerId,
      providerKey,
      apiKey,
      managedProfileId: resolveManagedProfileId(providerId),
    })
  }

  return entries
}

function ensureProfilesMap(store: AuthStoreDocument): Record<string, AuthProfileCredential> {
  const profilesRecord = asRecord(store.profiles)
  if (!profilesRecord) {
    store.profiles = {}
    return store.profiles
  }
  return profilesRecord as Record<string, AuthProfileCredential>
}

function normalizeOrderMap(order: unknown): Record<string, string[]> {
  const orderRecord = asRecord(order)
  if (!orderRecord) return {}

  const normalized: Record<string, string[]> = {}
  for (const [provider, rawList] of Object.entries(orderRecord)) {
    if (!Array.isArray(rawList)) continue
    const list = dedupeStrings(rawList.map((entry) => String(entry || '')))
    if (list.length === 0) continue
    normalized[provider] = list
  }
  return normalized
}

function isManagedProfileUsingProviderApiKey(params: {
  store: AuthStoreDocument | null
  profileId: string
  providerId: string
  providerApiKey: string
}): boolean {
  if (!isManagedProfileId(params.profileId)) {
    return false
  }
  const profile = params.store?.profiles?.[params.profileId]
  if (!profile) return false

  if (normalizeProviderId(String(profile.provider || '')) !== normalizeProviderId(params.providerId)) {
    return false
  }

  const profileKey = normalizeSecret(profile.key)
  return profileKey === params.providerApiKey
}

export function syncOpenclawManagedAiAuthProfiles(params: {
  config: Record<string, any> | undefined
  configPath?: string
}): { updated: boolean; authProfilesPath?: string; managedProviders: string[] } {
  const entries = collectManagedProviderEntries(params.config)
  const stateDir = resolveStateDir(params.configPath)
  const candidates = resolveAuthProfilePathCandidates(stateDir)
  const preferredPath = candidates[0]
    || path.join(stateDir, 'agents', DEFAULT_AGENT_ID, 'agent', AUTH_PROFILE_FILENAME)
  const loaded = loadAuthProfileStore(stateDir)

  if (!loaded.store && entries.length === 0) {
    return { updated: false, managedProviders: [] }
  }

  const authProfilesPath = loaded.pathname || preferredPath
  const store: AuthStoreDocument = loaded.store
    ? { ...loaded.store }
    : { version: AUTH_STORE_VERSION, profiles: {} }
  const profiles = ensureProfilesMap(store)

  let mutated = false
  if (typeof store.version !== 'number' || !Number.isFinite(store.version) || store.version <= 0) {
    store.version = AUTH_STORE_VERSION
    mutated = true
  }

  const entriesByProviderKey = new Map(entries.map((entry) => [entry.providerKey, entry]))
  for (const profileId of Object.keys(profiles)) {
    if (!isManagedProfileId(profileId)) continue

    const providerKey = profileId.slice(MANAGED_PROFILE_PREFIX.length)
    const target = entriesByProviderKey.get(providerKey)
    if (!target) {
      delete profiles[profileId]
      mutated = true
      continue
    }

    const current = profiles[profileId] || {}
    const sameType = String(current.type || '').trim() === 'api_key'
    const sameProvider = normalizeProviderId(String(current.provider || '')) === target.providerKey
    const sameKey = normalizeSecret(current.key) === target.apiKey
    if (!sameType || !sameProvider || !sameKey) {
      profiles[profileId] = {
        type: 'api_key',
        provider: target.providerKey,
        key: target.apiKey,
      }
      mutated = true
    }
  }

  for (const entry of entries) {
    const current = profiles[entry.managedProfileId] || {}
    const sameType = String(current.type || '').trim() === 'api_key'
    const sameProvider = normalizeProviderId(String(current.provider || '')) === entry.providerKey
    const sameKey = normalizeSecret(current.key) === entry.apiKey
    if (!sameType || !sameProvider || !sameKey) {
      profiles[entry.managedProfileId] = {
        type: 'api_key',
        provider: entry.providerKey,
        key: entry.apiKey,
      }
      mutated = true
    }
  }

  const order = normalizeOrderMap(store.order)
  const validManagedProfileIds = new Set(entries.map((entry) => entry.managedProfileId))

  for (const [provider, list] of Object.entries(order)) {
    const filtered = list.filter((profileId) => {
      if (!profiles[profileId]) return false
      if (!isManagedProfileId(profileId)) return true
      return validManagedProfileIds.has(profileId)
    })

    if (filtered.length === 0) {
      delete order[provider]
      if (list.length > 0) mutated = true
      continue
    }
    if (!arraysEqual(list, filtered)) {
      order[provider] = filtered
      mutated = true
    }
  }

  for (const entry of entries) {
    const existingOrderKey = Object.keys(order).find((key) => normalizeProviderId(key) === entry.providerKey)
    const orderKey = existingOrderKey || entry.providerKey
    const currentOrder = order[orderKey] || []

    const providerProfileIds = Object.entries(profiles)
      .filter(([, profile]) => normalizeProviderId(String(profile?.provider || '')) === entry.providerKey)
      .filter(([, profile]) => hasUsableProfileCredential(profile || {}))
      .map(([profileId]) => profileId)

    const desiredOrder = dedupeStrings([
      entry.managedProfileId,
      ...currentOrder.filter((profileId) => providerProfileIds.includes(profileId)),
      ...providerProfileIds,
    ])

    if (!arraysEqual(currentOrder, desiredOrder)) {
      order[orderKey] = desiredOrder
      mutated = true
    }
  }

  if (Object.keys(order).length > 0) {
    if (JSON.stringify(store.order || {}) !== JSON.stringify(order)) {
      store.order = order
      mutated = true
    }
  } else if (store.order !== undefined) {
    delete store.order
    mutated = true
  }

  if (!mutated) {
    return {
      updated: false,
      authProfilesPath,
      managedProviders: entries.map((entry) => entry.providerId),
    }
  }

  fs.mkdirSync(path.dirname(authProfilesPath), { recursive: true })
  fs.writeFileSync(authProfilesPath, JSON.stringify(store, null, 2), 'utf-8')

  return {
    updated: true,
    authProfilesPath,
    managedProviders: entries.map((entry) => entry.providerId),
  }
}

export function auditOpenclawAiAuthOverrides(params: {
  config: Record<string, any> | undefined
  configPath?: string
  env?: NodeJS.ProcessEnv
}): OpenclawAiAuthOverrideWarning[] {
  const providers = asRecord(asRecord(params.config)?.models)?.providers
  const providersRecord = asRecord(providers)
  if (!providersRecord) {
    return []
  }

  const stateDir = resolveStateDir(params.configPath)
  const { store: authStore, pathname: authProfilesPath } = loadAuthProfileStore(stateDir)
  const env = params.env || process.env
  const warnings: OpenclawAiAuthOverrideWarning[] = []

  for (const [providerId, providerConfigRaw] of Object.entries(providersRecord)) {
    const providerConfig = asRecord(providerConfigRaw)
    if (!providerConfig) continue

    const providerApiKey = normalizeSecret(providerConfig.apiKey)
    if (!providerApiKey) continue

    const profileIds = resolveOrderedProfileIdsForProvider(authStore, providerId)
    const envVar = resolveActiveEnvVar(providerId, env)

    if (profileIds.length > 0) {
      const firstProfileId = profileIds[0]
      if (firstProfileId && isManagedProfileUsingProviderApiKey({
        store: authStore,
        profileId: firstProfileId,
        providerId,
        providerApiKey,
      })) {
        continue
      }

      warnings.push({
        providerId,
        source: 'auth-profile',
        sourceLabel: `auth-profiles: ${formatProfileList(profileIds)}`,
        profileIds,
        authProfilesPath,
        envVar: envVar || undefined,
        message: `Provider "${providerId}" 当前优先使用 auth-profiles，Providers JSON 里的 apiKey 不会生效。`,
        suggestion: authProfilesPath
          ? `请清理 ${authProfilesPath} 中该 provider 的 profile 后再热加载。`
          : '请清理该 provider 的 auth-profiles 后再热加载。',
      })
      continue
    }

    if (envVar) {
      warnings.push({
        providerId,
        source: 'env',
        sourceLabel: `env: ${envVar}`,
        envVar,
        message: `Provider "${providerId}" 当前优先使用环境变量 ${envVar}，Providers JSON 里的 apiKey 不会生效。`,
        suggestion: `请移除或更新环境变量 ${envVar} 后再热加载。`,
      })
    }
  }

  return warnings
}
