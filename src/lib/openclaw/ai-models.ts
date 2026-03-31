type JsonRecord = Record<string, unknown>

export type AiModelsJsonShape = 'providers' | 'models.providers' | 'root-providers' | 'unknown'

export type AiModelOption = {
  providerId: string
  modelId: string
  modelName: string
  modelRef: string
}

export type ParsedAiModelsJson = {
  parseError: string | null
  jsonShape: AiModelsJsonShape
  providers: Record<string, JsonRecord> | undefined
  modelOptions: AiModelOption[]
  explicitSelectedModelRef: string | null
  selectedModelRef: string | null
}

const isJsonRecord = (value: unknown): value is JsonRecord => {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

const ensureJsonRecord = (value: unknown): JsonRecord => {
  return isJsonRecord(value) ? value : {}
}

const collectProviders = (providersSource: JsonRecord): Record<string, JsonRecord> => {
  const providers: Record<string, JsonRecord> = {}
  for (const [providerId, providerValue] of Object.entries(providersSource)) {
    if (!isJsonRecord(providerValue)) continue
    if (!Array.isArray(providerValue.models)) continue
    providers[providerId] = providerValue
  }
  return providers
}

const collectModelOptions = (providers: Record<string, JsonRecord>): AiModelOption[] => {
  const options: AiModelOption[] = []
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const models = Array.isArray(providerConfig.models) ? providerConfig.models : []
    for (const model of models) {
      const modelId = (() => {
        if (typeof model === 'string') {
          return model.trim()
        }
        if (isJsonRecord(model) && typeof model.id === 'string') {
          return model.id.trim()
        }
        return ''
      })()
      if (!modelId) continue

      const modelName =
        isJsonRecord(model) && typeof model.name === 'string' && model.name.trim()
          ? model.name.trim()
          : modelId

      options.push({
        providerId,
        modelId,
        modelName,
        modelRef: `${providerId}/${modelId}`,
      })
    }
  }
  return options
}

const normalizeSelectedModelRef = (raw: unknown, modelOptions: AiModelOption[]): string | null => {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  if (trimmed.includes('/')) {
    const matched = modelOptions.find((item) => item.modelRef === trimmed)
    return matched?.modelRef || null
  }

  const matchedById = modelOptions.find((item) => item.modelId === trimmed)
  return matchedById?.modelRef || null
}

const getAgentPrimaryModelRef = (parsed: JsonRecord): string | null => {
  const agentsNode = ensureJsonRecord(parsed.agents)
  const defaultsNode = ensureJsonRecord(agentsNode.defaults)
  const modelNode = defaultsNode.model

  if (typeof modelNode === 'string') {
    return modelNode.trim() || null
  }

  if (isJsonRecord(modelNode) && typeof modelNode.primary === 'string') {
    return modelNode.primary.trim() || null
  }

  return null
}

const pickSelectedModelCandidate = (parsed: JsonRecord): unknown => {
  const modelsNode = ensureJsonRecord(parsed.models)
  const agentPrimary = getAgentPrimaryModelRef(parsed)

  const candidates = [
    agentPrimary,
    parsed.selectedModel,
    modelsNode.selectedModel,
    parsed.defaultModel,
    modelsNode.defaultModel,
    parsed.currentModel,
    modelsNode.currentModel,
  ]

  return candidates.find((item) => typeof item === 'string' && item.trim())
}

export function parseAiModelsJson(value: string | null | undefined): ParsedAiModelsJson {
  const raw = (value || '').trim()
  if (!raw) {
    return {
      parseError: null,
      jsonShape: 'unknown',
      providers: undefined,
      modelOptions: [],
      explicitSelectedModelRef: null,
      selectedModelRef: null,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: any) {
    return {
      parseError: error?.message || 'JSON 格式错误',
      jsonShape: 'unknown',
      providers: undefined,
      modelOptions: [],
      explicitSelectedModelRef: null,
      selectedModelRef: null,
    }
  }

  if (!isJsonRecord(parsed)) {
    return {
      parseError: '顶层必须是 JSON 对象',
      jsonShape: 'unknown',
      providers: undefined,
      modelOptions: [],
      explicitSelectedModelRef: null,
      selectedModelRef: null,
    }
  }

  let jsonShape: AiModelsJsonShape = 'unknown'
  let providersSource: JsonRecord = {}

  if (isJsonRecord(parsed.providers)) {
    jsonShape = 'providers'
    providersSource = parsed.providers
  } else if (isJsonRecord(parsed.models) && isJsonRecord(parsed.models.providers)) {
    jsonShape = 'models.providers'
    providersSource = parsed.models.providers
  } else {
    jsonShape = 'root-providers'
    providersSource = parsed
  }

  const providers = collectProviders(providersSource)
  const modelOptions = collectModelOptions(providers)
  const explicitSelectedModelRef = normalizeSelectedModelRef(
    pickSelectedModelCandidate(parsed),
    modelOptions
  )
  const selectedModelRef = explicitSelectedModelRef || modelOptions[0]?.modelRef || null

  return {
    parseError: null,
    jsonShape,
    providers: Object.keys(providers).length > 0 ? providers : undefined,
    modelOptions,
    explicitSelectedModelRef,
    selectedModelRef,
  }
}

export function setAiModelsSelectedModel(
  value: string | null | undefined,
  selectedModelRef: string,
): { json: string; error: string | null } {
  const raw = (value || '').trim()
  if (!raw) {
    return { json: value || '', error: '请先填写 Providers JSON' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error: any) {
    return { json: value || '', error: error?.message || 'JSON 格式错误' }
  }

  if (!isJsonRecord(parsed)) {
    return { json: value || '', error: '顶层必须是 JSON 对象' }
  }

  const parsedInfo = parseAiModelsJson(raw)
  if (parsedInfo.parseError) {
    return { json: value || '', error: parsedInfo.parseError }
  }

  const normalizedRef = normalizeSelectedModelRef(selectedModelRef, parsedInfo.modelOptions)
  if (!normalizedRef) {
    return { json: value || '', error: '所选模型不在 Providers JSON 中' }
  }

  if (parsedInfo.jsonShape === 'models.providers') {
    const modelsNode = ensureJsonRecord(parsed.models)
    modelsNode.selectedModel = normalizedRef
    parsed.models = modelsNode
    if ('selectedModel' in parsed) {
      delete parsed.selectedModel
    }
  } else {
    parsed.selectedModel = normalizedRef
    const modelsNode = ensureJsonRecord(parsed.models)
    if ('selectedModel' in modelsNode) {
      delete modelsNode.selectedModel
      parsed.models = modelsNode
    }
  }

  const agentsNode = ensureJsonRecord(parsed.agents)
  const defaultsNode = ensureJsonRecord(agentsNode.defaults)
  const modelNode = defaultsNode.model

  if (isJsonRecord(modelNode)) {
    defaultsNode.model = {
      ...modelNode,
      primary: normalizedRef,
    }
  } else {
    defaultsNode.model = { primary: normalizedRef }
  }

  agentsNode.defaults = defaultsNode
  parsed.agents = agentsNode

  return {
    json: JSON.stringify(parsed, null, 2),
    error: null,
  }
}
