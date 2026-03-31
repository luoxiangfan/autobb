import { describe, expect, it } from 'vitest'

import {
  resolveOpenclawParentRequestId,
  resolveOpenclawParentRequestIdFromHeaders,
} from '@/lib/openclaw/request-correlation'

describe('openclaw request correlation', () => {
  it('resolves parent request id from headers with expected priority', () => {
    const withInbound = resolveOpenclawParentRequestIdFromHeaders({
      get: (name: string) => {
        if (name === 'x-openclaw-inbound-message-id') return 'om_inbound'
        if (name === 'x-openclaw-message-id') return 'om_message'
        return null
      },
    })
    expect(withInbound).toEqual({
      parentRequestId: 'om_inbound',
      source: 'inbound_message_id',
    })

    const withMessage = resolveOpenclawParentRequestIdFromHeaders({
      get: (name: string) => (name === 'x-openclaw-message-id' ? 'om_1' : null),
    })
    expect(withMessage).toEqual({
      parentRequestId: 'om_1',
      source: 'message_id',
    })

    const withRequest = resolveOpenclawParentRequestIdFromHeaders({
      get: (name: string) => (name === 'x-request-id' ? 'uuid-1' : null),
    })
    expect(withRequest).toEqual({
      parentRequestId: 'uuid-1',
      source: 'request_id',
    })

    const empty = resolveOpenclawParentRequestIdFromHeaders({
      get: () => null,
    })
    expect(empty).toEqual({
      source: 'none',
    })
  })

  it('keeps explicit feishu message id as parent request id', async () => {
    const resolved = await resolveOpenclawParentRequestId({
      explicitParentRequestId: 'om_direct',
      explicitSource: 'message_id',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
    })

    expect(resolved).toBe('om_direct')
  })

  it('keeps request_id as parent request id for feishu', async () => {
    const resolved = await resolveOpenclawParentRequestId({
      explicitParentRequestId: 'uuid-1',
      explicitSource: 'request_id',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
    })

    expect(resolved).toBe('uuid-1')
  })

  it('keeps manual UUID parent request id', async () => {
    const resolved = await resolveOpenclawParentRequestId({
      explicitParentRequestId: 'b3f0f07f-5ef6-4f40-b84f-0ea6a4f4eb10',
      explicitSource: 'manual',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
    })

    expect(resolved).toBe('b3f0f07f-5ef6-4f40-b84f-0ea6a4f4eb10')
  })

  it('returns undefined when parent request id is missing', async () => {
    const resolved = await resolveOpenclawParentRequestId({
      explicitSource: 'none',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
    })
    expect(resolved).toBeUndefined()
  })

  it('keeps manual feishu message id', async () => {
    const resolved = await resolveOpenclawParentRequestId({
      explicitParentRequestId: 'om_manual',
      explicitSource: 'manual',
      userId: 7,
      channel: 'feishu',
      senderId: 'ou_1',
    })

    expect(resolved).toBe('om_manual')
  })
})
