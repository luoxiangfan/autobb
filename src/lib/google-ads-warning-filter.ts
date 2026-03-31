const warningFilterInstalledKey = Symbol.for('autoads.google-ads-warning-filter')

interface NormalizedWarning {
  name?: string
  code?: string
  message?: string
}

function includesMetadataNoise(value: unknown): boolean {
  const text = typeof value === 'string' ? value.toLowerCase() : ''
  if (!text) return false
  return text.includes('metadatalookupwarning')
    || text.includes('all promises were rejected')
}

export function shouldSuppressGoogleAdsWarningText(value: unknown): boolean {
  return includesMetadataNoise(value)
}

export function normalizeProcessWarningArgs(args: unknown[]): NormalizedWarning {
  const warningArg = args[0]
  const secondArg = args[1]
  const thirdArg = args[2]

  let name: string | undefined
  let code: string | undefined
  let message: string | undefined

  if (warningArg instanceof Error) {
    name = warningArg.name
    message = warningArg.message
    code = (warningArg as Error & { code?: string }).code
  } else if (typeof warningArg === 'string') {
    message = warningArg
  } else if (warningArg && typeof warningArg === 'object') {
    const warningLike = warningArg as Record<string, unknown>
    if (typeof warningLike.name === 'string') name = warningLike.name
    if (typeof warningLike.code === 'string') code = warningLike.code
    if (typeof warningLike.message === 'string') message = warningLike.message
  }

  if (secondArg && typeof secondArg === 'object' && !Array.isArray(secondArg)) {
    const options = secondArg as { type?: unknown; code?: unknown }
    if (typeof options.type === 'string') name = options.type
    if (typeof options.code === 'string') code = options.code
  } else {
    if (typeof secondArg === 'string') name = secondArg
    if (typeof thirdArg === 'string') code = thirdArg
  }

  return { name, code, message }
}

export function shouldSuppressGoogleAdsProcessWarning(args: unknown[]): boolean {
  const warning = normalizeProcessWarningArgs(args)
  return includesMetadataNoise(warning.name)
    || includesMetadataNoise(warning.code)
    || includesMetadataNoise(warning.message)
}

/**
 * 抑制 Google Ads SDK 在非GCP环境下的 MetadataLookupWarning 噪音。
 */
export function installGoogleAdsWarningFilter(): void {
  if (typeof process === 'undefined') return

  const globalState = globalThis as typeof globalThis & {
    [warningFilterInstalledKey]?: boolean
  }

  if (globalState[warningFilterInstalledKey]) return

  if (typeof process.emitWarning === 'function') {
    const originalEmitWarning = process.emitWarning.bind(process)
    process.emitWarning = ((...args: unknown[]) => {
      if (shouldSuppressGoogleAdsProcessWarning(args)) {
        return
      }
      return Reflect.apply(originalEmitWarning, process, args)
    }) as typeof process.emitWarning
  }

  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    const originalWarn = console.warn.bind(console)
    console.warn = ((...args: unknown[]) => {
      const joined = args.map((arg) => {
        if (typeof arg === 'string') return arg
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      }).join(' ')
      if (shouldSuppressGoogleAdsWarningText(joined)) return
      return Reflect.apply(originalWarn, console, args)
    }) as typeof console.warn
  }

  if (typeof process.stderr?.write === 'function') {
    const originalWrite = process.stderr.write.bind(process.stderr)
    process.stderr.write = ((chunk: any, ...args: any[]) => {
      const message = typeof chunk === 'string' ? chunk : chunk?.toString?.() || ''
      if (shouldSuppressGoogleAdsWarningText(message)) {
        return true
      }
      return originalWrite(chunk, ...args)
    }) as typeof process.stderr.write
  }

  globalState[warningFilterInstalledKey] = true
}
