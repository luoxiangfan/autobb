export type OpenclawParentRequestIdSource =
  | 'none'
  | 'message_id'
  | 'inbound_message_id'
  | 'request_id'
  | 'manual'

export type OpenclawParentRequestIdResolution = {
  parentRequestId?: string
  source: OpenclawParentRequestIdSource
}

function normalizeHeaderValue(value: string | null | undefined): string | undefined {
  const normalized = String(value || '').trim()
  return normalized || undefined
}

function normalizeShortText(value: unknown, maxLength: number): string | undefined {
  const normalized = String(value || '').trim()
  if (!normalized) return undefined
  return normalized.slice(0, maxLength)
}

export function resolveOpenclawParentRequestIdFromHeaders(
  headers: { get(name: string): string | null }
): OpenclawParentRequestIdResolution {
  const inboundMessageId = normalizeHeaderValue(headers.get('x-openclaw-inbound-message-id'))
  if (inboundMessageId) {
    return {
      parentRequestId: inboundMessageId,
      source: 'inbound_message_id',
    }
  }

  const messageId = normalizeHeaderValue(headers.get('x-openclaw-message-id'))
  if (messageId) {
    return {
      parentRequestId: messageId,
      source: 'message_id',
    }
  }

  const requestId = normalizeHeaderValue(headers.get('x-request-id'))
  if (requestId) {
    return {
      parentRequestId: requestId,
      source: 'request_id',
    }
  }

  return {
    source: 'none',
  }
}

export async function resolveOpenclawParentRequestId(params: {
  explicitParentRequestId?: string | null
  explicitSource?: OpenclawParentRequestIdSource
  userId: number
  channel?: string | null
  senderId?: string | null
  accountId?: string | null
}): Promise<string | undefined> {
  return normalizeShortText(params.explicitParentRequestId, 255)
}
