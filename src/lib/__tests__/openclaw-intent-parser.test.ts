import { describe, expect, it } from 'vitest'
import { parseOpenclawCommandIntent } from '../openclaw/commands/intent-parser'

describe('openclaw intent parser', () => {
  it('normalizes method/path and derives intent for low-risk read', () => {
    const result = parseOpenclawCommandIntent({ method: ' get ', path: ' /api/offers ' })

    expect(result.method).toBe('GET')
    expect(result.path).toBe('/api/offers')
    expect(result.intent).toBe('offers.list')
    expect(result.riskLevel).toBe('low')
    expect(result.requiresConfirmation).toBe(false)
  })

  it('marks delete action as high risk and requires confirmation', () => {
    const result = parseOpenclawCommandIntent({ method: 'DELETE', path: '/api/offers/123/delete' })

    expect(result.riskLevel).toBe('high')
    expect(result.requiresConfirmation).toBe(true)
  })

  it('blocks internal management endpoints', () => {
    expect(() =>
      parseOpenclawCommandIntent({ method: 'POST', path: '/api/admin/users' })
    ).toThrow('Path blocked: /api/admin')
  })

  it('rejects absolute urls', () => {
    expect(() =>
      parseOpenclawCommandIntent({ method: 'GET', path: 'https://example.com/api/offers' })
    ).toThrow('Absolute URLs are not allowed')
  })

  it('normalizes trailing slash and query for downstream risk parsing', () => {
    const result = parseOpenclawCommandIntent({ method: 'GET', path: '/api/campaigns/performance/?daysBack=7' })

    expect(result.path).toBe('/api/campaigns/performance')
    expect(result.method).toBe('GET')
  })
})
