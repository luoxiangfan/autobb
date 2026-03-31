import { describe, expect, it, vi } from 'vitest'
import { registerBackgroundExecutors } from '../background-executors'

describe('registerBackgroundExecutors (background worker)', () => {
  it('registers all background task executors including product-score-calculation', () => {
    const registerExecutor = vi.fn()
    const queue = { registerExecutor } as any

    registerBackgroundExecutors(queue)

    const registeredTaskTypes = registerExecutor.mock.calls.map((call) => call[0]).sort()

    expect(registeredTaskTypes).toEqual([
      'affiliate-product-sync',
      'click-farm',
      'click-farm-batch',
      'click-farm-trigger',
      'openclaw-affiliate-sync',
      'openclaw-command',
      'openclaw-report-send',
      'openclaw-strategy',
      'product-score-calculation',
      'url-swap',
    ])
  })
})
