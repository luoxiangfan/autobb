import { gunzipSync, gzipSync } from 'zlib'

export type JsonPayloadCodec = 'json' | 'gzip-base64'

const COMPRESS_MIN_BYTES = 4096

export function compressJsonPayloadText(jsonText: string): {
  payload: string
  codec: JsonPayloadCodec
} {
  if (jsonText.length < COMPRESS_MIN_BYTES) {
    return { payload: jsonText, codec: 'json' }
  }

  const compressed = gzipSync(Buffer.from(jsonText, 'utf8')).toString('base64')
  return { payload: compressed, codec: 'gzip-base64' }
}

export function decompressJsonPayloadText(payload: string, codec: JsonPayloadCodec | string | null | undefined): string {
  if (codec === 'gzip-base64') {
    return gunzipSync(Buffer.from(payload, 'base64')).toString('utf8')
  }
  return payload
}

export function serializeJsonPayloadForStorage(value: unknown): {
  payload: string
  codec: JsonPayloadCodec
} {
  const jsonText = typeof value === 'string' ? value : JSON.stringify(value ?? null)
  return compressJsonPayloadText(jsonText)
}

export function parseStoredJsonPayload(payload: unknown, codec: JsonPayloadCodec | string | null | undefined): unknown {
  if (payload === null || payload === undefined) return null

  if (codec === 'gzip-base64') {
    const text = typeof payload === 'string' ? payload : String(payload)
    const jsonText = decompressJsonPayloadText(text, codec)
    return JSON.parse(jsonText)
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      return payload
    }
  }

  return payload
}
