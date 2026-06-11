import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/google-ads/credentials/route'

describe('POST /api/google-ads/credentials', () => {
  it('returns 410 Gone with successor PUT /api/settings', async () => {
    const req = new NextRequest('http://localhost/api/google-ads/credentials', {
      method: 'POST',
      body: JSON.stringify({
        client_id: 'cid',
        client_secret: 'secret',
        developer_token: 'dev-token-123456',
      }),
    })

    const res = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(410)
    expect(res.headers.get('Deprecation')).toBe('true')
    expect(data.code).toBe('ENDPOINT_DEPRECATED')
    expect(data.replacement).toMatchObject({ method: 'PUT', path: '/api/settings' })
    expect(String(data.message)).toContain('PUT /api/settings')
  })
})
